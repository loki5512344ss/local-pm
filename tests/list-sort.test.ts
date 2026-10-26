import { describe, it, expect } from 'vitest'
import {
  cycleListSort,
  listSortToParam,
  listSortToServerSort,
  parseListSort,
  type ListSortClause,
} from '@/lib/list-sort'

describe('parseListSort', () => {
  it('treats an empty value as the default order', () => {
    expect(parseListSort(null)).toEqual([])
    expect(parseListSort('')).toEqual([])
    expect(parseListSort('  ')).toEqual([])
  })

  it('parses a single key as ascending', () => {
    expect(parseListSort('title')).toEqual([{ key: 'title', dir: 'asc' }])
  })

  it('parses the minus prefix as descending', () => {
    expect(parseListSort('-dueDate')).toEqual([{ key: 'dueDate', dir: 'desc' }])
  })

  it('parses a chain and keeps the order', () => {
    expect(parseListSort('title,-dueDate,estimate')).toEqual([
      { key: 'title', dir: 'asc' },
      { key: 'dueDate', dir: 'desc' },
      { key: 'estimate', dir: 'asc' },
    ])
  })

  it('drops unknown keys, duplicates and anything past three clauses', () => {
    expect(parseListSort('nonsense,title')).toEqual([{ key: 'title', dir: 'asc' }])
    expect(parseListSort('title,title')).toEqual([{ key: 'title', dir: 'asc' }])
    expect(parseListSort('title,dueDate,estimate,-createdAt')).toHaveLength(3)
  })
})

describe('listSortToParam / listSortToServerSort', () => {
  it('round-trips through the URL encoding', () => {
    const clauses = parseListSort('title,-dueDate')
    expect(listSortToParam(clauses)).toBe('title,-dueDate')
    expect(parseListSort(listSortToParam(clauses))).toEqual(clauses)
  })

  it('falls back to a meaningful default server sort, not insertion order', () => {
    expect(listSortToServerSort([])).toBe('-updatedAt')
    expect(listSortToServerSort([{ key: 'estimate', dir: 'desc' }])).toBe('-estimate')
  })
})

describe('cycleListSort — click a header', () => {
  it('sorts ascending on the first click', () => {
    expect(cycleListSort([], 'dueDate', false)).toEqual([{ key: 'dueDate', dir: 'asc' }])
  })

  it('flips to descending on the second click', () => {
    const current = [{ key: 'dueDate', dir: 'asc' }] as const
    expect(cycleListSort([...current], 'dueDate', false)).toEqual([
      { key: 'dueDate', dir: 'desc' },
    ])
  })

  it('returns to the default order on the third click', () => {
    const current = [{ key: 'dueDate', dir: 'desc' }] as const
    expect(cycleListSort([...current], 'dueDate', false)).toEqual([])
  })

  it('replaces the previous column when a different header is clicked', () => {
    const current = [{ key: 'title', dir: 'desc' }] as const
    expect(cycleListSort([...current], 'estimate', false)).toEqual([{ key: 'estimate', dir: 'asc' }])
  })
})

describe('cycleListSort — shift+click chains sorts', () => {
  it('appends a secondary sort without touching the first', () => {
    const current = [{ key: 'title', dir: 'desc' }] as const
    expect(cycleListSort([...current], 'dueDate', true)).toEqual([
      { key: 'title', dir: 'desc' },
      { key: 'dueDate', dir: 'asc' },
    ])
  })

  it('toggles the direction of an already chained column', () => {
    const current = [{ key: 'title', dir: 'asc' }, { key: 'dueDate', dir: 'asc' }] as const
    expect(cycleListSort([...current], 'dueDate', true)).toEqual([
      { key: 'title', dir: 'asc' },
      { key: 'dueDate', dir: 'desc' },
    ])
  })

  it('toggles direction in a full chain but never grows past three clauses', () => {
    const current: ListSortClause[] = [
      { key: 'title', dir: 'asc' },
      { key: 'dueDate', dir: 'asc' },
      { key: 'estimate', dir: 'asc' },
    ]
    expect(cycleListSort(current, 'dueDate', true)).toEqual([
      { key: 'title', dir: 'asc' },
      { key: 'dueDate', dir: 'desc' },
      { key: 'estimate', dir: 'asc' },
    ])
    expect(cycleListSort(current, 'estimate', true)).toHaveLength(3)
  })
})
