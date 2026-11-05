const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const RELATIVE_LIMIT_MS = 7 * DAY_MS;

export interface ProofTimeSource {
  /** `date=YYYY-MM-DD` from the marker. */
  markerDate?: string | null;
  /** Release `published_at` in ISO 8601 UTC. */
  publishedAt?: string | null;
}

export interface ProofTimeOptions {
  now: Date;
  /** VS Code language, e.g. `zh-cn`; normalized before use. */
  locale?: string | null;
}

export interface ProofTimeDisplay {
  text: string;
  tooltip: string;
}

const MARKER_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normalizeLocale(language: string | null | undefined): string {
  if (typeof language !== 'string' || language.trim().length === 0) {
    return 'zh-CN';
  }
  const parts = language.trim().split('-');
  const languagePart = parts[0].toLowerCase();
  const region = parts.length > 1 ? parts[1].toUpperCase() : '';
  return region ? `${languagePart}-${region}` : languagePart;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Formats a Date as the local calendar date `YYYY-MM-DD`. */
export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Parses `YYYY-MM-DD` as local midnight. Malformed or impossible calendar
 * dates (e.g. `2026-02-30`) return null.
 */
export function parseMarkerDate(value: string | null | undefined): Date | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = MARKER_DATE_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Parses an ISO 8601 datetime; returns null for missing or invalid values. */
export function parsePublishedAt(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function formatTooltip(date: Date, withTime: boolean): string {
  const datePart = formatLocalDate(date);
  if (!withTime) {
    return `${datePart}（${utcOffset(date)}）`;
  }
  const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
  return `${datePart} ${timePart}（${utcOffset(date)}）`;
}

function formatAbsoluteDate(date: Date, now: Date, locale: string): string {
  const crossYear = date.getFullYear() !== now.getFullYear();
  const options: Intl.DateTimeFormatOptions = {
    month: 'long',
    day: 'numeric',
    ...(crossYear ? { year: 'numeric' } : {})
  };
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat('zh-CN', options).format(date);
  }
}

function formatRelative(diffMs: number): string | null {
  if (diffMs < MINUTE_MS) {
    return '刚刚';
  }
  if (diffMs < HOUR_MS) {
    return `${Math.floor(diffMs / MINUTE_MS)} 分钟前`;
  }
  if (diffMs < DAY_MS) {
    return `${Math.floor(diffMs / HOUR_MS)} 小时前`;
  }
  if (diffMs <= RELATIVE_LIMIT_MS) {
    return `${Math.floor(diffMs / DAY_MS)} 天前`;
  }
  return null;
}

/**
 * Section 8.11: marker `date=` wins, otherwise the Release `published_at`.
 * Within 7 days a relative label is shown; older values use a localized
 * absolute date. Missing or unparsable input never renders `Invalid Date`.
 */
export function formatProofTime(
  source: ProofTimeSource,
  options: ProofTimeOptions
): ProofTimeDisplay {
  const markerDate = parseMarkerDate(source.markerDate);
  const publishedAt = markerDate ? null : parsePublishedAt(source.publishedAt);
  if (!markerDate && !publishedAt) {
    return { text: '未知', tooltip: '未知' };
  }

  const hasTime = markerDate === null;
  const target = markerDate ?? publishedAt!;
  const now = options.now;
  const diffMs = now.getTime() - target.getTime();
  const relative = formatRelative(diffMs);

  return {
    text:
      relative ??
      formatAbsoluteDate(target, now, normalizeLocale(options.locale)),
    tooltip: formatTooltip(target, hasTime)
  };
}
