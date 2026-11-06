import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { ProjectSummary, WorkspaceState } from '../src/core/status';
import { PROJECT_FILTER_THRESHOLD, renderMainHtml } from '../src/ui/html';

function project(name: string, options: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    name,
    proofCount: 1,
    proofTags: [],
    publishedCount: 0,
    hasNewContent: false,
    canPublish: false,
    tags: [],
    ...options
  };
}

function localState(projects: ProjectSummary[]): WorkspaceState {
  return {
    kind: 'local',
    root: 'C:/repo',
    remote: null,
    configError: null,
    remoteDirExists: false,
    issues: [],
    projects
  };
}

function scriptOf(html: string): string {
  const match = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('webview script not found');
  }
  return match[1];
}

interface FakeItem {
  dataset: Record<string, string>;
  hidden: boolean;
  querySelector(selector: string): { innerHTML: string } | null;
}

class FakeClassList {
  private readonly names = new Set<string>();

  constructor(className: string) {
    for (const name of className.split(/\s+/)) {
      if (name) {
        this.names.add(name);
      }
    }
  }

  public toggle(name: string, force?: boolean): void {
    const on = force === undefined ? !this.names.has(name) : force;
    if (on) {
      this.names.add(name);
    } else {
      this.names.delete(name);
    }
  }

  public contains(name: string): boolean {
    return this.names.has(name);
  }
}

interface FakeChip {
  dataset: Record<string, string>;
  classList: FakeClassList;
  attributes: Record<string, string>;
  setAttribute(name: string, value: string): void;
}

interface FakeInput {
  id: string;
  tagName: string;
  value: string;
  focused: boolean;
  focus(): void;
  blur(): void;
}

function itemsFrom(html: string): FakeItem[] {
  const items: FakeItem[] = [];
  const itemPattern = /<li class="project"[^>]*data-project-item="([^"]+)"[^>]*>/g;
  const attribute = (attrs: string, name: string): string => {
    const match = new RegExp(`${name}="([^"]*)"`).exec(attrs);
    return match ? match[1] : '';
  };
  for (const match of html.matchAll(itemPattern)) {
    const badge = { innerHTML: '' };
    items.push({
      dataset: {
        projectItem: match[1],
        hasNew: attribute(match[0], 'data-has-new'),
        canPublish: attribute(match[0], 'data-can-publish'),
        published: attribute(match[0], 'data-published')
      },
      hidden: false,
      querySelector: (selector) => (selector === '[data-project-badges]' ? badge : null)
    });
  }
  return items;
}

function chipsFrom(html: string): FakeChip[] {
  const chips: FakeChip[] = [];
  const chipPattern =
    /<button class="(chip[^"]*)" data-chip="([^"]+)" aria-pressed="([^"]+)">([^<]*)<\/button>/g;
  for (const match of html.matchAll(chipPattern)) {
    chips.push({
      dataset: { chip: match[2] },
      classList: new FakeClassList(match[1]),
      attributes: { 'aria-pressed': match[3], text: match[4] },
      setAttribute(name, value) {
        this.attributes[name] = value;
      }
    });
  }
  return chips;
}

interface Harness {
  items: FakeItem[];
  chips: FakeChip[];
  input: FakeInput;
  hint: { hidden: boolean };
  messages: unknown[];
  state(): { filterQuery?: string; filterChip?: string; filterTag?: string };
  input_(value: string): void;
  clickChip(chip: FakeChip): void;
  keydown(event: {
    key: string;
    target: unknown;
    preventDefault(): void;
  }): void;
  send(data: unknown): void;
}

function run(
  html: string,
  saved?: { filterQuery?: string; filterChip?: string; filterTag?: string }
): Harness {
  const items = itemsFrom(html);
  const chips = chipsFrom(html);
  const hint = { hidden: true };
  const input: FakeInput = {
    id: 'project-filter',
    tagName: 'INPUT',
    value: '',
    focused: false,
    focus() {
      this.focused = true;
    },
    blur() {
      this.focused = false;
    }
  };
  const handlers: Record<string, (event: unknown) => void> = {};
  const messages: unknown[] = [];
  let persisted = saved ?? {};
  const documentStub = {
    activeElement: null,
    getElementById: (id: string) =>
      id === 'project-filter' ? input : id === 'project-filter-empty' ? hint : null,
    querySelectorAll: (selector: string) => {
      if (selector === '[data-project-item]') {
        return items;
      }
      if (selector === '[data-chip]') {
        return chips;
      }
      return [];
    },
    addEventListener: (type: string, callback: (event: unknown) => void) => {
      handlers[type] = callback;
    }
  };
  const windowStub = {
    addEventListener: (type: string, callback: (event: unknown) => void) => {
      if (type === 'message') {
        handlers.message = callback;
      }
    }
  };
  vm.runInNewContext(scriptOf(html), {
    document: documentStub,
    window: windowStub,
    acquireVsCodeApi: () => ({
      postMessage: (message: unknown) => messages.push(message),
      getState: () => persisted,
      setState: (next: { filterQuery?: string; filterChip?: string; filterTag?: string }) => {
        persisted = next;
      }
    }),
    String
  });

  return {
    items,
    chips,
    input,
    hint,
    messages,
    state: () => persisted,
    input_(value: string) {
      input.value = value;
      handlers.input?.({ target: input });
    },
    clickChip(chip: FakeChip) {
      handlers.click?.({
        target: {
          closest: (selector: string) => (selector === '[data-chip]' ? chip : null)
        }
      });
    },
    keydown(event) {
      handlers.keydown?.({
        key: event.key,
        target: event.target,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        preventDefault: event.preventDefault
      });
    },
    send(data: unknown) {
      handlers.message?.({ data });
    }
  };
}

