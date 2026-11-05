/**
 * Developer-only release configuration.
 *
 * The value is resolved at build time from `.env` > `ideahub.config.json` >
 * `main` and injected by esbuild's `define`. Runtime code never reads `.env`
 * or any config file from the user's workspace.
 */
export const RELEASE_BRANCH: string = process.env.IDEAHUB_RELEASE_BRANCH ?? 'main';
