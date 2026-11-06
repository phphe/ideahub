import { copyFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import esbuild from 'esbuild';
import releaseConfig from './scripts/release-config.js';

const { resolveReleaseBranch } = releaseConfig;

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

const resolution = resolveReleaseBranch({
  envText: readOptional('.env'),
  configText: readOptional('ideahub.config.json')
});
for (const warning of resolution.warnings) {
  console.warn(`[ideahub] release config warning: ${warning}`);
}
console.log(
  `[ideahub] releaseBranch=${resolution.branch} (source=${resolution.source}, injected at build time)`
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
    'process.env.IDEAHUB_RELEASE_BRANCH': JSON.stringify(resolution.branch)
  }
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
