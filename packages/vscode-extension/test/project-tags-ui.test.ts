import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { ProjectSummary, WorkspaceState } from '@ideahub/core';
import { renderMainHtml } from '../src/ui/html';

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

  toggle(name: string, force?: boolean): void {
    const on = force === undefined ? !this.names.has(name) : force;
    if (on) {
      this.names.add(name);
    } else {
      this.names.delete(name);
    }
  }

  contains(name: string): boolean {
    return this.names.has(name);
  }
}

interface FakeTagChip {
  dataset: Record<string, string>;
  classList: FakeClassList;
  hidden: boolean;
  attributes: Record<string, string>;
  countEl: { textContent: string };
  setAttribute(name: string, value: string): void;
  querySelector(selector: string): { textContent: string } | null;
}

interface FakeMenu {
  hidden: boolean;
  style: Record<string, string>;
  rect: { width: number; height: number };
  getBoundingClientRect(): { width: number; height: number };
}

interface FakeInput {
  id: string;
  tagName: string;
  value: string;
  focused: boolean;
  focus(): void;
  blur(): void;
}

function attribute(attrs: string, name: string): string {
  const match = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return match ? match[1] : '';
}

function itemsFrom(html: string): FakeItem[] {
  const items: FakeItem[] = [];
  const itemPattern = /<li class="project"[^>]*data-project-item="([^"]+)"[^>]*>/g;
  for (const match of html.matchAll(itemPattern)) {
    items.push({
      dataset: {
        projectItem: match[1],
        hasNew: attribute(match[0], 'data-has-new'),
        canPublish: attribute(match[0], 'data-can-publish'),
        published: attribute(match[0], 'data-published'),
        tags: attribute(match[0], 'data-tags')
      },
      hidden: false,
      querySelector: (selector) =>
        selector === '[data-project-badges]' ? { innerHTML: '' } : null
    });
  }
  return items;
}

interface FakeChip {
  dataset: Record<string, string>;
  classList: FakeClassList;
  attributes: Record<string, string>;
  setAttribute(name: string, value: string): void;
}

function chipsFrom(html: string): FakeChip[] {
  const chips: FakeChip[] = [];
  const chipPattern =
    /<button class="([^"]*)" data-chip="([^"]+)" aria-pressed="([^"]+)">([^<]*)<\/button>/g;
  for (const match of html.matchAll(chipPattern)) {
    chips.push({
      dataset: { chip: match[2] },
      classList: new FakeClassList(match[1]),
      attributes: { 'aria-pressed': match[3] },
      setAttribute(name, value) {
        this.attributes[name] = value;
      }
    });
  }
  return chips;
}

function tagsFrom(html: string): FakeTagChip[] {
  const tags: FakeTagChip[] = [];
  const pattern =
    /<button class="([^"]*)" data-tag="([^"]+)" aria-pressed="([^"]+)">([\s\S]*?)<\/button>/g;
  for (const match of html.matchAll(pattern)) {
    const countMatch = /data-tag-count>([^<]*)</.exec(match[4]);
    const countEl = { textContent: countMatch ? countMatch[1] : '' };
    tags.push({
      dataset: { tag: match[2] },
      classList: new FakeClassList(match[1]),
      hidden: false,
      attributes: { 'aria-pressed': match[3] },
      countEl,
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      querySelector: (selector) => (selector === '[data-tag-count]' ? countEl : null)
    });
  }
  return tags;
}

interface Harness {
  items: FakeItem[];
  chips: FakeChip[];
  tags: FakeTagChip[];
  row: FakeMenu & { querySelectorAll(selector: string): FakeTagChip[] } | null;
  menu: FakeMenu;
  input: FakeInput;
  hint: { hidden: boolean };
  messages: unknown[];
  state(): { filterQuery?: string; filterChip?: string; filterTag?: string };
  input_(value: string): void;
  clickChip(chip: FakeChip): void;
  clickTag(chip: FakeTagChip): void;
  contextmenu(project: string, x: number, y: number): void;
  clickMenu(action: string): void;
  clickOutside(): void;
  keydown(key: string, target?: unknown): void;
  blur(): void;
  send(data: unknown): void;
}

