# ideahub

IdeaHub's command-line verification tool: verifies others' idea timestamp proofs from the content fingerprint.

English | [简体中文](README.zh-CN.md)

## Usage

All addresses below point to the remote proof repository.

```sh
npx @ideahub/cli check [--json] <project-url>
npx @ideahub/cli login
```

The project URL passed to `check` is the address of a project directory inside the remote proof repository. Exactly two forms are accepted:

- `https://github.com/<owner>/<repo>/tree/<branch>/<path...>`
- `https://github.com/<owner>/<repo>/tree/<branch>/<path...>/README.md`

Any other address (`blob/`, a non-github.com host, a missing path segment, etc.) fails immediately and exits with 2. In the VS Code extension panel, right-click a project name to copy its project URL.

## Exit codes

| Result | Output | Exit code |
| --- | --- | --- |
| PASS | green `PASS` | 0 |
| FAIL | red `FAIL` | 1 |
| Execution error | error only | 2 |

## JSON output

Add `--json` after `check` to print exactly one JSON object to stdout, with no colors and no human-readable lines. Exit codes are unchanged: PASS=`0`, FAIL=`1`, execution error=`2`.

```json
{
  "status": "PASS",
  "input": "https://github.com/phphe/ideahub-remote-example/tree/main/a-opensource-tool",
  "repository": {
    "owner": "phphe",
    "repo": "ideahub-remote-example",
    "url": "https://github.com/phphe/ideahub-remote-example"
  },
  "branch": "main",
  "projectPath": "a-opensource-tool",
  "projectUrl": "https://github.com/phphe/ideahub-remote-example/tree/main/a-opensource-tool",
  "commit": "452446c...",
  "proofBlocks": 3,
  "failures": [],
  "error": null
}
```

- `status`: `PASS`, `FAIL`, or `ERROR`.
- `failures`: the reasons for a `FAIL`; empty for other statuses.
- `error`: `{ "category": "...", "messages": ["..."] }` for an execution error; `null` otherwise. Categories include `url`, `repository`, `branch`, `proof-file`, `proof-version`, `commit`, `tree`, `project-directory`, `marker`, `release-immutability`, `release-time`, `rate-limit`, `api`, and `unexpected`.
- Fields that could not be resolved are `null`.

Anonymous requests are limited to 60 per hour; after `npx @ideahub/cli login` the limit is 5,000 per hour.

## Windows troubleshooting

### `'ideahub' is not recognized as an internal or external command`

`npx @ideahub/cli` installs the package and then runs the `ideahub` command from `node_modules/.bin`. On Windows that directory must contain `ideahub.cmd`; when the npx cache entry was created without bin links (for example `npm install --no-bin-links`, `bin-links=false` in `.npmrc`, or an interrupted install), `cmd.exe` reports exactly this error. The published package is not the cause: `bin` points to `dist/index.js`, which starts with `#!/usr/bin/env node`, and the build fails if that ever changes.

Repair steps:

1. `npm config get bin-links` must not print `false`. If it does, run `npm config delete bin-links`.
2. Clear the npx cache: `npx -y clear-npx-cache` (or delete `<npm cache>/_npx`; find the path with `npm config get cache`).
3. Remove a leftover unscoped install of the old package name: `npm rm -g ideahub`, then `where ideahub` should print nothing.
4. Retry `npx -y @ideahub/cli check <project-url>`. Pinning a version (`npx -y @ideahub/cli@latest check <project-url>`) uses a separate cache entry and also works before the cache is cleared.

### Do not paste the backticks around the URL

The snippets above use backticks only as Markdown markup.

- `cmd.exe` treats backticks as ordinary characters, so the URL arrives as `` `https://...` `` and is rejected as unparsable.
- PowerShell treats a backtick as an escape character: wrapping a URL in backticks inside double quotes swallows the closing quote (`The string is missing the terminator`), and a trailing backtick continues the line.

In both shells use `npx @ideahub/cli check "https://github.com/<owner>/<repo>/tree/<branch>/<path>"` or the bare URL without backticks.

For the full workflow and configuration, see the [root README](https://github.com/phphe/ideahub/tree/main/README.md).
