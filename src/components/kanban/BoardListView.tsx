'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { cn } from '@/lib/cn'
import { estimateLabel } from '@/lib/estimates'
import { formatDateCompact } from '@/lib/format'
import { cycleListSort, listSortToServerSort, type ListSortClause, type ListSortKey } from '@/lib/list-sort'
import { isClosedStatus } from '@/lib/status'
import { useEntityQuery } from '@/hooks/useEntityQuery'
import { AvatarLabel } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { estimatesFor } from '@/components/ui/EstimatePicker'
import { RowSkeletonList, useDelayedFlag } from '@/components/ui/Skeleton'
import { PriorityIndicator, TicketStatusBadge } from '@/components/ui/StateIndicator'
import { TicketKey } from '@/components/ui/EntityMark'
import { Table, Td, Th, Tr } from '@/components/ui/Table'
import type { BoardFilters } from './BoardToolbar'
import type { Member, Project, Ticket } from '@/payload-types'

const PAGE_SIZE = 25

export interface BoardListViewProps {
  filters: BoardFilters
  sort: ListSortClause[]
  onSortChange: (next: ListSortClause[]) => void
  onOpenTicket: (ticket: Ticket) => void
  ticketHref: (ticket: Ticket) => string
  openTicketId: string | null
  onTotalChange: (total: number) => void
}

/**
 * Dense list rendering of the same tickets the board shows — same filters,
 * same side panel, its own addressable sort (`?sort=`).
 */
export function BoardListView({
  filters,
  sort,
  onSortChange,
  onOpenTicket,
  ticketHref,
  openTicketId,
  onTotalChange,
}: BoardListViewProps) {
  const { docs, totalDocs, hasNextPage, loading, loadingMore, error, loadMore, retry } =
    useEntityQuery<Ticket>(filters.query, {
      collection: 'tickets',
      searchField: 'title',
      sort: listSortToServerSort(sort),
      where: {
        project: filters.projectId,
        team: filters.teamId,
        assignee: filters.assigneeId,
        cycle: filters.cycleId,
      },
      depth: 2,
      pageSize: PAGE_SIZE,
    })

  useEffect(() => onTotalChange(totalDocs), [totalDocs, onTotalChange])

  const showSkeleton = useDelayedFlag(loading)
  const hasFilters = Boolean(
    filters.projectId || filters.teamId || filters.assigneeId || filters.cycleId || filters.query,
  )
  const showEstimates = docs.some(
    (ticket) =>
      estimatesFor(typeof ticket.project === 'object' ? (ticket.project as Project) : null).enabled,
  )

  const sortProps = (key: ListSortKey) => {
    const index = sort.findIndex((clause) => clause.key === key)
    const clause = index === -1 ? null : sort[index]
    return {
      sortable: true as const,
      sortDirection: clause ? clause.dir : null,
      sortPriority: clause && sort.length > 1 ? index + 1 : undefined,
      onSort: (additive: boolean) => onSortChange(cycleListSort(sort, key, additive)),
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6 max-md:p-4">
      {error ? (
        <EmptyState
          kind="error"
          title="Couldn't load the ticket list"
          description={error}
          action={{ label: 'Retry', onClick: retry }}
        />
      ) : showSkeleton && docs.length === 0 ? (
        <RowSkeletonList count={8} />
      ) : docs.length === 0 && hasFilters ? (
        <EmptyState
          kind="no-match"
          title="No tickets match these filters"
          description="Nothing in this list fits the current project, team, assignee and search combination."
        />
      ) : docs.length === 0 ? (
        <EmptyState
          kind="no-data"
          title="No tickets yet"
          description="Tickets you create show up here and on the board."
        />
      ) : (
        <>
          <div className="overflow-hidden rounded-md border border-border-subtle">
            <Table caption="Tickets in list view">
              <thead>
                <tr>
                  <Th className="w-px whitespace-nowrap">Key</Th>
                  <Th>Title</Th>
                  <Th width="9rem">Status</Th>
                  <Th width="11rem">Assignee</Th>
                  <Th width="7rem">
                    <span className="sr-only">Priority</span>
                  </Th>
                  <Th width="8rem" {...sortProps('dueDate')}>
                    Due
                  </Th>
                  {showEstimates && (
                    <Th width="6rem" align="right" {...sortProps('estimate')}>
                      Estimate
                    </Th>
                  )}
                </tr>
              </thead>
              <tbody>
                {docs.map((ticket) => {
                  const assignee =
                    typeof ticket.assignee === 'object' ? (ticket.assignee as Member) : null
                  const overdue =
                    ticket.dueDate &&
                    !isClosedStatus(ticket.status) &&
                    new Date(ticket.dueDate).getTime() < Date.now()

                  return (
                    <Tr
                      key={ticket.id}
                      selected={ticket.id === openTicketId}
                      onOpen={() => onOpenTicket(ticket)}
                    >
                      <Td className="whitespace-nowrap">
                        <TicketKey
                          value={ticket.ticketId}
                          color={
                            typeof ticket.project === 'object'
                              ? ((ticket.project as Project).color ?? null)
                              : null
                          }
                        />
                      </Td>
                      <Td>
                        <Link
                          href={ticketHref(ticket)}
                          onClick={(e) => e.stopPropagation()}
                          className="block truncate font-medium text-text hover:underline"
                          title={ticket.title}
                        >
                          {ticket.title}
                        </Link>
                      </Td>
                      <Td>
                        <TicketStatusBadge status={ticket.status} />
                      </Td>
                      <Td className="text-text">
                        <AvatarLabel
                          name={assignee?.name}
                          seed={assignee?.id}
                          fallback="Unassigned"
                        />
                      </Td>
                      <Td>
                        <PriorityIndicator priority={ticket.priority} />
                      </Td>
                      <Td
                        className={cn(
                          'whitespace-nowrap tabular',
                          overdue ? 'font-medium text-danger-text' : 'text-text-muted',
                        )}
                      >
                        {ticket.dueDate ? formatDateCompact(ticket.dueDate) : '—'}
                      </Td>
                      {showEstimates && (
                        <Td align="right" className="text-text-muted">
                          {estimateLabel(
                            estimatesFor(
                              typeof ticket.project === 'object'
                                ? (ticket.project as Project)
                                : null,
                            ).scale,
                            ticket.estimate,
                          ) ?? '—'}
                        </Td>
                      )}
                    </Tr>
                  )
                })}
              </tbody>
            </Table>
          </div>

          {hasNextPage && (
            <div className="flex justify-center py-3">
              <Button variant="secondary" loading={loadingMore} onClick={loadMore}>
                {loadingMore
                  ? 'Loading…'
                  : `Load more (${docs.length} of ${totalDocs})`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
