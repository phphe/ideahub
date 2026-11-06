import * as vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderMainHtml } from '../src/ui/html';

interface FakeGlyph {
  className: string;
}

interface FakeButton {
  disabled: boolean;
  dataset: Record<string, string>;
  classList: { contains(name: string): boolean };
  querySelector(selector: string): FakeGlyph | null;
  glyph: FakeGlyph | null;
}

function makeButton(action: string, options: { icon?: string } = {}): FakeButton {
  const glyph = options.icon ? { className: `codicon codicon-${options.icon}` } : null;
  return {
    disabled: false,
    dataset: { action },
    classList: { contains: (name: string) => name === 'icon' && glyph !== null },
    querySelector: (selector: string) => (selector === '.codicon' ? glyph : null),
    glyph
  };
}

type ClickEvent = { target: { closest(selector: string): FakeButton | null } };
type MessageEvent = { data: unknown };

function scriptOf(html: string): string {
  const match = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('webview script not found');
  }
  return match[1];
}

function runWebview(buttons: FakeButton[]): {
  messages: unknown[];
  click(button: FakeButton): void;
  send(data: unknown): void;
} {
  const messages: unknown[] = [];
  let onClick: ((event: ClickEvent) => void) | undefined;
  let onMessage: ((event: MessageEvent) => void) | undefined;

  const documentStub = {
    activeElement: null,
    querySelectorAll: (selector: string) =>
      selector === 'button'
        ? buttons
        : buttons.filter((button) => button.dataset.busy === 'true'),
    getElementById: () => null,
    addEventListener: (type: string, callback: unknown) => {
      if (type === 'click') {
        onClick = callback as (event: ClickEvent) => void;
      }
    }
  };
  const windowStub = {
    addEventListener: (type: string, callback: unknown) => {
      if (type === 'message') {
        onMessage = callback as (event: MessageEvent) => void;
      }
    }
  };
  vm.runInNewContext(scriptOf(renderMainHtml({ kind: 'not-ideahub', root: 'C:/repo' })), {
    document: documentStub,
    window: windowStub,
    acquireVsCodeApi: () => ({
      postMessage: (message: unknown) => messages.push(message)
    }),
    String
  });

  return {
    messages,
    click(button: FakeButton) {
      if (!onClick) {
        throw new Error('click handler not registered');
      }
      onClick({ target: { closest: () => button } });
    },
    send(data: unknown) {
      if (!onMessage) {
        throw new Error('message handler not registered');
      }
      onMessage({ data });
    }
  };
}

describe('webview busy reset', () => {
  it('re-enables buttons and restores the idle icon without re-rendering', () => {
    const init = makeButton('initNonEmpty');
    const refresh = makeButton('refresh', { icon: 'refresh' });
    const harness = runWebview([init, refresh]);

    harness.click(refresh);
    expect(init.disabled).toBe(true);
    expect(refresh.disabled).toBe(true);
    expect(refresh.glyph?.className).toBe('codicon codicon-loading codicon-modifier-spin');
    expect(refresh.dataset.idleIcon).toBe('codicon codicon-refresh');
    expect(harness.messages).toEqual([{ type: 'refresh', project: undefined }]);

    harness.send({ type: 'resetBusy' });
    expect(init.disabled).toBe(false);
    expect(refresh.disabled).toBe(false);
    expect(refresh.glyph?.className).toBe('codicon codicon-refresh');
    expect(refresh.dataset.busy).toBeUndefined();
    expect(refresh.dataset.idleIcon).toBeUndefined();
    // The reset only touches the DOM; it never asks the extension to re-render.
    expect(harness.messages).toHaveLength(1);

    harness.click(refresh);
    expect(refresh.disabled).toBe(true);
    expect(refresh.glyph?.className).toBe('codicon codicon-loading codicon-modifier-spin');
    expect(harness.messages).toHaveLength(2);
  });

  it('re-enables a text button that has no icon', () => {
    const init = makeButton('initNonEmpty');
    const harness = runWebview([init]);

    harness.click(init);
    expect(init.disabled).toBe(true);

    harness.send({ type: 'resetBusy' });
    expect(init.disabled).toBe(false);
    expect(init.dataset.busy).toBeUndefined();
  });
});
