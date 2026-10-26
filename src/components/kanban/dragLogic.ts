import { arrayMove } from '@dnd-kit/sortable'
import { statusIdOf } from '@/lib/workflow'
import { groupIdOfTicket, type BoardGroup, type GroupDimension } from '@/lib/board-groups'
import { TicketPriority } from '@/types/enums'
import type { Label, Member, Ticket } from '@/payload-types'



export interface DragResult {
  activeId: string | null
  status: string | null
  sortOrder: number | null
  tickets: Ticket[]
}

export interface DragTarget {
  status: string
  isColumnTarget: boolean
}

export function resolveDragTarget(
  tickets: Ticket[],
  activeId: string,
  overId: string,
  columnIds: string[],
): DragTarget | null {
  if (activeId === overId) return null

  const activeTicket = tickets.find((t) => t.id === activeId)
  if (!activeTicket) return null

  if (columnIds.includes(overId)) {
    return { status: overId as string, isColumnTarget: true }
  }

  const overTicket = tickets.find((t) => t.id === overId)
  if (!overTicket) return null

  return { status: statusIdOf(overTicket) as string, isColumnTarget: false }
}

export function applyDrop(
  tickets: Ticket[],
  activeId: string,
  overId: string,
  columnIds: string[],
): DragResult {
  const noOp: DragResult = { activeId: null, status: null, sortOrder: null, tickets }

  const target = resolveDragTarget(tickets, activeId, overId, columnIds)
  if (!target) return noOp

  const activeTicket = tickets.find((t) => t.id === activeId) as Ticket
  const targetStatus = target.status

  const columnTickets = tickets.filter((t) => statusIdOf(t) === targetStatus)
  const oldIndex = columnTickets.findIndex((t) => t.id === activeId)

  const dropIndex = target.isColumnTarget
    ? columnTickets.length
    : Math.max(0, columnTickets.findIndex((t) => t.id === overId))

  const orderedColumn =
    oldIndex === -1
      ? [...columnTickets.slice(0, dropIndex), activeTicket, ...columnTickets.slice(dropIndex)]
      : arrayMove(columnTickets, oldIndex, dropIndex)

  const orderById = new Map<string, number>()
  orderedColumn.forEach((t, i) => orderById.set(t.id, i))

  const nextTickets = tickets.map((ticket) => {
    if (ticket.id === activeId) {
      return { ...ticket, status: targetStatus, sortOrder: orderById.get(ticket.id) ?? 0 }
    }
    const newOrder = orderById.get(ticket.id)
    if (newOrder === undefined) return ticket
    return { ...ticket, sortOrder: newOrder }
  })

  const activeNext = nextTickets.find((t) => t.id === activeId) as Ticket

  return {
    activeId,
    status: targetStatus,
    sortOrder: activeNext.sortOrder ?? 0,
    tickets: nextTickets,
  }
}

export function resultFromPreview(tickets: Ticket[], activeId: string): DragResult {
  const active = tickets.find((t) => t.id === activeId)
  if (!active) return { activeId: null, status: null, sortOrder: null, tickets }

  return {
    activeId,
    status: statusIdOf(active) as string,
    sortOrder: active.sortOrder ?? 0,
    tickets,
  }
}

export function isRealMove(
  result: DragResult,
  origin: { status: string; sortOrder: number } | null,
): boolean {
  if (result.status === null || result.sortOrder === null) return false
  if (!origin) return true
  return result.status !== origin.status || result.sortOrder !== origin.sortOrder
}

export function computeDragResult(
  tickets: Ticket[],
  activeId: string,
  overId: string,
  columnIds: string[],
): DragResult {
  const result = applyDrop(tickets, activeId, overId, columnIds)

  if (result.status === null) return result

  const activePrev = tickets.find((t) => t.id === result.activeId)
  const activeNext = result.tickets.find((t) => t.id === result.activeId)
  if (
    activePrev &&
    activeNext &&
    statusIdOf(activeNext) === statusIdOf(activePrev) &&
    (activeNext.sortOrder ?? 0) === (activePrev.sortOrder ?? 0)
  ) {
    return { activeId: null, status: null, sortOrder: null, tickets }
  }

  return result
}

/**
 * Drag semantics when the board is grouped by assignee, priority or label.
 * Dropping a card into another group reassigns that one field and leaves
 * status and sort order alone.
 */
export type GroupPatch = Partial<Pick<Ticket, 'assignee' | 'priority' | 'labels'>>

export interface GroupDropContext {
  memberById: Map<string, Member>
  labelById: Map<string, Label>
}

