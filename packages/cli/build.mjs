import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * Section 6.7: the CLI owns `config.mjs` and `.env` next to this file. Both are
 * build-time only: the resolved `oauthClientId` is inlined into dist/index.js,
 * so the runtime never reads env vars and never needs these files.
 */

const DEFAULT_OAUTH_CLIENT_ID = '';
const OAUTH_CLIENT_ID_ENV_KEY = 'IDEAHUB_OAUTH_CLIENT_ID';

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

function parseEnvValue(text, key) {
  if (typeof text !== 'string') {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match || match[1] !== key) {
      continue;
    }
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

async function resolveOAuthClientId() {
  const envValue = parseEnvValue(
    readOptional(fileURLToPath(new URL('./.env', import.meta.url))),
    OAUTH_CLIENT_ID_ENV_KEY
  );
  if (envValue !== null && envValue.trim().length > 0) {
    return { clientId: envValue.trim(), source: 'env', warnings: [] };
  }

  const configPath = fileURLToPath(new URL('./config.mjs', import.meta.url));
  try {
    const config = await import(new URL('./config.mjs', import.meta.url).href);
    const value = config.default?.oauthClientId;
    if (value === undefined || value === null) {
      return {
        clientId: DEFAULT_OAUTH_CLIENT_ID,
        source: 'default',
        warnings: ['config.mjs 缺少 oauthClientId，使用空值。']
      };
    }
    if (typeof value !== 'string') {
      return {
        clientId: DEFAULT_OAUTH_CLIENT_ID,
        source: 'default',
        warnings: ['config.mjs 的 oauthClientId 必须是字符串，使用空值。']
      };
    }
    // Empty is a valid value here (no OAuth App registered yet).
    return { clientId: value.trim(), source: 'file', warnings: [] };
  } catch (error) {
    return {
      clientId: DEFAULT_OAUTH_CLIENT_ID,
      source: 'default',
      warnings: [
        `无法加载 ${configPath}：${error instanceof Error ? error.message : String(error)}，使用空值。`
      ]
    };
  }
}

const oauth = await resolveOAuthClientId();
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
