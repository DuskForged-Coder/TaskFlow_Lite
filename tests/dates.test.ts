import { describe, expect, it } from 'vitest';
import { parseNaturalDate } from '../src/utils/dates.js';

describe('parseNaturalDate', () => {
  const utcNow = new Date('2026-09-30T12:34:56.000Z');

  it('interprets today and tomorrow at the documented 9 AM default', () => {
    expect(parseNaturalDate('today', { now: utcNow, timezone: 'UTC' }).value)
      .toBe('2026-09-30T09:00:00.000Z');
    expect(parseNaturalDate('tomorrow', { now: utcNow, timezone: 'UTC' }).value)
      .toBe('2026-10-01T09:00:00.000Z');
  });

  it('resolves next weekdays and next week in the selected timezone', () => {
    expect(parseNaturalDate('next Monday', { now: utcNow, timezone: 'UTC' }).value)
      .toBe('2026-10-05T09:00:00.000Z');
    expect(parseNaturalDate('next week', { now: utcNow, timezone: 'UTC' }).value)
      .toBe('2026-10-05T09:00:00.000Z');
  });

  it('parses explicit dates and times', () => {
    expect(parseNaturalDate('October 10 at 3pm', { now: utcNow, timezone: 'UTC' }).value)
      .toBe('2026-10-10T15:00:00.000Z');
  });

  it('preserves elapsed time for an explicit relative duration', () => {
    expect(parseNaturalDate('in 2 hours', { now: utcNow, timezone: 'UTC' }).value)
      .toBe('2026-09-30T14:34:56.000Z');
  });

  it('converts a half-hour timezone offset to UTC correctly', () => {
    expect(parseNaturalDate('tomorrow at 6pm', { now: utcNow, timezone: 'Asia/Kolkata' }).value)
      .toBe('2026-10-01T12:30:00.000Z');
  });

  it('uses the destination date timezone offset across a DST transition', () => {
    const beforeDst = new Date('2026-03-07T17:00:00.000Z');
    expect(parseNaturalDate('tomorrow at 9am', { now: beforeDst, timezone: 'America/New_York' }).value)
      .toBe('2026-03-08T13:00:00.000Z');
  });

  it('defaults tonight to 8 PM local time', () => {
    expect(parseNaturalDate('tonight', { now: utcNow, timezone: 'UTC' }).value)
      .toBe('2026-09-30T20:00:00.000Z');
  });
});