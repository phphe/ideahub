import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCheck } from '../src/check';
import { main } from '../src/index';

vi.mock('../src/check', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/check')>();
  return { ...actual, runCheck: vi.fn() };
});

vi.mock('../src/credentials', () => ({
  resolveToken: vi.fn(async () => ({ token: null, source: 'anonymous' }))
}));

const URL = 'https://github.com/phphe/ideahub-remote-example/tree/main/a-opensource-tool';
const runCheckMock = vi.mocked(runCheck);

const META = {
  repository: { owner: 'phphe', repo: 'ideahub-remote-example' },
  branch: 'main',
  projectPath: 'a-opensource-tool',
  projectUrl: URL,
  commit: '452446c0123456789abcdef0123456789abcdef0'
};

let stdout: string[];
let stderr: string[];

function capture(): void {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    stdout.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderr.push(args.map(String).join(' '));
  });
}

beforeEach(() => {
  capture();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('check --json', () => {
  it('prints one parseable JSON object for PASS and keeps the plain output unchanged', async () => {
    runCheckMock.mockResolvedValue({
      ...META,
      status: 'PASS',
      messages: [],
      proofBlocks: 3,
      detail: `Verified 3 proof block(s): phphe/ideahub-remote-example@main/a-opensource-tool (commit 452446c)`
    });

    const jsonCode = await main(['check', URL, '--json']);
    const jsonText = stdout.join('');
    expect(jsonCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toHaveLength(1);
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      status: 'PASS',
      input: URL,
      repository: {
        owner: 'phphe',
        repo: 'ideahub-remote-example',
        url: 'https://github.com/phphe/ideahub-remote-example'
      },
      branch: 'main',
      projectPath: 'a-opensource-tool',
      projectUrl: URL,
      commit: META.commit,
      proofBlocks: 3,
      failures: [],
      error: null
    });

    stdout = [];
    stderr = [];
    const plainCode = await main(['check', URL]);
    expect(plainCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toEqual([
      'Verified 3 proof block(s): phphe/ideahub-remote-example@main/a-opensource-tool (commit 452446c)',
      'PASS'
    ]);
  });

  it('prints one parseable JSON object for FAIL and keeps the plain output unchanged', async () => {
    runCheckMock.mockResolvedValue({
      ...META,
      status: 'FAIL',
      messages: ['2026-11-01 10:00:00: no immutable Release with this tag exists on the remote.'],
      proofBlocks: 1
    });

    const jsonCode = await main(['check', URL, '--json']);
    expect(jsonCode).toBe(1);
    expect(stderr).toEqual([]);
    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      status: 'FAIL',
      failures: ['2026-11-01 10:00:00: no immutable Release with this tag exists on the remote.'],
      error: null,
      proofBlocks: 1
    });

    stdout = [];
    stderr = [];
    const plainCode = await main(['check', URL]);
    expect(plainCode).toBe(1);
    expect(stdout).toEqual(['FAIL']);
    expect(stderr).toEqual([
      '- 2026-11-01 10:00:00: no immutable Release with this tag exists on the remote.'
    ]);
  });

  it('prints one parseable JSON object for execution errors and keeps the plain output unchanged', async () => {
    runCheckMock.mockResolvedValue({
      status: 'ERROR',
      messages: ['The GitHub API rate limit is exhausted.'],
      errorCategory: 'rate-limit'
    });

    const jsonCode = await main(['check', URL, '--json']);
    expect(jsonCode).toBe(2);
    expect(stderr).toEqual([]);
    const parsed = JSON.parse(stdout.join('')) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      status: 'ERROR',
      input: URL,
      repository: null,
      branch: null,
      projectPath: null,
      projectUrl: null,
      commit: null,
      proofBlocks: null,
      failures: [],
      error: {
        category: 'rate-limit',
        messages: ['The GitHub API rate limit is exhausted.']
      }
    });

    stdout = [];
    stderr = [];
    const plainCode = await main(['check', URL]);
    expect(plainCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      '- The GitHub API rate limit is exhausted.',
      'Using anonymous access (60 requests per hour). Run `npx @ideahub/cli login` to raise the limit to 5000.'
    ]);
  });
});
