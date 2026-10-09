import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/commands/commandParser.js';

describe('parseCommand', () => {
  const options = { now: new Date('2026-09-30T12:00:00.000Z'), timezone: 'UTC' };

  it.each([
    ['add finish DBMS assignment tomorrow', { type: 'create_task', title: 'finish DBMS assignment', dueText: 'tomorrow' }],
    ['show my tasks today', { type: 'list_tasks', scope: 'today' }],
    ['what should I do now?', { type: 'recommend_next_task' }],
    ['complete DBMS assignment', { type: 'complete_task', taskQuery: 'DBMS assignment' }],
    ['move project report to Friday', { type: 'set_deadline', taskQuery: 'project report', dueText: 'Friday' }],
    ['show overdue tasks', { type: 'list_tasks', scope: 'overdue' }],
    ['what is due this week?', { type: 'list_tasks', scope: 'week' }],
    ['create project University', { type: 'create_project', projectName: 'University' }],
    ['assign DBMS assignment to University', { type: 'assign_project', taskQuery: 'DBMS assignment', projectName: 'University' }],
    ['show my projects', { type: 'list_projects' }],
    ['set priority of DBMS assignment to urgent', { type: 'set_priority', taskQuery: 'DBMS assignment', priority: 'urgent' }],
    ['restore DBMS assignment', { type: 'restore_task', taskQuery: 'DBMS assignment' }],
    ['undo DBMS assignment', { type: 'undo_last_change', taskQuery: 'DBMS assignment' }],
    ['estimate DBMS assignment for 90 minutes', { type: 'set_estimate', taskQuery: 'DBMS assignment', estimateMinutes: 90 }],
    ['plan the next 4 hours', { type: 'plan_day', availableMinutes: 240 }],
    ['I have 2 hours before my meeting', { type: 'plan_day', availableMinutes: 120 }],
    ['plan my day', { type: 'plan_day', availableMinutes: 240 }],
    ['I have an exam tomorrow. Organize my evening', { type: 'plan_day', availableMinutes: 240 }],
  ])('parses %s', (input, expected) => {
    expect(parseCommand(input, options)).toMatchObject(expected);
  });

  it('leaves incomplete and ambiguous requests unresolved', () => {
    expect(parseCommand('add', options)).toBeNull();
    expect(parseCommand('do it', options)).toBeNull();
  });

  it.each([
    ['give me more time for DBMS', { type: 'revise_plan', focusTaskQuery: 'DBMS', extraMinutes: 30 }],
    ['add 45 minutes to DBMS', { type: 'revise_plan', focusTaskQuery: 'DBMS', extraMinutes: 45 }],
    ['give DBMS 2 hours', { type: 'revise_plan', focusTaskQuery: 'DBMS', extraMinutes: 120 }],
    ["don't schedule anything before 10am", { type: 'revise_plan', notBeforeText: '10am' }],
    ['do not schedule until 2pm', { type: 'revise_plan', notBeforeText: '2pm' }],
    ['i have a class at 2', { type: 'revise_plan', busyLabel: 'class', busyStartText: '2' }],
    ['write the section depends on research', { type: 'set_dependency', taskQuery: 'write the section', dependsOnTaskQuery: 'research' }],
    ['build depends on design', { type: 'set_dependency', taskQuery: 'build', dependsOnTaskQuery: 'design' }],
  ])('parses the planning revision %s', (input, expected) => {
    expect(parseCommand(input, options)).toMatchObject(expected);
  });

  it('removes a dependency when the user says a task is independent', () => {
    expect(parseCommand('DBMS is independent of research', options))
      .toMatchObject({ type: 'set_dependency', taskQuery: 'DBMS' });
  });

  it('does not treat ordinary task text as a plan revision', () => {
    expect(parseCommand('add write the section', options)).toMatchObject({ type: 'create_task' });
  });
});