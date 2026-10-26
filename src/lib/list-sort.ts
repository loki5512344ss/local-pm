/**
 * Sort state for the board list view (`/board?view=list&sort=…`).
 *
 * The URL, the UI and the server share one encoding: a comma-separated Payload
 * sort string (`title`, `-dueDate`). The default is the empty string, which the
 * server resolves to a meaningful order — most recently updated first.
 */

export type ListSortKey = 'title' | 'dueDate' | 'estimate'

export interface ListSortClause {
  key: ListSortKey
  dir: 'asc' | 'desc'
}

export const LIST_SORT_LABELS: Record<ListSortKey, string> = {
  title: 'Title',
  dueDate: 'Due',
  estimate: 'Estimate',
}

export const DEFAULT_LIST_SORT = '-updatedAt'

const MAX_CLAUSES = 3
const KNOWN_KEYS = new Set<string>(Object.keys(LIST_SORT_LABELS))

export function parseListSort(value: string | null | undefined): ListSortClause[] {
  if (!value) return []
  const clauses: ListSortClause[] = []
  for (const part of value.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const desc = trimmed.startsWith('-')
    const key = desc ? trimmed.slice(1) : trimmed
    if (!KNOWN_KEYS.has(key)) continue
    if (clauses.some((clause) => clause.key === key)) continue
    if (clauses.length >= MAX_CLAUSES) break
    clauses.push({ key: key as ListSortKey, dir: desc ? 'desc' : 'asc' })
  }
  return clauses
}

export function listSortToParam(clauses: ListSortClause[]): string {
  return clauses.map((clause) => (clause.dir === 'desc' ? `-${clause.key}` : clause.key)).join(',')
}

export function listSortToServerSort(clauses: ListSortClause[]): string {
  return listSortToParam(clauses) || DEFAULT_LIST_SORT
}

/**
 * Click a header to sort ascending, again for descending, again to fall back to
 * the default order. Shift+click chains a secondary/tertiary sort (capped at
 * three clauses) instead of replacing the current one.
 */
export function cycleListSort(
  clauses: ListSortClause[],
  key: ListSortKey,
  additive: boolean,
): ListSortClause[] {
  const existing = clauses.find((clause) => clause.key === key)

  if (additive) {
    if (!existing) {
      if (clauses.length >= MAX_CLAUSES) return clauses
      return [...clauses, { key, dir: 'asc' }]
    }
    return clauses.map((clause) =>
      clause.key === key ? { key, dir: clause.dir === 'asc' ? 'desc' : 'asc' } : clause,
    )
  }

  if (!existing) return [{ key, dir: 'asc' }]
  if (existing.dir === 'asc') {
    return clauses.map((clause) => (clause.key === key ? { key, dir: 'desc' } : clause))
  }
  return clauses.filter((clause) => clause.key !== key)
}
