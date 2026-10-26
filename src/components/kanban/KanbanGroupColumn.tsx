'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ChevronsLeftRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { CountBadge } from '@/components/ui/Badge'
import { Tooltip } from '@/components/ui/Tooltip'
import { CardSkeletonList } from '@/components/ui/Skeleton'
import { KanbanCard } from './KanbanCard'
import type { BoardGroup } from '@/lib/board-groups'
import type { Ticket } from '@/payload-types'

export interface KanbanGroupColumnProps {
  group: BoardGroup
  icon: ReactNode
  /** What a drop into the empty column does, e.g. "Drop a ticket here to assign Alex." */
  emptyHint: string
  tickets: Ticket[]
  count: number
  collapsed: boolean
  onToggleCollapsed: () => void
  onOpenTicket: (ticket: Ticket) => void
  ticketHref: (ticket: Ticket) => string
  onEditTicket: (ticket: Ticket) => void
  onDeleteTicket: (ticket: Ticket) => void
  onMoveToColumn: (ticket: Ticket, status: string) => void
  isRefreshing: boolean
  landedTicketId: string | null
}

/**
 * A board column when grouping is active. Dragging a card in reassigns the
 * grouped field (assignee, priority or label) instead of the status; manual
 * in-column reordering is intentionally unavailable because the card order is
 * derived, not manual.
 */
export function KanbanGroupColumn({
  group,
  icon,
  emptyHint,
  tickets,
  count,
  collapsed,
  onToggleCollapsed,
  onOpenTicket,
  ticketHref,
  onEditTicket,
  onDeleteTicket,
  onMoveToColumn,
  isRefreshing,
  landedTicketId,
}: KanbanGroupColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id })

  if (collapsed) {
    return (
      <div className="flex w-12 shrink-0 snap-start flex-col items-center gap-3 rounded-md border border-border-subtle bg-bg-subtle py-3">
        <Tooltip content={`Expand ${group.label}`}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={ChevronsLeftRight}
            aria-label={`Expand ${group.label} group`}
            onClick={onToggleCollapsed}
          />
        </Tooltip>
        <CountBadge value={count} />
        <span
          className="text-xs font-medium tracking-wide text-text-muted"
          style={{ writingMode: 'vertical-rl' }}
        >
          {group.label}
        </span>
      </div>
    )
  }

  return (
    <section
      aria-label={`${group.label} group`}
      className="flex w-72 min-w-72 flex-1 snap-start flex-col rounded-md border border-border-subtle bg-bg max-md:w-full max-md:min-w-full"
    >
      <header className="sticky top-0 z-10 flex h-10 flex-none items-center gap-2 rounded-t-md border-b border-border-subtle bg-bg-subtle px-3">
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
          {icon}
        </span>
        <h2 className="truncate text-sm font-medium text-text">{group.label}</h2>
        <CountBadge value={count} />

        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip content="Collapse group">
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              icon={ChevronsLeftRight}
              aria-label={`Collapse ${group.label} group`}
              onClick={onToggleCollapsed}
            />
          </Tooltip>
        </div>
      </header>

      <div
        ref={setNodeRef}
        data-testid={`group-column-${group.id}`}
        data-group-id={group.id}
        data-group-dimension={group.dimension}
        className={cn(
          'flex min-h-40 flex-1 flex-col gap-2 overflow-y-auto p-3',

          isOver && tickets.length === 0 && 'bg-accent-subtle',
        )}
      >
        <SortableContext items={tickets.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tickets.map((ticket) => (
            <KanbanCard
              key={ticket.id}
              ticket={ticket}
              justLanded={landedTicketId === ticket.id}
              href={ticketHref(ticket)}
              onOpen={() => onOpenTicket(ticket)}
              onEdit={() => onEditTicket(ticket)}
              onDelete={() => onDeleteTicket(ticket)}
              onMoveToColumn={(status) => onMoveToColumn(ticket, status)}
            />
          ))}
        </SortableContext>

        {isRefreshing && tickets.length === 0 && <CardSkeletonList count={3} />}

        {!isRefreshing && tickets.length === 0 && (
          <p className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border-subtle px-3 py-8 text-center text-base text-text-muted">
            {emptyHint}
          </p>
        )}
      </div>
    </section>
  )
}
