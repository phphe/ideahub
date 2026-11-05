import { describe, expect, it } from 'vitest';
import type { WorkspaceState } from '../src/core/status';
import { renderMainHtml } from '../src/ui/html';

describe('renderMainHtml', () => {
  it('includes the message script for every workspace state', () => {
    const states: WorkspaceState[] = [
      { kind: 'no-folder' },
      { kind: 'empty-folder', root: 'C:/empty' },
      { kind: 'not-ideahub', root: 'C:/non-empty' },
      { kind: 'error', message: 'boom' }
    ];

    for (const state of states) {
      const html = renderMainHtml(state);
      expect(html).toMatch(/<script nonce="[^"]+">/);
      expect(html).toContain('acquireVsCodeApi');
      expect(html).toContain("vscode.postMessage({ type: action");
    }
  });

  it('renders the init button and the shared script together for an empty folder', () => {
    const html = renderMainHtml({ kind: 'empty-folder', root: 'C:/empty' });
    expect(html).toContain('data-action="init"');
    expect(html).toContain('正在处理');
  });

  it('shows a notice with escaped content', () => {
    const html = renderMainHtml({ kind: 'no-folder' }, { kind: 'error', text: '<bad> & error' });
    expect(html).toContain('class="notice error"');
    expect(html).toContain('&lt;bad&gt; &amp; error');
  });
});
