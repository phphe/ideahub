/**
 * Developer-only release configuration.
 *
 * Values are resolved at build time from `.env` > `config.mjs` >
 * built-in defaults, then injected by esbuild's `define`. Runtime code never
 * reads `.env` or any config file from the user's workspace.
 */
export const RELEASE_BRANCH: string = process.env.IDEAHUB_RELEASE_BRANCH ?? 'main';

/** Section 7.8: proof file front matter `version`, default `"0"`. */
export const PROOF_FILE_VERSION: string = process.env.IDEAHUB_PROOF_FILE_VERSION ?? '0';

/** Section 7.8: optional proof file header copy; empty means omitted. */
export const PROOF_FILE_HEADER: string = process.env.IDEAHUB_PROOF_FILE_HEADER ?? '';
