import { describe, expect, it } from 'vitest';
import {
  formatLocalDate,
  formatProofTime,
  normalizeLocale,
  parseMarkerDate,
  parsePublishedAt
} from '../src/core/proof-time';

const NOW = new Date(2026, 10, 5, 18, 33, 28);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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

describe('parseMarkerDate', () => {
  it('parses a valid local calendar date', () => {
    const date = parseMarkerDate('2026-11-05');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(10);
    expect(date?.getDate()).toBe(5);
  });

  it('rejects malformed and impossible dates', () => {
    expect(parseMarkerDate('2026-02-30')).toBeNull();
    expect(parseMarkerDate('not-a-date')).toBeNull();
    expect(parseMarkerDate(null)).toBeNull();
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
      formatProofTime({ publishedAt: publishedBefore(59 * 1000) }, { now: NOW, locale: 'zh-cn' })
        .text
    ).toBe('刚刚');
    expect(
      formatProofTime({ publishedAt: publishedBefore(MINUTE) }, { now: NOW, locale: 'zh-cn' })
        .text
    ).toBe('1 分钟前');
  });

  it('shows minutes, hours and the 23:59 boundary', () => {
    expect(
      formatProofTime({ publishedAt: publishedBefore(23 * HOUR + 59 * MINUTE) }, {
        now: NOW,
        locale: 'zh-cn'
      }).text
    ).toBe('23 小时前');
  });

  it('stays relative on exactly the 7th day and switches afterwards', () => {
    const target = new Date(NOW.getTime() - 7 * DAY);
    expect(
      formatProofTime({ publishedAt: publishedBefore(7 * DAY) }, { now: NOW, locale: 'zh-cn' }).text
    ).toBe('7 天前');
    expect(
      formatProofTime({ publishedAt: publishedBefore(7 * DAY + 1000) }, {
        now: NOW,
        locale: 'zh-cn'
      }).text
    ).toBe(absolute(target, false));
  });

  it('uses a localized absolute date within the current year', () => {
    expect(
      formatProofTime({ markerDate: '2026-10-01' }, { now: NOW, locale: 'zh-cn' }).text
    ).toBe('10月1日');
  });

  it('includes the year across calendar years', () => {
    expect(
      formatProofTime(
        { markerDate: '2025-11-02' },
        { now: new Date(2026, 0, 5, 12, 0, 0), locale: 'zh-cn' }
      ).text
    ).toBe('2025年11月2日');
  });
});

describe('formatProofTime source selection', () => {
  it('prefers the marker date over published_at', () => {
    expect(
      formatProofTime(
        { markerDate: '2026-11-05', publishedAt: '2020-01-01T00:00:00Z' },
        { now: NOW, locale: 'zh-cn' }
      ).text
    ).toBe('18 小时前');
  });

  it('falls back to published_at when the marker date is missing or invalid', () => {
    expect(
      formatProofTime({ markerDate: '2026-02-30', publishedAt: publishedBefore(59 * 1000) }, {
        now: NOW,
        locale: 'zh-cn'
      }).text
    ).toBe('刚刚');
  });

  it('shows 未知 instead of Invalid Date for missing or unparsable input', () => {
    expect(formatProofTime({}, { now: NOW, locale: 'zh-cn' })).toEqual({
      text: '未知',
      tooltip: '未知'
    });
    expect(
      formatProofTime({ markerDate: 'oops', publishedAt: 'oops' }, { now: NOW, locale: 'zh-cn' })
        .text
    ).toBe('未知');
  });

  it('renders a full tooltip with the system UTC offset', () => {
    const tooltip = formatProofTime(
      { publishedAt: publishedBefore(0) },
      { now: NOW, locale: 'zh-cn' }
    ).tooltip;
    expect(tooltip).toMatch(/^2026-11-05 18:33:28（UTC[+-]\d{2}:\d{2}）$/);
  });
});
