# ideahub

IdeaHub's command-line verification tool: verifies others' idea timestamp proofs from the content fingerprint.

English | [简体中文](README.zh-CN.md)

## Usage

```sh
npx ideahub check <project-url>
npx ideahub login
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

For the full workflow and configuration, see the [root README](https://github.com/phphe/ideahub/tree/main/README.md).
