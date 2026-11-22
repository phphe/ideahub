# ideahub

IdeaHub 命令行校验工具：根据内容指纹核验他人的创意时间证明。

[English](README.md) | 简体中文

## 使用

以下地址均指向远程证明仓库。

```sh
npx @ideahub/cli check [--json] <项目网址>
npx @ideahub/cli login
```

`check` 的项目网址是远程证明仓库中项目目录的地址，只接受两种形式：

- `https://github.com/<owner>/<repo>/tree/<branch>/<path...>`
- `https://github.com/<owner>/<repo>/tree/<branch>/<path...>/README.md`

其它地址（`blob/`、非 github.com、缺少路径段等）直接报错并以 2 退出。在vscode扩展面板, 在项目名称的右键菜单可以复制项目地址.

## 退出码

| 结果 | 输出 | 退出码 |
| --- | --- | --- |
| PASS | 绿色 `PASS` | 0 |
| FAIL | 红色 `FAIL` | 1 |
| 执行错误 | 只报错 | 2 |

## JSON 输出

在 `check` 后加 `--json`，stdout 只输出一个 JSON 对象，不带颜色，也不带人类可读的说明行。退出码不变：PASS=`0`、FAIL=`1`、执行错误=`2`。

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

- `status`：`PASS`、`FAIL` 或 `ERROR`。
- `failures`：`FAIL` 时的失败原因列表；其它状态为空数组。
- `error`：执行错误时为 `{ "category": "...", "messages": ["..."] }`，其它状态为 `null`。类别包括 `url`、`repository`、`branch`、`proof-file`、`proof-version`、`commit`、`tree`、`project-directory`、`marker`、`release-immutability`、`release-time`、`rate-limit`、`api`、`unexpected`。
- 无法解析到的字段为 `null`。

匿名 60 次/小时，`npx @ideahub/cli login` 后 5000 次/小时。

完整流程与配置见[根 README](https://github.com/phphe/ideahub/tree/main/README.zh-CN.md)。
