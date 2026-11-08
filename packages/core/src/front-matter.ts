/**
 * Section 6.9: the optional YAML front matter at the top of `ideas.md`.
 *
 * Only the small subset needed by project tags is supported: block lists
 * (`tags:` followed by `  - x`) and inline lists (`tags: [a, b]`). Quoted
 * scalars are unquoted. A missing or malformed block always means "no tags";
 * parsing never throws and never blocks loading a project.
 */

export interface FrontMatterRange {
  /** Index of the opening `---` line. */
  startLine: number;
  /** Index of the closing `---` / `...` line. */
  endLine: number;
}

const TAGS_KEY = /^tags[ \t]*:/;

/**
 * Finds a standard front matter block: `---` on the first line (after an
 * optional BOM) and a closing `---` or `...` line. Anything else is treated
 * as ordinary content.
 */
export function findFrontMatter(text: string): FrontMatterRange | null {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) {
    return null;
  }
  const opening = lines[0].replace(/^\uFEFF/, '').trimEnd();
  if (opening !== '---') {
    return null;
  }
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    if (line === '---' || line === '...') {
      return { startLine: 0, endLine: index };
    }
  }
  return null;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (first === '"' && last === '"') {
      return trimmed.slice(1, -1).replace(/\\(["\\])/g, '$1');
    }
    if (first === "'" && last === "'") {
      return trimmed.slice(1, -1).replace(/''/g, "'");
    }
  }
  return trimmed;
}

/** Splits `[a, b]` while ignoring commas inside quotes. */
function parseInlineList(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return null;
  }
  const body = trimmed.slice(1, -1);
  const items: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of body) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === '\\' && quote === '"') {
        current += char;
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ',') {
      items.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (quote) {
    return null;
  }
  items.push(current);
  return items
    .map((item) => stripQuotes(item))
    .filter((item) => item.length > 0);
}

function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(tag);
  }
  return result;
}

/** Reads the `tags` array from the optional front matter; invalid means none. */
export function parseTags(text: string): string[] {
  const range = findFrontMatter(text);
  if (!range) {
    return [];
  }
  const lines = text.split(/\r?\n/);
  let keyIndex = -1;
  for (let index = range.startLine + 1; index < range.endLine; index += 1) {
    if (TAGS_KEY.test(lines[index])) {
      keyIndex = index;
      break;
    }
  }
  if (keyIndex < 0) {
    return [];
  }

  const keyMatch = /^tags[ \t]*:([^\r\n]*)$/.exec(lines[keyIndex]);
  if (!keyMatch) {
    return [];
  }
  const rest = keyMatch[1].trim();
  if (rest.length > 0) {
    const inline = parseInlineList(rest);
    return inline ? uniqueTags(inline) : [];
  }

  const items: string[] = [];
  for (let index = keyIndex + 1; index < range.endLine; index += 1) {
    const match = /^\s*-(?:\s*)(.*)$/.exec(lines[index]);
    if (!match) {
      break;
    }
    const tag = stripQuotes(match[1]);
    if (tag.length > 0) {
      items.push(tag);
    }
  }
  return uniqueTags(items);
}

/** Section 6.9: `,` `，` and `、` separate tags; semicolons do not. */
export function parseTagInput(input: string): string[] {
  return uniqueTags(
    input
      .split(/[,，、]/)
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0)
  );
}

function formatScalar(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function inlineTags(tags: string[]): string {
  return tags.length > 0
    ? `tags: [${tags.map(formatScalar).join(', ')}]`
    : 'tags: []';
}

/** Separates a trailing `# comment` from a value, ignoring quoted hashes. */
function splitComment(value: string): { value: string; comment: string } {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === '\\' && quote === '"') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) {
      return { value: value.slice(0, index), comment: value.slice(index) };
    }
  }
  return { value, comment: '' };
}

/**
 * Section 6.9: rewrites only the `tags` section, so other keys, comments,
 * indentation and key order stay byte-for-byte untouched. A file without
 * front matter gets a new block after the BOM, following the file's EOL.
 */
export function updateTags(text: string, tags: string[]): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const nextTags = uniqueTags(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0));
  const range = findFrontMatter(text);

  if (!range) {
    if (nextTags.length === 0) {
      return text;
    }
    const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
    const body = bom ? text.slice(1) : text;
    const block = ['---', inlineTags(nextTags), '---'];
    const prefix = block.join(eol) + eol;
    return `${bom}${prefix}${body.length > 0 ? eol : ''}${body}`;
  }

  const lines = text.split(/\r?\n/);
  let keyIndex = -1;
  for (let index = range.startLine + 1; index < range.endLine; index += 1) {
    if (TAGS_KEY.test(lines[index])) {
      keyIndex = index;
      break;
    }
  }

  if (keyIndex < 0) {
    if (nextTags.length === 0) {
      return text;
    }
    lines.splice(range.endLine, 0, inlineTags(nextTags));
    return lines.join(eol);
  }

  const keyMatch = /^tags[ \t]*:([^\r\n]*)$/.exec(lines[keyIndex]);
  if (!keyMatch) {
    return text;
  }
  const { comment } = splitComment(keyMatch[1]);

  // Section 6.9: an existing block list is condensed into one inline array.
  let blockEnd = keyIndex;
  for (let index = keyIndex + 1; index < range.endLine; index += 1) {
    if (!/^\s*-(?:\s|$)/.test(lines[index])) {
      break;
    }
    blockEnd = index;
  }

  const suffix = comment ? ` ${comment}` : '';
  lines.splice(keyIndex, blockEnd - keyIndex + 1, `${inlineTags(nextTags)}${suffix}`);
  return lines.join(eol);
}
