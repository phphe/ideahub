import { describe, expect, it, vi } from 'vitest';
import type { Translator } from '@ideahub/core';
import type { RemoteSetupFlowResult } from '@ideahub/core';
import { formatRemoteSetupResult } from '../src/ui/controller';

vi.mock('vscode', () => ({
  window: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    withProgress: vi.fn()
  },
  workspace: { getConfiguration: vi.fn() },
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  ProgressLocation: { Notification: 1 },
  l10n: { t: (message: string) => message },
  env: { language: 'en' }
}));

const t: Translator = (message, ...args) =>
  args.reduce<string>((text, value, index) => text.replace(`{${index}}`, String(value)), message);

const RESULT: RemoteSetupFlowResult = {
  ok: true,
  remote: {
    provider: 'github',
    owner: 'phphe',
    repo: 'ideahub-remote-example',
    url: 'https://github.com/phphe/ideahub-remote-example',
    branch: 'main'
  },
  clone: 'cloned',
  branch: 'main'
};

describe('formatRemoteSetupResult', () => {
  it('starts the first configuration after initialization with the completed summary', () => {
    const message = formatRemoteSetupResult(RESULT, t, { initialized: true }).message;
    const lines = message.split('\n');

    expect(lines[0]).toBe(
      'Initialization completed: the local idea repository has been initialized.'
    );
    expect(lines[1]).toBe(
      'Step 1/2: remote URL validation passed; configuration and hook saved.'
    );
    expect(message).toContain('Step 2/2: the remote proof repository was cloned (branch main).');
  });

  it('keeps the step details first when changing an existing remote', () => {
    const message = formatRemoteSetupResult(RESULT, t).message;

    expect(message.startsWith('Step 1/2:')).toBe(true);
    expect(message).not.toContain('Initialization completed');
  });
});
