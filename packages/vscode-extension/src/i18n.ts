import * as vscode from 'vscode';
import type { Translator } from '@ideahub/core';

/**
 * Single runtime translator for the extension. The English message is the
 * fallback; VS Code replaces it with the `l10n/bundle.l10n.<lang>.json` value
 * matching the current display language.
 */
export const l10n: Translator = (message, ...args) =>
  vscode.l10n.t(message, ...(args as Array<string | number | boolean>));
