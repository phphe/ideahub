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

## Windows 常见问题

### `'ideahub' 不是内部或外部命令，也不是可运行的程序或批处理文件`

`npx @ideahub/cli` 会先安装包，再从 `node_modules/.bin` 执行 `ideahub` 命令。Windows 下该目录必须有 `ideahub.cmd`；如果 npx 缓存条目是在没有生成 bin 链接的情况下创建的（例如 `npm install --no-bin-links`、`.npmrc` 里的 `bin-links=false`、或安装被中断），cmd.exe 就会报这个错。已发布的包本身没有问题：`bin` 指向 `dist/index.js`，首行是 `#!/usr/bin/env node`，构建时若这一约定被破坏会直接失败。

修复步骤：

1. `npm config get bin-links` 不能是 `false`；如果是，执行 `npm config delete bin-links`。
2. 清除 npx 缓存：`npx -y clear-npx-cache`（或删除 `<npm cache>/_npx`，路径可用 `npm config get cache` 查看）。
3. 如果以前装过旧包名的无作用域包，先卸载：`npm rm -g ideahub`，再用 `where ideahub` 确认没有残留。
4. 重试 `npx -y @ideahub/cli check <项目网址>`。清除缓存前也可以先用固定版本绕过：`npx -y @ideahub/cli@latest check <项目网址>` 会使用另一个缓存条目。

### 不要把网址两侧的反引号一起粘贴

上面的用法里，反引号只是 Markdown 标记。

- `cmd.exe` 把反引号当普通字符，网址会变成 `` `https://...` ``，被判定为无法解析。
- PowerShell 把反引号当转义符：在双引号内用反引号包裹网址会吞掉结尾的引号（报 `The string is missing the terminator`），行尾反引号还会续行。

两种 shell 都请使用 `npx @ideahub/cli check "https://github.com/<owner>/<repo>/tree/<branch>/<path>"`，或直接用不加引号、不带反引号的裸网址。

完整流程与配置见[根 README](https://github.com/phphe/ideahub/tree/main/README.zh-CN.md)。
