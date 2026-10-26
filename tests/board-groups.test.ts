import { describe, it, expect } from 'vitest'
import {
  boardGroups,
  groupDimensionParam,
  groupIdFor,
  groupIdOfTicket,
  isGroupDimension,
} from '@/lib/board-groups'
import { TicketPriority } from '@/types/enums'
import type { Label, Member, Ticket } from '@/payload-types'

const member = (id: string, name: string): Member => ({ id, name }) as unknown as Member
const label = (id: string, name: string): Label => ({ id, name }) as unknown as Label
const ticket = (over: Partial<Ticket>): Pick<Ticket, 'assignee' | 'priority' | 'labels'> =>
  over as Pick<Ticket, 'assignee' | 'priority' | 'labels'>

describe('board-groups (task 14)', () => {
  it('validates and parses the group dimension URL parameter', () => {
    expect(isGroupDimension('priority')).toBe(true)
    expect(isGroupDimension('colour')).toBe(false)
    expect(groupDimensionParam('assignee')).toBe('assignee')
    expect(groupDimensionParam('none')).toBeNull()
    expect(groupDimensionParam(null)).toBeNull()
  })

  it('builds stable group ids, with none for the empty group', () => {
    expect(groupIdFor('priority', 'HIGH')).toBe('priority:HIGH')
    expect(groupIdFor('assignee', null)).toBe('assignee:none')
  })

  it('orders priority groups urgent-first with no empty group', () => {
    const groups = boardGroups('priority', [], [])
    expect(groups.map((group) => group.value)).toEqual([
      'URGENT',
      'HIGH',
      'MEDIUM',
      'LOW',
      'NO_PRIORITY',
    ])
    expect(groups.some((group) => group.value === null)).toBe(false)
  })

  it('orders assignee groups alphabetically and puts Unassigned last', () => {
    const groups = boardGroups('assignee', [member('m2', 'Ada'), member('m1', 'Loki')], [])
    expect(groups.map((group) => group.label)).toEqual(['Ada', 'Loki', 'Unassigned'])
    expect(groups.at(-1)?.value).toBeNull()
  })

  it('places the ticket into the group matching its dimension', () => {
    const t = ticket({ assignee: member('m1', 'Loki'), priority: TicketPriority.HIGH, labels: [label('l1', 'bug')] })
    expect(groupIdOfTicket(t, 'assignee')).toBe('assignee:m1')
    expect(groupIdOfTicket(t, 'priority')).toBe('priority:HIGH')
    expect(groupIdOfTicket(t, 'label')).toBe('label:l1')
  })

  it('falls back to the none group for unassigned, unprioritised, unlabelled tickets', () => {
    const t = ticket({ assignee: null, priority: null, labels: [] })
    expect(groupIdOfTicket(t, 'assignee')).toBe('assignee:none')
    expect(groupIdOfTicket(t, 'priority')).toBe('priority:NO_PRIORITY')
    expect(groupIdOfTicket(t, 'label')).toBe('label:none')
  })
})