export interface GroupDropResult {
  tickets: Ticket[]
  groupId: string | null
  patch: GroupPatch | null
  /**
   * True when this drop moves the card out of its CURRENT group. Whether it is
   * a real move is decided against the drag origin — see isRealGroupMove.
   */
  changed: boolean
}

const EMPTY_DROP_CONTEXT: GroupDropContext = {
  memberById: new Map(),
  labelById: new Map(),
}

function emptyGroupDrop(tickets: Ticket[]): GroupDropResult {
  return { tickets, groupId: null, patch: null, changed: false }
}

export function resolveGroupDropTarget(
  groups: BoardGroup[],
  tickets: Ticket[],
  activeId: string,
  overId: string,
  dimension: GroupDimension,
): BoardGroup | null {
  if (activeId === overId) return null

  const groupById = new Map(groups.map((group) => [group.id, group]))
  const columnGroup = groupById.get(overId)
  if (columnGroup) return columnGroup

  const overTicket = tickets.find((t) => t.id === overId)
  if (!overTicket) return null

  return groupById.get(groupIdOfTicket(overTicket, dimension)) ?? null
}

/** The PATCH payload that puts a ticket into a group column. */
export function groupPatchForTarget(
  target: BoardGroup,
  context: GroupDropContext = EMPTY_DROP_CONTEXT,
): { patch: GroupPatch; hydrated: Partial<Ticket> } {
  if (target.dimension === 'assignee') {
    const member = target.value ? (context.memberById.get(target.value) ?? null) : null
    return {
      patch: { assignee: target.value },
      hydrated: { assignee: (member ?? target.value) as Ticket['assignee'] },
    }
  }
  if (target.dimension === 'priority') {
    const PRIORITIES: readonly string[] = [
      'URGENT',
      'HIGH',
      'MEDIUM',
      'LOW',
      'NO_PRIORITY',
    ]
    const priority = PRIORITIES.includes(target.value ?? '')
      ? (target.value as TicketPriority)
      : TicketPriority.NO_PRIORITY
    return { patch: { priority }, hydrated: { priority } }
  }
  const label = target.value ? (context.labelById.get(target.value) ?? null) : null
  const labels = label ? [label] : []
  return {
    patch: { labels: labels.map((entry) => String(entry.id)) },
    hydrated: { labels: labels as Ticket['labels'] },
  }
}

export function applyGroupDrop(
  tickets: Ticket[],
  activeId: string,
  overId: string,
  dimension: GroupDimension,
  groups: BoardGroup[],
  context: GroupDropContext = EMPTY_DROP_CONTEXT,
): GroupDropResult {
  const activeTicket = tickets.find((t) => t.id === activeId)
  if (!activeTicket) return emptyGroupDrop(tickets)

  const target = resolveGroupDropTarget(groups, tickets, activeId, overId, dimension)
  if (!target) return emptyGroupDrop(tickets)

  const changed = groupIdOfTicket(activeTicket, dimension) !== target.id
  if (!changed) return emptyGroupDrop(tickets)

  const { patch, hydrated } = groupPatchForTarget(target, context)
  return {
    tickets: tickets.map((ticket) => (ticket.id === activeId ? { ...ticket, ...hydrated } : ticket)),
    groupId: target.id,
    patch,
    changed,
  }
}

/**
 * dnd-kit reports `over === active` at the end of a drag whose preview the
 * onDragOver handler already applied. Read the position the preview put the
 * card in and compare it against the drag origin, exactly like the status flow.
 */
export function groupResultFromPreview(
  tickets: Ticket[],
  activeId: string,
  dimension: GroupDimension,
): GroupDropResult {
  const active = tickets.find((t) => t.id === activeId)
  if (!active) return emptyGroupDrop(tickets)

  const groupId = groupIdOfTicket(active, dimension)
  if (dimension === 'assignee') {
    const assignee = active.assignee
    const value = assignee && typeof assignee === 'object' ? String(assignee.id) : assignee || null
    return { tickets, groupId, patch: { assignee: value }, changed: true }
  }
  if (dimension === 'priority') {
    return { tickets, groupId, patch: { priority: active.priority ?? TicketPriority.NO_PRIORITY }, changed: true }
  }
  const labels = Array.isArray(active.labels) ? active.labels : []
  return {
    tickets,
    groupId,
    patch: {
      labels: labels.map((entry) => (typeof entry === 'object' ? String(entry.id) : String(entry))),
    },
    changed: true,
  }
}

export function isRealGroupMove(
  result: GroupDropResult,
  origin: { groupId: string | null } | null,
): boolean {
  if (!result.groupId || !result.patch) return false
  if (!origin) return true
  return result.groupId !== origin.groupId
}
