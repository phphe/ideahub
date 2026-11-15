import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import type { Translator } from '@ideahub/core';

export function interpolate(message: string, args: unknown[]): string {
  return message.replace(/\{(\d+)\}/g, (match, index) => {
    const value = args[Number(index)];
    return value === undefined ? match : String(value);
  });
}

/** Mirrors `vscode.l10n.t` when no matching language bundle exists. */
export const englishL10n: Translator = (message, ...args) =>
  interpolate(message, args);

let bundle: Record<string, string> | null = null;

export function loadZhBundle(): Record<string, string> {
  if (!bundle) {
    const file = path.join(process.cwd(), 'l10n', 'bundle.l10n.zh-cn.json');
    bundle = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  }
  return bundle;
}

/** Uses the real zh-cn bundle, mirroring VS Code's lookup + interpolation. */
export function zhL10n(): Translator {
  const dictionary = loadZhBundle();
  return (message, ...args) => interpolate(dictionary[message] ?? message, args);
}

export function l10nMock(): { t: Translator } {
  return { t: englishL10n };
}