function run(
  html: string,
  saved?: { filterQuery?: string; filterChip?: string; filterTag?: string }
): Harness {
  const items = itemsFrom(html);
  const chips = chipsFrom(html);
  const tags = tagsFrom(html);
  const hasTagRow = html.includes('id="project-tags"');
  const row = hasTagRow
    ? {
        hidden: false,
        style: {},
        rect: { width: 0, height: 0 },
        getBoundingClientRect: () => ({ width: 0, height: 0 }),
        querySelectorAll: (selector: string) => (selector === '[data-tag]' ? tags : [])
      }
    : null;
  const menu: FakeMenu = {
    hidden: true,
    style: {},
    rect: { width: 160, height: 80 },
    getBoundingClientRect() {
      return this.rect;
    }
  };
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
      id === 'project-filter'
        ? input
        : id === 'project-filter-empty'
          ? hint
          : id === 'project-tags'
            ? row
            : id === 'project-menu'
              ? menu
              : null,
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
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener: (type: string, callback: (event: unknown) => void) => {
      handlers[`window:${type}`] = callback;
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
    tags,
    row,
    menu,
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
        target: { closest: (selector: string) => (selector === '[data-chip]' ? chip : null) }
      });
    },
    clickTag(chip: FakeTagChip) {
      handlers.click?.({
        target: { closest: (selector: string) => (selector === '[data-tag]' ? chip : null) }
      });
    },
    contextmenu(project: string, x: number, y: number) {
      let prevented = false;
      handlers.contextmenu?.({
        preventDefault: () => {
          prevented = true;
        },
        clientX: x,
        clientY: y,
        target: {
          closest: (selector: string) =>
            selector === '[data-project-menu]' ? { dataset: { projectMenu: project } } : null
        }
      });
      expect(prevented).toBe(true);
    },
    clickMenu(action: string) {
      handlers.click?.({
        target: {
          closest: (selector: string) =>
            selector === '[data-menu-action]' ? { dataset: { menuAction: action } } : null
        }
      });
    },
    clickOutside() {
      handlers.click?.({ target: { closest: () => null } });
    },
    keydown(key: string, target?: unknown) {
      handlers.keydown?.({
        key,
        target: target ?? { tagName: 'BODY', isContentEditable: false },
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        preventDefault: () => undefined
      });
    },
    blur() {
      handlers['window:blur']?.({});
    },
    send(data: unknown) {
      handlers.message?.({ data });
    }
  };
}

function taggedProjects(): ProjectSummary[] {
  return [
    project('GameOne', { hasNewContent: true, tags: ['游戏'] }),
    project('GameTwo', { tags: ['游戏', '写作'] }),
    project('WriteOne', { publishedCount: 1, tags: ['写作'] }),
    ...Array.from({ length: 9 }, (_value, index) => project(`Filler${index}`))
  ];
}

