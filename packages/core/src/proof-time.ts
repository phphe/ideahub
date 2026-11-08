const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const RELATIVE_LIMIT_MS = 7 * DAY_MS;

export interface ProofTimeSource {
  /** Time text from a `Proof:` / `Published:` marker. */
  markerTime?: string | null;
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

export interface ParsedMarkerTime {
  instant: Date;
  /** Local wall-clock time, e.g. `2026-11-06 18:33:28`. */
  localText: string;
  /** Numeric UTC offset, e.g. `UTC+08:00`. */
  offset: string;
}

const MARKER_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) \((UTC)([+-])(\d{2}):(\d{2})\)$/;

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

function utcOffset(date: Date): string {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Section 7.1: `YYYY-MM-DD HH:mm:ss (UTC+08:00)` in system local time.
 */
export function formatMarkerTime(date: Date): string {
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
  return `${formatLocalDate(date)} ${time} (${utcOffset(date)})`;
}

/** Parses the marker time text into an absolute instant plus its offset. */
export function parseMarkerTime(
  value: string | null | undefined
): ParsedMarkerTime | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = MARKER_TIME_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetMinutes =
    (match[8] === '-' ? -1 : 1) * (Number(match[9]) * 60 + Number(match[10]));

  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const instant = new Date(wallClockAsUtc - offsetMinutes * MINUTE_MS);
  const reconstructed = new Date(instant.getTime() + offsetMinutes * MINUTE_MS);
  if (
    reconstructed.getUTCFullYear() !== year ||
    reconstructed.getUTCMonth() !== month - 1 ||
    reconstructed.getUTCDate() !== day ||
    reconstructed.getUTCHours() !== hour ||
    reconstructed.getUTCMinutes() !== minute ||
    reconstructed.getUTCSeconds() !== second
  ) {
    return null;
  }

  return {
    instant,
    localText: `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`,
    offset: `UTC${match[8]}${match[9]}:${match[10]}`
  };
}

/** Parses an ISO 8601 datetime; returns null for missing or invalid values. */
export function parsePublishedAt(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTooltip(date: Date): string {
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
  return `${formatLocalDate(date)} ${time}（${utcOffset(date)}）`;
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
 * Section 8.11: marker time wins, otherwise Release `published_at`.
 * Within 7 days a relative label is shown; older values use a localized
 * absolute date. Missing or unparsable input never renders `Invalid Date`.
 */
export function formatProofTime(
  source: ProofTimeSource,
  options: ProofTimeOptions
): ProofTimeDisplay {
  const marker = parseMarkerTime(source.markerTime);
  const publishedAt = marker ? null : parsePublishedAt(source.publishedAt);
  if (!marker && !publishedAt) {
    return { text: '未知', tooltip: '未知' };
  }

  const target = marker ? marker.instant : publishedAt!;
  const now = options.now;
  const diffMs = now.getTime() - target.getTime();
  const relative = formatRelative(diffMs);

  return {
    text:
      relative ?? formatAbsoluteDate(target, now, normalizeLocale(options.locale)),
    tooltip: marker ? `${marker.localText}（${marker.offset}）` : formatTooltip(target)
  };
}
