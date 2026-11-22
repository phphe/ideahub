import { checkResultToJson, runCheck } from './check';
import { resolveToken } from './credentials';
import { runLogin } from './login';

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function paint(code: number, text: string): string {
  return useColor ? `\u001b[${code}m${text}\u001b[39m` : text;
}

export const green = (text: string): string => paint(32, text);
export const red = (text: string): string => paint(31, text);

const USAGE = [
  'Usage:',
  '  npx @ideahub/cli check [--json] <project-url>   verify the proof file (PASS=0 / FAIL=1 / execution error=2)',
  '  npx @ideahub/cli login [--token <token>]',
  '',
  'Options:',
  '  --json   print exactly one JSON object to stdout and nothing else',
  '',
  'Accepted project URLs:',
  '  https://github.com/<owner>/<repo>/tree/<branch>/<path...>',
  '  https://github.com/<owner>/<repo>/tree/<branch>/<path...>/README.md'
].join('\n');

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === '--help' || command === '-h' || command === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (command === 'check') {
    return runCheckCommand(rest);
  }
  if (command === 'login') {
    const result = await runLogin(rest, fetch, (message) => console.log(message));
    for (const message of result.messages) {
      console.log(message);
    }
    return result.code;
  }

  console.error(USAGE);
  return 2;
}

async function runCheckCommand(args: string[]): Promise<number> {
  const input = args.find((arg) => !arg.startsWith('-'));
  if (!input) {
    console.error('Missing project URL.');
    console.error(USAGE);
    return 2;
  }

  const { token, source } = await resolveToken();
  const result = await runCheck({ input, token });

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(checkResultToJson(result, input))}\n`);
    return result.status === 'PASS' ? 0 : result.status === 'FAIL' ? 1 : 2;
  }

  if (result.status === 'PASS') {
    if (result.detail) {
      console.log(result.detail);
    }
    console.log(green('PASS'));
    return 0;
  }

  for (const message of result.messages) {
    console.error(`- ${message}`);
  }
  if (result.status === 'FAIL') {
    console.log(red('FAIL'));
    return 1;
  }

  if (token === null) {
    console.error(
      'Using anonymous access (60 requests per hour). Run `npx @ideahub/cli login` to raise the limit to 5000.'
    );
  } else {
    console.error(`Using a token from ${source}.`);
  }
  return 2;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
