import { copyFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import esbuild from 'esbuild';
import releaseConfig from './scripts/release-config.js';

const {
  loadDeveloperConfig,
  resolveReleaseCommit,
  resolveProofFileVersion,
  resolveProofFileHeader,
  resolveOAuthClientId,
  findStandaloneSeparatorLine
} = releaseConfig;

async function copyCodicons() {
  await mkdir('media', { recursive: true });
  const dist = 'node_modules/@vscode/codicons/dist';
  await copyFile(`${dist}/codicon.css`, 'media/codicon.css');
  await copyFile(`${dist}/codicon.ttf`, 'media/codicon.ttf');
}

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

const envText = readOptional('.env');
const config = await loadDeveloperConfig();

const resolution = resolveReleaseCommit({ envText, config });
for (const warning of resolution.warnings) {
  console.warn(`[ideahub] release config warning: ${warning}`);
}

const versionResolution = resolveProofFileVersion({ envText, config });
for (const warning of versionResolution.warnings) {
  console.warn(`[ideahub] proof file version warning: ${warning}`);
}

const headerResolution = resolveProofFileHeader({ envText, config });
for (const warning of headerResolution.warnings) {
  console.warn(`[ideahub] proof file header warning: ${warning}`);
}

// Section 6.7: the OAuth client id is reserved for the CLI login flow. An
// empty value is legal, so it never warns.
const oauthResolution = resolveOAuthClientId({ envText, config });
for (const warning of oauthResolution.warnings) {
  console.warn(`[ideahub] oauth client id warning: ${warning}`);
}

// Section 7.8: a standalone `---` in the header would collide with the proof
// file's own separator, leaving the checker unable to find where the header
// ends. Fail the build instead of emitting an ambiguous proof file.
const separatorLine = findStandaloneSeparatorLine(headerResolution.header);
if (separatorLine !== null) {
  console.error(
    `[ideahub] proof file header must not contain a standalone "---" line (found at line ${separatorLine}); ` +
      'it collides with the proof file separator. Quote it as "> ---" if it is meant as a horizontal rule.'
  );
  process.exit(1);
}

console.log(
  `[ideahub] releaseCommit=${JSON.stringify(resolution.commit)} (source=${resolution.source}, injected at build time)`
);
console.log(
  `[ideahub] proofFileVersion=${JSON.stringify(versionResolution.version)} (source=${
    versionResolution.source
  }, injected at build time)`
);
console.log(
  `[ideahub] proofFileHeader=${JSON.stringify(headerResolution.header)} (source=${
    headerResolution.source
  }, injected at build time)`
);
console.log(
  `[ideahub] oauthClientId=${JSON.stringify(oauthResolution.clientId)} (source=${
    oauthResolution.source
  }, injected at build time)`
);

const watch = process.argv.includes('--watch');

await copyCodicons();

const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
  define: {
    'process.env.IDEAHUB_RELEASE_COMMIT': JSON.stringify(resolution.commit),
    'process.env.IDEAHUB_PROOF_FILE_VERSION': JSON.stringify(versionResolution.version),
    'process.env.IDEAHUB_PROOF_FILE_HEADER': JSON.stringify(headerResolution.header),
    'process.env.IDEAHUB_OAUTH_CLIENT_ID': JSON.stringify(oauthResolution.clientId)
  }
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