describe('project tags webview behaviour', () => {
  it('renders the tag row on its own line after the status chips', () => {
    const html = renderMainHtml(localState(taggedProjects()));
    expect(html).toContain('placeholder="Search by name"');
    expect(html.indexOf('project-chips')).toBeLessThan(html.indexOf('id="project-tags"'));
    expect(html.indexOf('id="project-tags"')).toBeLessThan(
      html.indexOf('id="project-filter-empty"')
    );
    expect(html).toContain('data-tag="游戏"');
    expect(html).toContain('data-tag="写作"');
  });

  it('does not render the tag row when no project has tags', () => {
    const state = localState(
      Array.from({ length: 12 }, (_value, index) => project(`Filler${index}`))
    );
    const html = renderMainHtml(state);
    expect(html).not.toContain('id="project-tags"');

    // A stale persisted tag must not hide every project after a refresh.
    const harness = run(html, { filterTag: '游戏' });
    expect(harness.items.every((item) => !item.hidden)).toBe(true);
    expect(harness.state().filterTag).toBe('');
  });

  it('counts tags under the name search and status chip (AND)', () => {
    const harness = run(renderMainHtml(localState(taggedProjects())));

    const count = (tag: string): string | undefined =>
      harness.tags.find((chip) => chip.dataset.tag === tag)?.countEl.textContent;

    expect(count('游戏')).toBe('2');
    expect(count('写作')).toBe('2');

    harness.input_('game');
    expect(count('游戏')).toBe('2');
    expect(count('写作')).toBe('1');

    harness.clickChip(harness.chips.find((chip) => chip.dataset.chip === 'new')!);
    expect(count('游戏')).toBe('1');
    expect(count('写作')).toBe('0');
    expect(harness.tags.find((chip) => chip.dataset.tag === '写作')?.hidden).toBe(true);
    expect(harness.row?.hidden).toBe(false);
  });

  it('toggles a tag filter and combines it with the query and chip', () => {
    const harness = run(renderMainHtml(localState(taggedProjects())));
    const tag = (name: string): FakeTagChip =>
      harness.tags.find((chip) => chip.dataset.tag === name)!;

    harness.clickTag(tag('游戏'));
    expect(tag('游戏').classList.contains('active')).toBe(true);
    expect(harness.state().filterTag).toBe('游戏');
    expect(
      harness.items.filter((item) => !item.hidden).map((item) => item.dataset.projectItem)
    ).toEqual(['GameOne', 'GameTwo']);

    harness.input_('game');
    harness.clickChip(harness.chips.find((chip) => chip.dataset.chip === 'new')!);
    expect(
      harness.items.filter((item) => !item.hidden).map((item) => item.dataset.projectItem)
    ).toEqual(['GameOne']);

    harness.clickTag(tag('游戏'));
    expect(tag('游戏').classList.contains('active')).toBe(false);
    expect(harness.state().filterTag).toBe('');
    expect(
      harness.items.filter((item) => !item.hidden).map((item) => item.dataset.projectItem)
    ).toEqual(['GameOne']);
  });

  it('restores the tag filter after a full re-render and a badge patch', () => {
    const harness = run(renderMainHtml(localState(taggedProjects())));
    harness.clickTag(harness.tags.find((chip) => chip.dataset.tag === '游戏')!);
    harness.input_('game');

    const restored = run(renderMainHtml(localState(taggedProjects())), harness.state());
    expect(restored.input.value).toBe('game');
    expect(restored.tags.find((chip) => chip.dataset.tag === '游戏')?.classList.contains('active'))
      .toBe(true);
    expect(
      restored.items.filter((item) => !item.hidden).map((item) => item.dataset.projectItem)
    ).toEqual(['GameOne', 'GameTwo']);

    restored.send({
      type: 'projectBadges',
      project: 'GameTwo',
      html: '<span class="badge badge-warning">未证明</span>',
      flags: {
        hasNewContent: true,
        canPublish: false,
        publishedCount: 0,
        tags: ['游戏']
      }
    });
    expect(restored.state().filterTag).toBe('游戏');
    expect(
      restored.items.find((item) => item.dataset.projectItem === 'GameTwo')?.hidden
    ).toBe(false);
  });

  it('opens the context menu, routes all three actions and closes it', () => {
    const html = renderMainHtml(localState(taggedProjects()));
    expect(html).toContain('data-menu-action="copyUrl"');
    expect(html).toContain('Copy project URL');
    const harness = run(html);

    harness.contextmenu('GameOne', 20, 20);
    expect(harness.menu.hidden).toBe(false);
    expect(harness.menu.style.left).toBe('20px');
    expect(harness.menu.style.top).toBe('20px');

    harness.clickMenu('open');
    expect(harness.messages).toContainEqual({ type: 'open', project: 'GameOne' });
    expect(harness.menu.hidden).toBe(true);

    harness.contextmenu('GameTwo', 30, 30);
    harness.clickMenu('editTags');
    expect(harness.messages).toContainEqual({ type: 'editTags', project: 'GameTwo' });
    expect(harness.menu.hidden).toBe(true);

    harness.contextmenu('GameTwo', 40, 40);
    harness.clickMenu('copyUrl');
    expect(harness.messages).toContainEqual({ type: 'copyUrl', project: 'GameTwo' });
    expect(harness.menu.hidden).toBe(true);
  });

  it('closes the menu on an outside click, Escape and window blur', () => {
    const harness = run(renderMainHtml(localState(taggedProjects())));

    harness.contextmenu('GameOne', 10, 10);
    harness.clickOutside();
    expect(harness.menu.hidden).toBe(true);

    harness.contextmenu('GameOne', 10, 10);
    harness.keydown('Escape');
    expect(harness.menu.hidden).toBe(true);

    harness.contextmenu('GameOne', 10, 10);
    harness.blur();
    expect(harness.menu.hidden).toBe(true);
  });

  it('keeps the mtime order inside a tag-filtered result set', () => {
    const projects = [
      project('OldTagged', { tags: ['游戏'], updatedAt: 100 }),
      project('NewTagged', { tags: ['游戏'], updatedAt: 300 }),
      project('NewestOther', { tags: ['写作'], updatedAt: 500 }),
      ...Array.from({ length: 9 }, (_value, index) =>
        project(`Filler${index}`, { updatedAt: 0 })
      )
    ];
    const harness = run(renderMainHtml(localState(projects)));
    harness.clickTag(harness.tags.find((chip) => chip.dataset.tag === '游戏')!);

    expect(
      harness.items.filter((item) => !item.hidden).map((item) => item.dataset.projectItem)
    ).toEqual(['NewTagged', 'OldTagged']);
  });

  it('flips the menu upward and left so it is never clipped', () => {
    const harness = run(renderMainHtml(localState(taggedProjects())));
    harness.menu.rect = { width: 160, height: 80 };

    harness.contextmenu('GameOne', 900, 700);
    expect(harness.menu.style.left).toBe('860px');
    expect(harness.menu.style.top).toBe('620px');
  });
});
