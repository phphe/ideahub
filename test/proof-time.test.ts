import { describe, expect, it } from 'vitest';
import {
  formatLocalDate,
  formatMarkerTime,
  formatProofTime,
  normalizeLocale,
  parseMarkerTime,
  parsePublishedAt
} from '../src/core/proof-time';

const NOW = new Date('2026-11-06T10:33:28.000Z'); // 2026-11-06 18:33:28 (UTC+08:00)
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function markerTime(msOffset: number): string {
  // Marker times carry their own offset, so tests do not depend on the host TZ.
  const wallClock = new Date(NOW.getTime() - msOffset + 8 * HOUR).toISOString();
  return `${wallClock.slice(0, 10)} ${wallClock.slice(11, 19)} (UTC+08:00)`;
}

function publishedBefore(diffMs: number): string {
  return new Date(NOW.getTime() - diffMs).toISOString();
}

function absolute(date: Date, withYear: boolean): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {})
  }).format(date);
}

describe('normalizeLocale', () => {
  it('maps VS Code language ids to Intl locales', () => {
    expect(normalizeLocale('zh-cn')).toBe('zh-CN');
    expect(normalizeLocale('en-us')).toBe('en-US');
    expect(normalizeLocale('zh')).toBe('zh');
    expect(normalizeLocale(undefined)).toBe('zh-CN');
  });
});

describe('formatMarkerTime', () => {
  it('renders local seconds with a numeric UTC offset', () => {
    const date = new Date(2026, 10, 6, 18, 33, 28);
    const formatted = formatMarkerTime(date);
    expect(formatted).toMatch(/^2026-11-06 18:33:28 \(UTC[+-]\d{2}:\d{2}\)$/);

    const parsed = parseMarkerTime(formatted);
    expect(parsed?.localText).toBe('2026-11-06 18:33:28');
    expect(parsed?.instant.getTime()).toBe(date.getTime());
  });
});

describe('parseMarkerTime', () => {
  it('parses a positive offset into an absolute instant', () => {
    expect(parseMarkerTime('2026-11-06 18:33:28 (UTC+08:00)')).toMatchObject({
      localText: '2026-11-06 18:33:28',
      offset: 'UTC+08:00'
    });
    expect(parseMarkerTime('2026-11-06 18:33:28 (UTC+08:00)')?.instant.toISOString()).toBe(
      '2026-11-06T10:33:28.000Z'
    );
  });

  it('parses a negative offset and can cross the UTC date boundary', () => {
    expect(
      parseMarkerTime('2025-12-31 23:00:00 (UTC-05:00)')?.instant.toISOString()
    ).toBe('2026-01-01T04:00:00.000Z');
  });

  it('rejects malformed and impossible values', () => {
    expect(parseMarkerTime('2026-11-06 18:33:28')).toBeNull();
    expect(parseMarkerTime('2026-11-06 18:33:28（UTC+08:00）')).toBeNull();
    expect(parseMarkerTime('2026-13-06 18:33:28 (UTC+08:00)')).toBeNull();
    expect(parseMarkerTime('2026-02-30 18:33:28 (UTC+08:00)')).toBeNull();
    expect(parseMarkerTime(null)).toBeNull();
  });
});

describe('parsePublishedAt', () => {
  it('rejects invalid values', () => {
    expect(parsePublishedAt('nope')).toBeNull();
    expect(parsePublishedAt('')).toBeNull();
    expect(parsePublishedAt(publishedBefore(0))).not.toBeNull();
  });
});

describe('formatLocalDate', () => {
  it('formats local date parts with padding', () => {
    expect(formatLocalDate(new Date(2026, 0, 2, 23, 59))).toBe('2026-01-02');
  });
});

describe('formatProofTime relative boundaries', () => {
  it('shows 刚刚 below 60 seconds and 1 分钟前 at exactly 60 seconds', () => {
    expect(
      formatProofTime({ markerTime: markerTime(59 * 1000) }, { now: NOW, locale: 'zh-cn' }).text
    ).toBe('刚刚');
    expect(
      formatProofTime({ markerTime: markerTime(MINUTE) }, { now: NOW, locale: 'zh-cn' }).text
    ).toBe('1 分钟前');
  });

  it('shows hours up to the 24 hour boundary', () => {
    expect(
      formatProofTime({ markerTime: markerTime(23 * HOUR + 59 * MINUTE) }, {
        now: NOW,
        locale: 'zh-cn'
      }).text
    ).toBe('23 小时前');
  });

  it('stays relative on exactly the 7th day and switches afterwards', () => {
    expect(
      formatProofTime({ markerTime: markerTime(7 * DAY) }, { now: NOW, locale: 'zh-cn' }).text
    ).toBe('7 天前');
    expect(
      formatProofTime({ markerTime: markerTime(7 * DAY + 1000) }, {
        now: NOW,
        locale: 'zh-cn'
      }).text
    ).toBe(absolute(new Date(NOW.getTime() - 7 * DAY - 1000), false));
  });

  it('includes the year across calendar years', () => {
    const target = new Date('2025-12-31T04:00:00.000Z');
    expect(
      formatProofTime(
        { markerTime: '2025-12-31 12:00:00 (UTC+08:00)' },
        { now: new Date('2026-01-10T12:00:00.000Z'), locale: 'zh-cn' }
      ).text
    ).toBe(absolute(target, true));
  });
});

describe('formatProofTime source selection', () => {
  it('prefers the marker time over published_at', () => {
    expect(
      formatProofTime(
        { markerTime: '2026-11-05 18:33:28 (UTC+08:00)', publishedAt: '2020-01-01T00:00:00Z' },
        { now: NOW, locale: 'zh-cn' }
      ).text
    ).toBe('1 天前');
  });

  it('falls back to published_at when the marker time is missing or invalid', () => {
    expect(
      formatProofTime(
        { markerTime: '2026-13-06 18:33:28 (UTC+08:00)', publishedAt: publishedBefore(59 * 1000) },
        { now: NOW, locale: 'zh-cn' }
      ).text
    ).toBe('刚刚');
  });

  it('shows 未知 instead of Invalid Date for missing or unparsable input', () => {
    expect(formatProofTime({}, { now: NOW, locale: 'zh-cn' })).toEqual({
      text: '未知',
      tooltip: '未知'
    });
    expect(
      formatProofTime({ markerTime: 'oops', publishedAt: 'oops' }, { now: NOW, locale: 'zh-cn' })
        .text
    ).toBe('未知');
  });

  it('shows the marker time verbatim in the tooltip', () => {
    expect(
      formatProofTime({ markerTime: '2026-11-06 18:33:28 (UTC+08:00)' }, {
        now: NOW,
        locale: 'zh-cn'
      }).tooltip
    ).toBe('2026-11-06 18:33:28（UTC+08:00）');
  });

  it('renders a full tooltip with the system UTC offset for published_at', () => {
    const tooltip = formatProofTime(
      { publishedAt: publishedBefore(0) },
      { now: NOW, locale: 'zh-cn' }
    ).tooltip;
    expect(tooltip).toMatch(/^2026-11-\d{2} \d{2}:\d{2}:\d{2}（UTC[+-]\d{2}:\d{2}）$/);
  });
});
