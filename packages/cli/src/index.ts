import { runCheck } from './check';
import { resolveToken } from './credentials';
import { runLogin } from './login';

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function paint(code: number, text: string): string {
  return useColor ? `\u001b[${code}m${text}\u001b[39m` : text;
}

export const green = (text: string): string => paint(32, text);
export const red = (text: string): string => paint(31, text);

const USAGE = [
  '用法：',
  '  ideahub check <项目网址>   校验证明文件（PASS=0 / FAIL=1 / 执行错误=2）',
  '  ideahub login [--token <token>]',
  '',
  '项目网址只接受：',
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
    const result = await runLogin(rest);
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
    console.error('缺少项目网址。');
    console.error(USAGE);
    return 2;
  }

  const { token, source } = await resolveToken();
  const result = await runCheck({ input, token });

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
    console.error('当前为匿名访问（60 次/小时）。可执行 ideahub login 提升到 5000 次/小时。');
  } else {
    console.error(`当前使用 ${source} 提供的 token。`);
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
