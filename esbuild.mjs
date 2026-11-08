import { copyFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import esbuild from 'esbuild';
import releaseConfig from './scripts/release-config.js';

const { resolveReleaseBranch, resolveProofFileVersion, resolveProofFileHeader } = releaseConfig;

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
const configText = readOptional('ideahub.config.json');

const resolution = resolveReleaseBranch({ envText, configText });
for (const warning of resolution.warnings) {
  console.warn(`[ideahub] release config warning: ${warning}`);
}

const versionResolution = resolveProofFileVersion({ envText, configText });
for (const warning of versionResolution.warnings) {
  console.warn(`[ideahub] proof file version warning: ${warning}`);
}

const headerResolution = resolveProofFileHeader({ envText, configText });
for (const warning of headerResolution.warnings) {
  console.warn(`[ideahub] proof file header warning: ${warning}`);
}

console.log(
  `[ideahub] releaseBranch=${resolution.branch} (source=${resolution.source}, injected at build time)`
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
    'process.env.IDEAHUB_RELEASE_BRANCH': JSON.stringify(resolution.branch),
    'process.env.IDEAHUB_PROOF_FILE_VERSION': JSON.stringify(versionResolution.version),
    'process.env.IDEAHUB_PROOF_FILE_HEADER': JSON.stringify(headerResolution.header)
  }
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
