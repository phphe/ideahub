# @ideahub/cli

IdeaHub 命令行校验工具，按 `requirement.md` 第十三章实现。

## 命令

```bash
ideahub check <项目网址>
ideahub login [--token <token>]
```

项目网址只接受两种形式：

- `https://github.com/<owner>/<repo>/tree/<branch>/<path...>`
- `https://github.com/<owner>/<repo>/tree/<branch>/<path...>/README.md`

其它地址（`blob/`、非 github.com、缺少路径段等）直接报错并以 2 退出。

## 退出码

| 结果 | 输出 | 退出码 |
| --- | --- | --- |
| PASS | 绿色 `PASS` | 0 |
| FAIL | 红色 `FAIL` | 1 |
| 执行错误 | 只报错 | 2 |

## 开发

```bash
pnpm --filter @ideahub/cli build
pnpm --filter @ideahub/cli test
```

`config.mjs` 的 `oauthClientId` 为空时，`login` 只支持手动粘贴 token 或 `--token`。
