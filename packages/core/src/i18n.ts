/**
 * Core never imports `vscode`, so user-facing messages are English by default.
 * The extension injects `vscode.l10n.t` as a `Translator`; the CLI keeps the
 * English default. Messages use `{0}`, `{1}` placeholders so a language bundle
 * can translate the whole sentence instead of concatenated fragments.
 */
export type Translator = (message: string, ...args: unknown[]) => string;

export const translate: Translator = (message, ...args) =>
  message.replace(/\{(\d+)\}/g, (match, index) => {
    const value = args[Number(index)];
    return value === undefined ? match : String(value);
  });