function twelveProjects(): ProjectSummary[] {
  return [
    project('MyGame2', { hasNewContent: true }),
    project('MyGame', { canPublish: true }),
    project('Other2', { publishedCount: 3 }),
    ...Array.from({ length: PROJECT_FILTER_THRESHOLD - 2 }, (_value, index) =>
      project(`Filler${index}`)
    )
  ];
}

describe('project filter webview behaviour', () => {
  it('splits the query on whitespace and requires every term (AND)', () => {
    const harness = run(renderMainHtml(localState(twelveProjects())));

    harness.input_('GAME 2');

    const visible = harness.items
      .filter((item) => !item.hidden)
      .map((item) => item.dataset.projectItem);
    expect(visible).toEqual(['MyGame2']);
    expect(harness.messages).toHaveLength(0);
  });

  it('shows the empty hint when nothing matches', () => {
    const harness = run(renderMainHtml(localState(twelveProjects())));

    harness.input_('no-such-project');

    expect(harness.items.every((item) => item.hidden)).toBe(true);
    expect(harness.hint.hidden).toBe(false);

    harness.input_('');
    expect(harness.hint.hidden).toBe(true);
  });

  it('filters with chips and combines them with the query (AND)', () => {
    const harness = run(renderMainHtml(localState(twelveProjects())));
    const chip = (id: string): FakeChip => {
      const found = harness.chips.find((entry) => entry.dataset.chip === id);
      if (!found) {
        throw new Error(`chip ${id} not rendered`);
      }
      return found;
    };

    harness.clickChip(chip('new'));
    expect(harness.items.filter((item) => !item.hidden).map((item) => item.dataset.projectItem))
      .toEqual(['MyGame2']);
    expect(chip('new').classList.contains('active')).toBe(true);
    expect(chip('all').classList.contains('active')).toBe(false);

    harness.input_('game');
    expect(harness.items.filter((item) => !item.hidden).map((item) => item.dataset.projectItem))
      .toEqual(['MyGame2']);
    expect(harness.messages).toHaveLength(0);

    harness.input_('');
    harness.clickChip(chip('unpublished'));
    const unpublished = harness.items
      .filter((item) => !item.hidden)
      .map((item) => item.dataset.projectItem);
    expect(unpublished).not.toContain('Other2');
    expect(unpublished).toHaveLength(10);
  });

  it('persists the query and chip, so a full re-render keeps filtering', () => {
    const harness = run(renderMainHtml(localState(twelveProjects())));
    harness.input_('game');
    harness.clickChip(harness.chips.find((chip) => chip.dataset.chip === 'new')!);

    expect(harness.state()).toEqual({ filterQuery: 'game', filterChip: 'new', filterTag: '' });

    // A refresh adds a project; it stays visible only when it matches.
    const refreshed = [
      ...twelveProjects(),
      project('MatchGame', { hasNewContent: true }),
      project('Unrelated', { hasNewContent: true })
    ];
    const restored = run(renderMainHtml(localState(refreshed)), harness.state());
    const visible = restored.items
      .filter((item) => !item.hidden)
      .map((item) => item.dataset.projectItem);

    expect(visible).toEqual(['MatchGame', 'MyGame2']);
    expect(restored.input.value).toBe('game');
  });

  it('keeps filtering correct when only one project badges are patched', () => {
    const harness = run(renderMainHtml(localState(twelveProjects())));
    harness.clickChip(harness.chips.find((chip) => chip.dataset.chip === 'new')!);

    harness.send({
      type: 'projectBadges',
      project: 'MyGame',
      html: '<span class="badge">有新内容</span>',
      flags: { hasNewContent: true, canPublish: false, publishedCount: 0 }
    });

    const game = harness.items.find((item) => item.dataset.projectItem === 'MyGame');
    expect(game?.dataset.hasNew).toBe('true');
    expect(game?.hidden).toBe(false);
  });

  it('focuses the filter on / and never intercepts other inputs', () => {
    const harness = run(renderMainHtml(localState(twelveProjects())));
    let prevented = false;

    harness.keydown({
      key: '/',
      target: { tagName: 'BODY', isContentEditable: false },
      preventDefault: () => {
        prevented = true;
      }
    });
    expect(harness.input.focused).toBe(true);
    expect(prevented).toBe(true);

    prevented = false;
    harness.keydown({
      key: '/',
      target: harness.input,
      preventDefault: () => {
        prevented = true;
      }
    });
    expect(prevented).toBe(false);
  });

  it('clears and blurs the filter on Escape', () => {
    const harness = run(renderMainHtml(localState(twelveProjects())));
    harness.input_('game');
    harness.input.focus();

    harness.keydown({
      key: 'Escape',
      target: harness.input,
      preventDefault: () => undefined
    });

    expect(harness.input.value).toBe('');
    expect(harness.input.focused).toBe(false);
    expect(harness.items.every((item) => !item.hidden)).toBe(true);
    expect(harness.state()).toEqual({ filterQuery: '', filterChip: 'all', filterTag: '' });
  });
});
