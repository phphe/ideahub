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

Any other address (`blob/`, a non-github.com host, a missing path segment, etc.) fails immediately and exits with 2.

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

For the full workflow and configuration, see the [root README](https://github.com/phphe/ideahub/tree/main/README.md).
