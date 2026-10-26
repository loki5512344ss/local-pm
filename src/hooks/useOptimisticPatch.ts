'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPatchQueue, patchErrorMessage, type PatchOutcome } from '@/lib/patch-queue'
import { useToast } from '@/components/ui/Toast'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function useOptimisticPatch<T extends { id: string }>({
  collection,
  record,
  onApply,
}: {
  collection: 'tickets' | 'projects' | 'teams' | 'cycles' | 'initiatives'
  record: T

  onApply: (next: T) => void
}) {
  const { toast } = useToast()
  const [state, setState] = useState<SaveState>('idle')
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef(0)

  // The queue reads and writes this ref synchronously, so a change queued
  // behind an in-flight one is built on the settled result of the previous
  // patch even if React has not re-rendered with it yet.
  const appliedRef = useRef(record)
  appliedRef.current = record
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply
  const toastRef = useRef(toast)
  toastRef.current = toast

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    },
    [],
  )

  const [queue] = useState(() =>
    createPatchQueue<T>({
      getRecord: () => appliedRef.current,
      apply: (next) => {
        appliedRef.current = next
        onApplyRef.current(next)
      },
      send: async (base, changes) => {
        const response = await fetch(`/api/${collection}/${base.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changes),
        })

        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(patchErrorMessage(response.status, body?.errors?.[0]?.message))
        }
        const saved = await response.json()
        return (saved.doc ?? saved) as T
      },
    }),
  )

  const settle = useCallback((outcome: PatchOutcome<T>) => {
    pendingRef.current -= 1
    if (pendingRef.current > 0) return

    if (outcome.ok) {
      setState('saved')
      if (resetTimer.current) clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(() => setState('idle'), 2000)
    } else {
      setState('error')
    }
  }, [])

  const patch = useCallback(
    async (changes: Partial<T>, label: string, preview?: Partial<T>) => {
      pendingRef.current += 1
      if (resetTimer.current) clearTimeout(resetTimer.current)
      setState('saving')

      const outcome = await queue.enqueue(changes, preview)

      if (!outcome.ok) {
        toastRef.current({
          tone: 'error',
          title: `Couldn't save ${label}`,
          description:
            outcome.error instanceof Error ? outcome.error.message : 'The change has been undone.',
        })
      }
      settle(outcome)
      return outcome.ok
    },
    [queue, settle],
  )

  return { patch, state }
}

export function saveStateLabel(state: SaveState): string | null {
  if (state === 'saving') return 'Saving…'
  if (state === 'saved') return 'Saved'
  if (state === 'error') return 'Not saved'
  return null
}
