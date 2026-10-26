'use client'

import { useEffect, useRef, useState } from 'react'
import { Flag, LayoutGrid, List, Plus, Search, Tag, Users, X, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useShortcut } from '@/lib/shortcuts'
import { groupDimensionParam, type GroupDimension } from '@/lib/board-groups'
import { useEntityDoc } from '@/hooks/useEntityDoc'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Badge'
import { Kbd } from '@/components/ui/Kbd'
import { Select } from '@/components/ui/Select'
import { CycleSelect, MemberSelect, ProjectSelect, TeamSelect } from '@/components/ui/EntityPickers'
import { SavedBoardViews } from './SavedBoardViews'
import type { Cycle, Member, Project, Team } from '@/payload-types'

export interface BoardFilters {
  projectId: string | null
  teamId: string | null
  assigneeId: string | null
  cycleId: string | null
  query: string
}

export type BoardViewMode = 'board' | 'list'

export function BoardToolbar({
  filters,
  onChange,
  resultCount,
  onCreateTicket,
  hasProjects = true,
  refreshing = false,
  view = 'board',
  onViewChange,
  group = null,
  onGroupChange,
}: {
  filters: BoardFilters
  onChange: (next: Partial<BoardFilters>) => void
  resultCount: number
  hasProjects?: boolean
  refreshing?: boolean
  onCreateTicket: () => void
  view?: BoardViewMode
  onViewChange?: (next: BoardViewMode) => void
  group?: GroupDimension | null
  onGroupChange?: (next: GroupDimension | null) => void
}) {
  const [showFilters, setShowFilters] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const selectedProject = useEntityDoc<Project>('projects', filters.projectId)
  const selectedTeam = useEntityDoc<Team>('teams', filters.teamId)
  const selectedAssignee = useEntityDoc<Member>('members', filters.assigneeId)
  const selectedCycle = useEntityDoc<Cycle>('cycles', filters.cycleId)
  const hasFilters = Boolean(
    filters.projectId || filters.teamId || filters.assigneeId || filters.cycleId || filters.query,
  )

  useShortcut({
    id: 'board.search',
    keys: 'slash',
    description: 'Focus the board search',
    group: 'Board',
    scope: 'board',
    run: () => searchRef.current?.focus(),
  })

  useShortcut({
    id: 'board.create',
    keys: 'c',
    description: 'Create a ticket',
    group: 'Board',
    scope: 'board',
    run: onCreateTicket,
  })

  useEffect(() => {
    const el = searchRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && filters.query) {
        e.stopPropagation()
        onChange({ query: '' })
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [filters.query, onChange])

  return (
    <div className="flex flex-none flex-col gap-3 border-b border-border-subtle bg-bg px-6 py-4 max-md:px-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold text-text">Board</h1>
          <p className="mt-1 text-sm text-text-muted">A clear view of what is next.</p>
        </div>
        {onViewChange && (
          <BoardViewSwitcher view={view} onChange={onViewChange} />
        )}
        {hasProjects && (
          <Button variant="primary" icon={Plus} onClick={onCreateTicket} shortcut="c">
            New ticket
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex h-8 min-w-0 flex-1 items-center gap-2 rounded-sm border border-border bg-surface px-2.5 max-sm:basis-full md:max-w-80">
          <Search className="size-4 shrink-0 text-text-muted" aria-hidden />
          <span className="sr-only">Search tickets on this board</span>
          <input
            ref={searchRef}
            type="search"
            value={filters.query}
            onChange={(e) => onChange({ query: e.target.value })}
            placeholder="Search by title or ticket key"
            className="min-w-0 flex-1 bg-transparent text-base text-text outline-none max-sm:text-md"
          />
          <Kbd raw="/" className="max-sm:hidden" />
        </label>

        {onGroupChange && view === 'board' && (
          <Select
            aria-label="Group tickets by"
            value={group ?? ''}
            onValueChange={(next) => onGroupChange(groupDimensionParam(next))}
            className="w-36 max-sm:w-full"
            options={[
              { value: '', label: 'No grouping' },
              { value: 'assignee', label: 'Assignee', icon: Users },
              { value: 'priority', label: 'Priority', icon: Flag },
              { value: 'label', label: 'Label', icon: Tag },
            ]}
          />
        )}

        <Button
          variant="secondary"
          icon={SlidersHorizontal}
          className="sm:hidden"
          aria-expanded={showFilters}
          aria-controls="board-filters"
          onClick={() => setShowFilters((value) => !value)}
        >
          Filters{hasFilters ? ' · On' : ''}
        </Button>
        <div
          id="board-filters"
          className={cn(
            'flex flex-wrap items-center gap-2 max-sm:w-full',
            !showFilters && 'max-sm:hidden',
          )}
        >
          <ProjectSelect
            id="board-project-filter"
            aria-label="Filter by project"
            value={filters.projectId ?? ''}
            allLabel="All projects"
            className="w-40 max-sm:w-full"
            onChange={(next) => onChange({ projectId: next || null })}
          />

          <TeamSelect
            id="board-team-filter"
            aria-label="Filter by team"
            value={filters.teamId ?? ''}
            allLabel="All teams"
            className="w-40 max-sm:w-full"
            onChange={(next) => onChange({ teamId: next || null })}
          />

          <MemberSelect
            id="board-assignee-filter"
            aria-label="Filter by assignee"
            value={filters.assigneeId ?? ''}
            allLabel="Anyone"
            placeholder="Anyone"
            className="w-40 max-sm:w-full"
            onChange={(next) => onChange({ assigneeId: next || null })}
          />

          {filters.projectId && (
            <CycleSelect
              id="board-cycle-filter"
              aria-label="Filter by cycle"
              value={filters.cycleId ?? ''}
              allLabel="All cycles"
              placeholder="All cycles"
              where={{ project: filters.projectId }}
              className="w-40 max-sm:w-full"
              onChange={(next) => onChange({ cycleId: next || null })}
            />
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs tabular text-text-muted" role="status">
            {refreshing ? 'Updating…' : resultCount + (resultCount === 1 ? ' ticket' : ' tickets')}
          </span>
          <SavedBoardViews filters={filters} onChange={onChange} />
        </div>
      </div>

      <div className={cn('flex flex-wrap items-center gap-2', !hasFilters && 'hidden')}>
        <span className="text-xs text-text-muted tabular" aria-live="polite">
          {resultCount} {resultCount === 1 ? 'ticket' : 'tickets'}
        </span>

        {selectedProject && (
          <Chip
            tone="accent"
            onRemove={() => onChange({ projectId: null })}
            removeLabel={`Remove project filter ${selectedProject.name}`}
          >
            Project: {selectedProject.name}
          </Chip>
        )}
        {selectedTeam && (
          <Chip
            tone="accent"
            onRemove={() => onChange({ teamId: null })}
            removeLabel={`Remove team filter ${selectedTeam.name}`}
          >
            Team: {selectedTeam.name}
          </Chip>
        )}
        {selectedAssignee && (
          <Chip
            tone="accent"
            onRemove={() => onChange({ assigneeId: null })}
            removeLabel={`Remove assignee filter ${selectedAssignee.name}`}
          >
            Assignee: {selectedAssignee.name}
          </Chip>
        )}
        {selectedCycle && (
          <Chip
            tone="accent"
            onRemove={() => onChange({ cycleId: null })}
            removeLabel={`Remove cycle filter ${selectedCycle.name}`}
          >
            Cycle: {selectedCycle.name}
          </Chip>
        )}
        {filters.query && (
          <Chip
            tone="accent"
            onRemove={() => onChange({ query: '' })}
            removeLabel="Clear the search"
          >
            Search: {filters.query}
          </Chip>
        )}

        <Button
          variant="ghost"
          size="sm"
          icon={X}
          onClick={() =>
            onChange({
              projectId: null,
              teamId: null,
              assigneeId: null,
              cycleId: null,
              query: '',
            })
          }
        >
          Clear all
        </Button>
      </div>
    </div>
  )
}

const VIEW_OPTIONS: { value: BoardViewMode; label: string; icon: typeof LayoutGrid }[] = [
  { value: 'board', label: 'Board', icon: LayoutGrid },
  { value: 'list', label: 'List', icon: List },
]

export function BoardViewSwitcher({
  view,
  onChange,
}: {
  view: BoardViewMode
  onChange: (next: BoardViewMode) => void
}) {
  return (
    <div
      role="group"
      aria-label="View mode"
      className="flex items-center gap-0.5 rounded-sm border border-border bg-surface p-0.5"
    >
      {VIEW_OPTIONS.map((option) => {
        const Icon = option.icon
        const active = view === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-xs px-2 text-sm font-medium',
              'transition-colors duration-micro ease-standard',
              active ? 'bg-surface-hover text-text' : 'text-text-muted hover:text-text',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
