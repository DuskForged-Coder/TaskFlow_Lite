import { z } from 'zod';

const confidence = z.number().finite().min(0).max(1);
const taskQuery = z.string().trim().min(1).max(200);
const dueText = z.string().trim().min(1).max(160);
const availableMinutes = z.number().int().min(15).max(960);

export const intentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_task'), title: z.string().trim().min(1).max(200), dueText: dueText.optional(), confidence }).strict(),
  z.object({ type: z.literal('list_tasks'), scope: z.enum(['all', 'today', 'week', 'overdue']), query: z.string().trim().max(200).optional(), confidence }).strict(),
  z.object({ type: z.literal('complete_task'), taskQuery, confidence }).strict(),
  z.object({ type: z.literal('reopen_task'), taskQuery, confidence }).strict(),
  z.object({ type: z.literal('delete_task'), taskQuery, confidence }).strict(),
  z.object({ type: z.literal('restore_task'), taskQuery, confidence }).strict(),
  z.object({ type: z.literal('set_deadline'), taskQuery, dueText, confidence }).strict(),
  z.object({ type: z.literal('set_priority'), taskQuery, priority: z.enum(['low', 'normal', 'high', 'urgent']), confidence }).strict(),
  z.object({ type: z.literal('set_estimate'), taskQuery, estimateMinutes: z.number().int().min(5).max(600), confidence }).strict(),
  z.object({ type: z.literal('plan_day'), availableMinutes, confidence }).strict(),
  z.object({ type: z.literal('revise_plan'), availableMinutes: availableMinutes.optional(), focusTaskQuery: taskQuery.optional(), extraMinutes: z.number().int().min(5).max(600).optional(), notBeforeText: dueText.optional(), busyLabel: z.string().trim().min(1).max(80).optional(), busyStartText: dueText.optional(), confidence }).strict(),
  z.object({ type: z.literal('set_dependency'), taskQuery, dependsOnTaskQuery: taskQuery.optional(), confidence }).strict(),
  z.object({ type: z.literal('create_project'), projectName: z.string().trim().min(1).max(80), confidence }).strict(),
  z.object({ type: z.literal('assign_project'), taskQuery, projectName: z.string().trim().min(1).max(80), confidence }).strict(),
  z.object({ type: z.literal('list_projects'), confidence }).strict(),
  z.object({ type: z.literal('recommend_next_task'), confidence }).strict(),
  z.object({ type: z.literal('undo_last_change'), taskQuery, confidence }).strict(),
]);

export type TaskIntent = z.infer<typeof intentSchema>;