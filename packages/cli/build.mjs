import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * Section 6.7: the CLI owns `config.mjs` and `.env` next to this file. Both are
 * build-time only: the resolved `oauthClientId` and `proofFileVersion` are
 * inlined into dist/index.js, so the runtime never reads env vars and never
 * needs these files.
 */

const DEFAULT_OAUTH_CLIENT_ID = '';
const OAUTH_CLIENT_ID_ENV_KEY = 'IDEAHUB_OAUTH_CLIENT_ID';
const DEFAULT_PROOF_FILE_VERSION = '1';
const PROOF_FILE_VERSION_ENV_KEY = 'IDEAHUB_PROOF_FILE_VERSION';

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

async function resolveProofFileVersion() {
  const envValue = parseEnvValue(
    readOptional(fileURLToPath(new URL('./.env', import.meta.url))),
    PROOF_FILE_VERSION_ENV_KEY
  );
  if (envValue !== null && envValue.trim().length > 0) {
    return { version: envValue.trim(), source: 'env', warnings: [] };
  }

  const configPath = fileURLToPath(new URL('./config.mjs', import.meta.url));
  try {
    const config = await import(new URL('./config.mjs', import.meta.url).href);
    const value = config.default?.proofFileVersion;
    if (value === undefined || value === null) {
      return {
        version: DEFAULT_PROOF_FILE_VERSION,
        source: 'default',
        warnings: ['config.mjs 缺少 proofFileVersion，使用默认值。']
      };
    }
    if (typeof value !== 'string') {
      return {
        version: DEFAULT_PROOF_FILE_VERSION,
        source: 'default',
        warnings: ['config.mjs 的 proofFileVersion 必须是字符串，使用默认值。']
      };
    }
    if (value.trim().length === 0) {
      return {
        version: DEFAULT_PROOF_FILE_VERSION,
        source: 'default',
        warnings: ['config.mjs 的 proofFileVersion 为空，使用默认值。']
      };
    }
    return { version: value.trim(), source: 'file', warnings: [] };
  } catch (error) {
    return {
      version: DEFAULT_PROOF_FILE_VERSION,
      source: 'default',
      warnings: [
        `无法加载 ${configPath}：${error instanceof Error ? error.message : String(error)}，使用默认值。`
      ]
    };
  }
}

const oauth = await resolveOAuthClientId();for (const warning of oauth.warnings) {
  console.warn(`[ideahub] oauth client id warning: ${warning}`);
}
console.log(
  `[ideahub] oauthClientId=${JSON.stringify(oauth.clientId)} (source=${
    oauth.source
  }, injected at build time)`
);

const proofVersion = await resolveProofFileVersion();
for (const warning of proofVersion.warnings) {
  console.warn(`[ideahub] proof file version warning: ${warning}`);
}
console.log(
  `[ideahub] proofFileVersion=${JSON.stringify(proofVersion.version)} (source=${
    proofVersion.source
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
    'process.env.IDEAHUB_OAUTH_CLIENT_ID': JSON.stringify(oauth.clientId),
    'process.env.IDEAHUB_PROOF_FILE_VERSION': JSON.stringify(proofVersion.version)
  }
});

/**
 * npm creates the Windows `ideahub.cmd` shim by reading the shebang of the
 * executable declared in package.json#bin, and `npx @ideahub/cli` runs that
 * shim. Fail the build if either half of that contract drifts, so a published
 * tarball cannot regress into "'ideahub' is not recognized".
 */
const packageDir = fileURLToPath(new URL('.', import.meta.url));
const distFile = path.resolve(packageDir, 'dist/index.js');
const shebang = readFileSync(distFile, 'utf8').split(/\r?\n/, 1)[0];
if (shebang !== '#!/usr/bin/env node') {
  throw new Error(
    `dist/index.js must start with "#!/usr/bin/env node" (got ${JSON.stringify(shebang)}).`
  );
}
const cliPackage = JSON.parse(
  readFileSync(path.resolve(packageDir, 'package.json'), 'utf8')
);
const binTarget =
  typeof cliPackage.bin === 'string' ? cliPackage.bin : cliPackage.bin?.ideahub;
if (!binTarget || path.resolve(packageDir, binTarget) !== distFile) {
  throw new Error(
    `package.json#bin.ideahub must point to dist/index.js (got ${JSON.stringify(
      binTarget
    )}).`
  );
}
console.log('[ideahub] verified dist/index.js shebang and package.json#bin target');
