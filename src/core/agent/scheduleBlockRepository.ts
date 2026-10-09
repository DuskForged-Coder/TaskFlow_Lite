import type { ScheduleBlock } from './dayPlan.js';

export interface ScheduleBlockRepository {
  createPlan(planId: string, blocks: readonly ScheduleBlock[]): ScheduleBlock[];
  listByPlan(planId: string): ScheduleBlock[];
  listOverlapping(startsAt: string, endsAt: string): ScheduleBlock[];
}