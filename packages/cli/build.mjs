import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import releaseConfig from '../vscode-extension/scripts/release-config.js';

const { loadDeveloperConfig, resolveOAuthClientId } = releaseConfig;

function readOptional(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

// Section 6.7: the CLI and the extension share one developer config. The CLI
// reads `packages/vscode-extension/config.mjs` (and that package's `.env`) at
// build time and inlines the value, so the runtime never depends on env vars.
const extensionDir = fileURLToPath(new URL('../vscode-extension/', import.meta.url));
const envText = readOptional(`${extensionDir}.env`);
const config = await loadDeveloperConfig(`${extensionDir}config.mjs`);
const oauth = resolveOAuthClientId({ envText, config });

for (const warning of oauth.warnings) {
  console.warn(`[ideahub] oauth client id warning: ${warning}`);
}
console.log(
  `[ideahub] oauthClientId=${JSON.stringify(oauth.clientId)} (source=${
    oauth.source
  }, injected at build time)`
);

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  sourcemap: true,
  logLevel: 'info',
  define: {
    'process.env.IDEAHUB_OAUTH_CLIENT_ID': JSON.stringify(oauth.clientId)
  }
});
