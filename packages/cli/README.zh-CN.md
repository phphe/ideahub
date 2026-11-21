# ideahub

IdeaHub 命令行校验工具：根据内容指纹核验他人的创意时间证明。

[English](README.md) | 简体中文

## 使用

以下地址均指向远程证明仓库。

```sh
npx ideahub check <项目网址>
npx ideahub login
```

`check` 的项目网址是远程证明仓库中项目目录的地址，只接受两种形式：

- `https://github.com/<owner>/<repo>/tree/<branch>/<path...>`
- `https://github.com/<owner>/<repo>/tree/<branch>/<path...>/README.md`

其它地址（`blob/`、非 github.com、缺少路径段等）直接报错并以 2 退出。

## 退出码

| 结果 | 输出 | 退出码 |
| --- | --- | --- |
| PASS | 绿色 `PASS` | 0 |
| FAIL | 红色 `FAIL` | 1 |
| 执行错误 | 只报错 | 2 |

匿名 60 次/小时，`ideahub login` 后 5000 次/小时。

完整流程与配置见[根 README](https://github.com/phphe/ideahub/tree/main/README.zh-CN.md)。
