/**
 * Serialised optimistic patches for one record.
 *
 * Two PATCHes to the same record landing within a few hundred milliseconds make
 * MongoDB report a write conflict (TransientTransactionError) and the second
 * request fails with a 500 — see roadmap task 61. The fix is to never have two
 * in flight for the same record: a later change queues behind the earlier one
 * and is built on top of the settled result, so every patch is sent against the
 * document state the previous patch produced.
 */

export type PatchOutcome<T> =
  | { ok: true; doc: T }
  | { ok: false; error: unknown; previous: T }

export interface PatchQueue<T extends { id: string }> {
  enqueue: (changes: Partial<T>, preview?: Partial<T>) => Promise<PatchOutcome<T>>
}

export function createPatchQueue<T extends { id: string }>(options: {
  /** The current record, including any optimistic changes already applied. */
  getRecord: () => T
  /** Apply a new value optimistically (or revert to a previous one). */
  apply: (next: T) => void
  /** Send one patch. Must resolve with the saved document or throw. */
  send: (base: T, changes: Partial<T>) => Promise<T>
}): PatchQueue<T> {
  let tail: Promise<unknown> = Promise.resolve()

  const run = async (
    changes: Partial<T>,
    preview: Partial<T> | undefined,
  ): Promise<PatchOutcome<T>> => {
    const previous = options.getRecord()
    const optimistic = { ...previous, ...changes, ...(preview ?? {}) } as T
    options.apply(optimistic)

    try {
      const doc = await options.send(previous, changes)
      options.apply(doc)
      return { ok: true, doc }
    } catch (error) {
      options.apply(previous)
      return { ok: false, error, previous }
    }
  }

  return {
    enqueue: (changes, preview) => {
      // The queued patch runs whatever happened to the one before it — a failed
      // patch reverts its own change and must not strand the changes behind it.
      const result = tail.then(
        () => run(changes, preview),
        () => run(changes, preview),
      )
      tail = result.then(
        () => undefined,
        () => undefined,
      )
      return result
    },
  }
}

/**
 * Toast copy for a failed patch, per 07-feedback-and-errors.md §7.6: plain
 * language, no status codes, no raw driver strings. Validation and permission
 * messages from the server are already written for people and pass through.
 */
export function patchErrorMessage(status: number, serverMessage?: string): string {
  if (status >= 500 || !serverMessage) {
    return 'The server could not save this change. Your edit has been reverted — try again in a moment.'
  }
  return serverMessage
}
