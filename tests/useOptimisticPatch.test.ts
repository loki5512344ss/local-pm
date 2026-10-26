// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

const toastSpy = vi.hoisted(() => vi.fn())

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: toastSpy, dismiss: () => {} }),
}))

import { useOptimisticPatch, saveStateLabel } from '@/hooks/useOptimisticPatch'

interface Doc {
  id: string
  name?: string
  priority?: string
}

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

interface FetchCall {
  url: string
  body: string
}

/**
 * Renders a component wired to useOptimisticPatch the way the detail views use
 * it: the applied record is React state, fed back in through the record prop.
 */
function renderHarness() {
  // Instantiation expression: pins the hook's return type to Doc, so patch()
  // keeps Partial<Doc> instead of collapsing to the { id: string } constraint.
  const api: {
    current: { patch: ReturnType<typeof useOptimisticPatch<Doc>>['patch'] } | null
  } = { current: null }
  const applied: Doc[] = []

  function Harness() {
    const [record, setRecord] = useState<Doc>({ id: 'rec1', name: 'Old name' })
    const { patch, state } = useOptimisticPatch<Doc>({
      collection: 'projects',
      record,
      onApply: (next) => {
        applied.push({ ...next })
        setRecord(next)
      },
    })
    api.current = { patch }
    return createElement('p', null, saveStateLabel(state) ?? 'idle')
  }

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  return { api, applied, container, root, Harness }
}

let harness: ReturnType<typeof renderHarness> | null = null
let root: Root | null = null

beforeEach(() => {
  toastSpy.mockClear()
  harness = renderHarness()
  root = harness.root
  void act(() => {
    root?.render(createElement(harness!.Harness))
  })
})

afterEach(() => {
  void act(() => {
    root?.unmount()
  })
  harness?.container.remove()
  harness = null
  root = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Transport that fails with a Mongo-style write conflict if two PATCHes overlap. */
function stubSequentialFetch(respond: (call: FetchCall, index: number) => unknown) {
  const calls: FetchCall[] = []
  let inFlight = 0
  let maxInFlight = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      calls.push({ url, body: init?.body ?? '' })
      try {
        await Promise.resolve()
        const payload = respond(calls[calls.length - 1], calls.length - 1)
        return payload as Response
      } finally {
        inFlight -= 1
      }
    }),
  )

  return {
    calls,
    maxInFlight: () => maxInFlight,
  }
}

const ok = (doc: Doc) =>
  ({ ok: true, status: 200, json: async () => ({ doc }) }) as unknown as Response

describe('useOptimisticPatch', () => {
  it('sends two quick patches one at a time and lands both on the record', async () => {
    // The API returns the full updated document, so the fake one keeps its own
    // copy of the record and merges each patch into it.
    let doc: Doc = { id: 'rec1', name: 'Old name' }
    const transport = stubSequentialFetch((call) => {
      const changes = JSON.parse(call.body)
      doc = { ...doc, ...changes }
      return ok(doc)
    })

    let outcomes: boolean[] = []
    await act(async () => {
      const first = harness!.api.current!.patch({ name: 'First' }, 'the name')
      const second = harness!.api.current!.patch({ priority: 'high' }, 'the priority')
      outcomes = await Promise.all([first, second])
    })

    expect(outcomes).toEqual([true, true])
    // The regression behind task 61: with two fetches overlapping, MongoDB
    // aborts the second transaction with a write conflict and the API 500s.
    expect(transport.maxInFlight()).toBe(1)
    expect(transport.calls.map((call) => JSON.parse(call.body))).toEqual([
      { name: 'First' },
      { priority: 'high' },
    ])
    expect(harness!.applied.at(-1)).toEqual({ id: 'rec1', name: 'First', priority: 'high' })
    expect(harness!.container.textContent).toContain('Saved')
  })

  it('shows Saving while a queued change waits for the one in flight', async () => {
    let releaseFirst: () => void = () => {}
    const gated = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const transport = stubSequentialFetch(async (call, index) => {
      const changes = JSON.parse(call.body)
      if (index === 0) await gated
      return ok({ id: 'rec1', ...changes })
    })

    let patches: Promise<boolean>[] = []
    await act(async () => {
      patches = [
        harness!.api.current!.patch({ name: 'First' }, 'the name'),
        harness!.api.current!.patch({ priority: 'high' }, 'the priority'),
      ]
    })
    // The first request is held open, the second is queued behind it.
    expect(harness!.container.textContent).toContain('Saving')

    await act(async () => {
      releaseFirst()
      await Promise.all(patches)
    })

    expect(transport.maxInFlight()).toBe(1)
    expect(harness!.container.textContent).toContain('Saved')
  })

  it('reverts, toasts in plain language and keeps the queue alive when the server 500s', async () => {
    const conflict = 'Write conflict during plan execution and yielding is disabled.'
    stubSequentialFetch((_call, index) => {
      if (index === 0) {
        return {
          ok: false,
          status: 500,
          json: async () => ({ errors: [{ message: conflict }] }),
        } as unknown as Response
      }
      return ok({ id: 'rec1', priority: 'high' })
    })

    let outcomes: boolean[] = []
    await act(async () => {
      const first = harness!.api.current!.patch({ name: 'First' }, 'the name')
      const second = harness!.api.current!.patch({ priority: 'high' }, 'the priority')
      outcomes = await Promise.all([first, second])
    })

    expect(outcomes).toEqual([false, true])
    expect(toastSpy).toHaveBeenCalledTimes(1)
    const toast = toastSpy.mock.calls[0][0] as { title: string; description?: string }
    expect(toast.title).toBe("Couldn't save the name")
    expect(toast.description).not.toContain('Write conflict')
    expect(toast.description).toMatch(/reverted/i)
    // The failed edit is gone; the queued one still saved on top of the
    // untouched base.
    expect(harness!.applied.at(-1)).toEqual({ id: 'rec1', priority: 'high' })
    expect(harness!.container.textContent).toContain('Saved')
  })

  it('returns to idle once the saved indicator has had its moment', async () => {
    vi.useFakeTimers()
    stubSequentialFetch(() => ok({ id: 'rec1', name: 'First' }))

    await act(async () => {
      await harness!.api.current!.patch({ name: 'First' }, 'the name')
    })
    expect(harness!.container.textContent).toContain('Saved')

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(harness!.container.textContent).not.toContain('Saved')
  })
})
