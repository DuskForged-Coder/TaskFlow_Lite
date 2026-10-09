import type Database from 'better-sqlite3';
import { DatabaseError } from '../../core/errors.js';
import type { ScheduleBlock } from '../../core/agent/dayPlan.js';
import type { ScheduleBlockRepository } from '../../core/agent/scheduleBlockRepository.js';

type ScheduleBlockRow = {
  id: string;
  plan_id: string;
  task_id: string | null;
  label: string;
  kind: ScheduleBlock['kind'];
  starts_at: string;
  ends_at: string;
  created_at: string;
};

export class SqliteScheduleBlockRepository implements ScheduleBlockRepository {
  constructor(private readonly database: Database.Database) {}

  createPlan(planId: string, blocks: readonly ScheduleBlock[]): ScheduleBlock[] {
    try {
      const insert = this.database.prepare(`
        INSERT INTO schedule_blocks (id, plan_id, task_id, label, kind, starts_at, ends_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const transaction = this.database.transaction(() => {
        for (const block of blocks) {
          insert.run(block.id, planId, block.taskId, block.label, block.kind, block.startsAt, block.endsAt, block.createdAt);
        }
        return this.listByPlan(planId);
      });
      return transaction.immediate();
    } catch (cause) {
      throw new DatabaseError('Could not apply the approved TaskFlow plan.', { cause });
    }
  }

  listByPlan(planId: string): ScheduleBlock[] {
    const rows = this.database.prepare(
      'SELECT * FROM schedule_blocks WHERE plan_id = ? ORDER BY starts_at',
    ).all(planId) as ScheduleBlockRow[];
    return rows.map(fromRow);
  }

  listOverlapping(startsAt: string, endsAt: string): ScheduleBlock[] {
    const rows = this.database.prepare(
      'SELECT * FROM schedule_blocks WHERE starts_at < ? AND ends_at > ? ORDER BY starts_at',
    ).all(endsAt, startsAt) as ScheduleBlockRow[];
    return rows.map(fromRow);
  }
}

function fromRow(row: ScheduleBlockRow): ScheduleBlock {
  return {
    id: row.id,
    planId: row.plan_id,
    taskId: row.task_id,
    label: row.label,
    kind: row.kind,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
  };
}