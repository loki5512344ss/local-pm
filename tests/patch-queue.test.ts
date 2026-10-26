import { describe, it, expect } from 'vitest'
import { createPatchQueue, patchErrorMessage } from '@/lib/patch-queue'

interface Doc {
  id: string
  name?: string
  priority?: string
  status?: string
}

const base = (over: Partial<Doc> = {}): Doc => ({ id: 'rec1', name: 'Old name', ...over })

/**
 * A fake transport that records how many patches are in flight at once and
 * fails with a Mongo-style write conflict the moment two overlap — the server
 * behaviour behind roadmap task 61. `failOn` injects the conflict on specific
 * call indexes so the failure-path tests can run without needing real overlap.
 */
function conflictTransport(maxOverlapAllowed = 1, failOn: number[] = []) {
  let inFlight = 0
  let maxInFlight = 0
  const sent: Array<{ base: Doc; changes: Partial<Doc> }> = []

  const send = async (record: Doc, changes: Partial<Doc>): Promise<Doc> => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    sent.push({ base: { ...record }, changes: { ...changes } })
    try {
      if (inFlight > maxOverlapAllowed || failOn.includes(sent.length - 1)) {
        throw new Error('Write conflict during plan execution and yielding is disabled.')
      }
      await Promise.resolve()
      return { ...record, ...changes }
    } finally {
      inFlight -= 1
    }
  }

  return {
    send,
    sent,
    overlapHappened: () => maxInFlight > maxOverlapAllowed,
  }
}

function harness(initial: Doc, failOn: number[] = []) {
  const transport = conflictTransport(1, failOn)
  let current = initial
  const applied: Doc[] = []
  const queue = createPatchQueue<Doc>({
    getRecord: () => current,
    apply: (next) => {
      current = { ...next }
      applied.push(current)
    },
    send: transport.send,
  })
  return { queue, transport, applied, get current() { return current } }
}

describe('createPatchQueue', () => {
  it('runs two quick patches one after the other instead of overlapping them', async () => {
    const h = harness(base())

    // The race from task 61: both changes fire before either response lands.
    const first = h.queue.enqueue({ name: 'First' }, undefined)
    const second = h.queue.enqueue({ priority: 'high' }, undefined)
    const [firstOutcome, secondOutcome] = await Promise.all([first, second])

    expect(firstOutcome.ok).toBe(true)
    expect(secondOutcome.ok).toBe(true)
    expect(h.transport.overlapHappened()).toBe(false)
    expect(h.transport.sent.map((call) => call.changes)).toEqual([
      { name: 'First' },
      { priority: 'high' },
    ])
  })

  it('builds the queued patch on the result of the one before it', async () => {
    const h = harness(base())

    await Promise.all([
      h.queue.enqueue({ name: 'First' }, undefined),
      h.queue.enqueue({ priority: 'high' }, undefined),
    ])

    const secondCall = h.transport.sent[1]
    expect(secondCall.base.name).toBe('First')
    expect(secondCall.base.priority).toBeUndefined()
    expect(h.current).toEqual({ id: 'rec1', name: 'First', priority: 'high' })
  })

  it('applies each patch optimistically, then the server document', async () => {
    const h = harness(base())

    await Promise.all([
      h.queue.enqueue({ name: 'First' }, undefined),
      h.queue.enqueue({ priority: 'high' }, undefined),
    ])

    expect(h.applied).toEqual([
      { id: 'rec1', name: 'First', priority: undefined },
      { id: 'rec1', name: 'First' },
      { id: 'rec1', name: 'First', priority: 'high' },
      { id: 'rec1', name: 'First', priority: 'high' },
    ])
  })

  it('a failed patch reverts only its own change and does not strand the queue', async () => {
    const h = harness(base(), [0])

    const failing = h.queue.enqueue({ name: 'First' }, undefined)
    const following = h.queue.enqueue({ priority: 'high' }, undefined)

    const failingOutcome = await failing
    expect(failingOutcome.ok).toBe(false)
    expect((failingOutcome as { error: Error }).error.message).toContain('Write conflict')
    expect(h.current).toEqual(base())

    const followingOutcome = await following
    expect(followingOutcome.ok).toBe(true)
    expect(h.current).toEqual({ id: 'rec1', name: 'Old name', priority: 'high' })
  })

  it('a failed patch leaves the changes of earlier settled patches intact', async () => {
    const h = harness(base(), [1])

    await h.queue.enqueue({ name: 'First' }, undefined)
    const failing = await h.queue.enqueue({ priority: 'high' }, undefined)

    expect(failing.ok).toBe(false)
    expect(h.current).toEqual({ id: 'rec1', name: 'First' })
  })

  it('reports the base record the failure reverted to', async () => {
    const h = harness(base(), [1])
    await h.queue.enqueue({ name: 'First' }, undefined)
    const outcome = await h.queue.enqueue({ priority: 'high' }, undefined)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.previous).toEqual({ id: 'rec1', name: 'First' })
    }
  })
})

describe('patchErrorMessage', () => {
  it('summarises server failures instead of passing raw driver strings through', () => {
    const message = patchErrorMessage(500, 'Write conflict during plan execution and yielding is disabled.')
    expect(message).not.toContain('Write conflict')
    expect(message).toMatch(/reverted/i)
    expect(message).toMatch(/try again/i)
  })

  it('keeps server messages that were written for people', () => {
    expect(patchErrorMessage(400, 'Target date is before the start date.')).toBe(
      'Target date is before the start date.',
    )
  })

  it('covers responses that carry no message at all', () => {
    expect(patchErrorMessage(403)).toMatch(/reverted/i)
  })
})
