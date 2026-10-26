import { StatusType, TicketPriority } from '@/types/enums'
import { TICKET_PRIORITY_META } from '@/lib/status'
import type { Label, Member, Ticket } from '@/payload-types'

/**
 * Grouping model for the kanban board (`/board?group=…`).
 *
 * A group column is addressed by a stable id — `<dimension>:<value>` with
 * `none` for the "empty" group — so drag-and-drop, collapse state and
 * announcements can talk about groups without reaching into the tickets.
 */
export type GroupDimension = 'assignee' | 'priority' | 'label'

export const GROUP_DIMENSIONS: readonly GroupDimension[] = ['assignee', 'priority', 'label']

export function isGroupDimension(value: unknown): value is GroupDimension {
  return typeof value === 'string' && (GROUP_DIMENSIONS as readonly string[]).includes(value)
}

/** Reads the `group` URL param; anything unknown means "no grouping". */
export function groupDimensionParam(value: string | null | undefined): GroupDimension | null {
  return isGroupDimension(value) ? value : null
}

export interface BoardGroup {
  id: string
  dimension: GroupDimension
  /** Member id, priority value or label id — null for the "none" group. */
  value: string | null
  label: string
}

export function groupIdFor(dimension: GroupDimension, value: string | null): string {
  return value === null ? `${dimension}:none` : `${dimension}:${value}`
}

/**
 * Every column of the chosen dimension, including the "none" column so an
 * empty group is still a drop target. Priorities run urgent-first; members and
 * labels are alphabetical; the "none" group always sits last.
 */
export function boardGroups(
  dimension: GroupDimension,
  members: Member[],
  labels: Label[],
): BoardGroup[] {
  if (dimension === 'priority') {
    return Object.values(TICKET_PRIORITY_META)
      .sort((a, b) => b.rank - a.rank)
      .map((meta) => ({
        id: groupIdFor('priority', meta.value),
        dimension,
        value: meta.value,
        label: meta.label,
      }))
  }

  if (dimension === 'assignee') {
    const sorted = [...members].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    return [
      ...sorted.map((member) => ({
        id: groupIdFor('assignee', String(member.id)),
        dimension,
        value: String(member.id),
        label: member.name ?? 'Unknown',
      })),
      { id: groupIdFor('assignee', null), dimension, value: null, label: 'Unassigned' },
    ]
  }

  const sorted = [...labels].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  return [
    ...sorted.map((label) => ({
      id: groupIdFor('label', String(label.id)),
      dimension,
      value: String(label.id),
      label: label.name ?? 'Unknown',
    })),
    { id: groupIdFor('label', null), dimension, value: null, label: 'No label' },
  ]
}

function extraGroupLabel(ticket: Ticket, dimension: GroupDimension): string {
  if (dimension === 'assignee' && ticket.assignee && typeof ticket.assignee === 'object') {
    return ticket.assignee.name ?? 'Unknown'
  }
  if (dimension === 'label' && Array.isArray(ticket.labels)) {
    const first = ticket.labels.find((entry) => entry && typeof entry === 'object') as
      | Label
      | undefined
    return first?.name ?? 'Unknown'
  }
  return 'Unknown'
}

/**
 * The columns to render: the canonical groups of the dimension plus, as a
 * safety net, any group that only shows up in the loaded tickets (a ticket
 * assigned to someone missing from the members list, say). Without the second
 * half such a ticket would have no column and silently disappear from the board.
 */
export function resolveBoardGroups(
  dimension: GroupDimension,
  members: Member[],
  labels: Label[],
  tickets: Ticket[],
): BoardGroup[] {
  const canonical = boardGroups(dimension, members, labels)
  const seen = new Set(canonical.map((group) => group.id))
  const extra: BoardGroup[] = []
  for (const ticket of tickets) {
    const id = groupIdOfTicket(ticket, dimension)
    if (seen.has(id)) continue
    seen.add(id)
    const value = id.startsWith(`${dimension}:`) ? id.slice(dimension.length + 1) : null
    extra.push({
      id,
      dimension,
      value: value === 'none' ? null : value,
      label: extraGroupLabel(ticket, dimension),
    })
  }
  return [...canonical, ...extra]
}

function relatedId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value || null
  if (typeof value === 'number') return String(value)
  if (typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    const id = (value as { id: unknown }).id
    return id === null || id === undefined ? null : String(id)
  }
  return null
}

function firstLabelId(ticket: Pick<Ticket, 'labels'>): string | null {
  const labels = Array.isArray(ticket.labels) ? ticket.labels : []
  return relatedId(labels[0])
}

/**
 * Which group column a ticket belongs to. Labels are hasMany, so a ticket
 * groups under its first label — dropping it into another label column
 * rewrites its labels to exactly that one, which keeps the card on screen in
 * the column it was dropped on.
 */
export function groupIdOfTicket(
  ticket: Pick<Ticket, 'assignee' | 'priority' | 'labels'>,
  dimension: GroupDimension,
): string {
  if (dimension === 'assignee') {
    return groupIdFor('assignee', relatedId(ticket.assignee))
  }
  if (dimension === 'priority') {
    return groupIdFor('priority', ticket.priority ?? TicketPriority.NO_PRIORITY)
  }
  return groupIdFor('label', firstLabelId(ticket))
}

const STATUS_TYPE_ORDER: readonly string[] = [
  StatusType.BACKLOG,
  StatusType.UNSTARTED,
  StatusType.STARTED,
  StatusType.COMPLETED,
  StatusType.CANCELLED,
]

export function statusTypeRankOf(ticket: Pick<Ticket, 'status'>): number {
  const status = ticket.status
  const type = status && typeof status === 'object' ? status.type : null
  const index = type ? STATUS_TYPE_ORDER.indexOf(type) : -1
  return index === -1 ? STATUS_TYPE_ORDER.length : index
}

/**
 * Card order inside a group column: open work before closed work, then the
 * board's manual order, then the title as a deterministic tiebreak.
 */
export function compareTicketsInGroup(
  a: Pick<Ticket, 'status' | 'sortOrder' | 'title'>,
  b: Pick<Ticket, 'status' | 'sortOrder' | 'title'>,
): number {
  const rank = statusTypeRankOf(a) - statusTypeRankOf(b)
  if (rank !== 0) return rank
  const order = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  if (order !== 0) return order
  return (a.title ?? '').localeCompare(b.title ?? '')
}
