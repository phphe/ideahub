# ideahub

IdeaHub's command-line verification tool.

English | [简体中文](README.zh-CN.md)

## Install

```sh
npm install -g ideahub
```

## Commands

```bash
ideahub check <project-url>
ideahub login [--token <token>]
```

A project URL is accepted in exactly two forms:

- `https://github.com/<owner>/<repo>/tree/<branch>/<path...>`
- `https://github.com/<owner>/<repo>/tree/<branch>/<path...>/README.md`

Any other address (`blob/`, a non-github.com host, a missing path segment, etc.) fails immediately and exits with 2.

## Exit codes

| Result | Output | Exit code |
| --- | --- | --- |
| PASS | green `PASS` | 0 |
| FAIL | red `FAIL` | 1 |
| Execution error | error only | 2 |

Anonymous requests are limited to 60 per hour; after `ideahub login` the limit is 5,000 per hour.

## Development

```bash
pnpm --filter ideahub build
pnpm --filter ideahub test
```

When `oauthClientId` in `config.mjs` is empty, `login` only supports pasting a token manually or passing `--token`.

For the full workflow and configuration, see the [root README](https://github.com/phphe/ideahub/tree/main/README.md).
