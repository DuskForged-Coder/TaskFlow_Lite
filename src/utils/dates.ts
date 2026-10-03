import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';
import { UserError } from '../core/errors.js';

export interface ParsedNaturalDate {
  value: string;
  matchedText: string;
}

export function parseNaturalDate(
  text: string,
  options: { now?: Date; timezone: string },
): ParsedNaturalDate {
  const now = options.now ?? new Date();
  const localNow = DateTime.fromJSDate(now, { zone: options.timezone });
  if (!localNow.isValid) throw new UserError('TaskFlow is configured with an invalid timezone.');

  const duration = text.match(/^\s*in\s+(\d+(?:\.\d+)?)\s+(hours?|minutes?)\s*$/i);
  if (duration?.[1] && duration[2]) {
    const amount = Number(duration[1]);
    const unit = duration[2].toLowerCase().startsWith('hour') ? 'hours' : 'minutes';
    return toParsedDate(localNow.plus({ [unit]: amount }), text);
  }

  if (/^\s*next week\s*$/i.test(text)) {
    const nextMonday = localNow.startOf('week').plus({ weeks: 1 }).set({ hour: 9 });
    return toParsedDate(nextMonday, text);
  }

  if (/^\s*tonight\s*$/i.test(text)) {
    return toParsedDate(localNow.startOf('day').set({ hour: 20 }), text);
  }

  const results = chrono.parse(
    text,
    { instant: now, timezone: localNow.offset },
    { forwardDate: true },
  );
  const result = results[0];
  if (!result) throw new UserError(`I couldn't understand the date "${text}".`);

  const components = result.start;
  const hourIsCertain = components.isCertain('hour');
  const parsed = DateTime.fromObject({
    year: components.get('year') ?? localNow.year,
    month: components.get('month') ?? localNow.month,
    day: components.get('day') ?? localNow.day,
    hour: hourIsCertain ? components.get('hour') ?? 9 : /\btonight\b/i.test(text) ? 20 : 9,
    minute: components.isCertain('minute') ? components.get('minute') ?? 0 : 0,
    second: components.isCertain('second') ? components.get('second') ?? 0 : 0,
    millisecond: 0,
  }, { zone: options.timezone });

  if (!parsed.isValid) throw new UserError('That date or time does not exist in the configured timezone.');
  return toParsedDate(parsed, result.text);
}

export function formatTaskDate(value: string, timezone: string): string {
  const date = DateTime.fromISO(value, { zone: 'utc' }).setZone(timezone);
  if (!date.isValid) return 'Invalid date';
  return date.toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY);
}

function toParsedDate(date: DateTime, matchedText: string): ParsedNaturalDate {
  if (!date.isValid) throw new UserError('That date or time could not be resolved.');
  const value = date.toUTC().toISO({ suppressMilliseconds: false });
  if (!value) throw new UserError('That date or time could not be resolved.');
  return { value, matchedText };
}