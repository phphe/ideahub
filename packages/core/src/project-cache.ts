import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { IDEAS_FILE } from './projects';
import type { ProjectSummary } from './status';

/** Section 8.7: keep the parsed list summaries in memory, never on disk. */
export const PROJECT_CACHE_LIMIT = 1000;

interface CacheEntry {
  version: string;
  summary: ProjectSummary;
}

function cacheKey(root: string, name: string): string {
  return path.resolve(root, name, IDEAS_FILE).toLowerCase();
}

/**
 * Process-wide memo for `ideas.md` parsing. Entries are keyed by the lower-cased
 * absolute path and validated against `${mtimeMs}:${size}` before reuse, so a
 * cache hit skips the file read but never serves stale content. Only the derived
 * summary is kept; the raw text, git output and Release data stay outside.
 */
export class ProjectParseCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<ProjectSummary>>();

  constructor(
    private readonly parse: (name: string, text: string) => ProjectSummary,
    private readonly limit = PROJECT_CACHE_LIMIT
  ) {}

  public size(): number {
    return this.entries.size;
  }

  public has(root: string, name: string): boolean {
    return this.entries.has(cacheKey(root, name));
  }

  /** Section 8.7: watcher change/delete drops the entry; the next read is lazy. */
  public invalidate(root: string, name: string): void {
    this.entries.delete(cacheKey(root, name));
  }

  public clear(): void {
    this.entries.clear();
  }

  public async summarize(root: string, name: string): Promise<ProjectSummary> {
    const file = path.resolve(root, name, IDEAS_FILE);
    const key = file.toLowerCase();
    const pending = this.inFlight.get(key);
    if (pending) {
      return pending;
    }
    const tracked = this.load(key, file, name);
    this.inFlight.set(key, tracked);
    const release = (): void => {
      if (this.inFlight.get(key) === tracked) {
        this.inFlight.delete(key);
      }
    };
    void tracked.then(release, release);
    return tracked;
  }

  private async load(
    key: string,
    file: string,
    name: string
  ): Promise<ProjectSummary> {
    const stats = await fs.stat(file);
    const version = `${stats.mtimeMs}:${stats.size}`;
    const cached = this.entries.get(key);
    if (cached && cached.version === version) {
      // Refreshing insertion order keeps eviction least-recently-used.
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.summary;
    }

    const text = await fs.readFile(file, 'utf8');
    const summary: ProjectSummary = {
      ...this.parse(name, text),
      updatedAt: stats.mtimeMs
    };
    this.store(key, { version, summary });
    return summary;
  }

  private store(key: string, entry: CacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        return;
      }
      this.entries.delete(oldest.value);
    }
  }
}
