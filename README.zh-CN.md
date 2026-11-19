<p align="center">
  <img src="docs/assets/logo.jpeg" alt="IdeaHub logo" width="180">
</p>

<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

## IdeaHub 是什么

IdeaHub 是一个开源工具，让用户在不用提前发布创意的情况下, 证明一个创意在某个时间点之前就已经存在。

根据创意原文生成内容指纹, 把指纹发布到GitHub不可变的 Release. 在创意原文发布后, 任何人都可以进行校验.

## 核心机制

1. **内容指纹**：对项目内容做规范化后计算 SHA-256。
2. **不可变 Release 作为时间锚点**：每个指纹创建一个 tag 为 `ideahub-<sha256>` 的 GitHub不可变Release。

## 安装 VS Code 扩展

在 VS Code 的扩展市场搜索 **IdeaHub** 安装。扩展界面跟随 VS Code 的显示语言，支持英文与简体中文。

## 使用流程

1. 打开一个空文件夹，在活动栏点击 IdeaHub 图标并初始化。
2. 在 GitHub 创建一个公开仓库，把地址填入扩展完成克隆（位于 `.ideahub/remote/`），并在仓库设置中开启 Release 不可变性。
3. 在仓库根目录新建项目文件夹，放入 `ideas.md` 后执行「标记」。
4. 执行「发布」，两次确认后只把该项目文件夹推送到远程创意仓库。

`pre-push` hook 会阻止把本地仓库推送到远程创意仓库；扩展不保存 Token，使用 VS Code 内置的 GitHub 认证。

## 用 CLI 验证他人的证明

```sh
npm install -g ideahub
ideahub check <项目网址>
```

项目网址形如 `https://github.com/<owner>/<repo>/tree/<branch>/<path...>`（可带 `/README.md`）。`PASS` 退出码为 0，`FAIL` 为 1，执行错误为 2。

可选登录提升配额：`ideahub login`（匿名 60 次/小时，登录后 5000 次/小时）。

## 配置

- `ideahub.proof.autoCommit`：是否自动提交证明/发布标记，默认 `true`。
- `ideahub.proof.commitMessage`：证明标记的提交文案，默认 `ideahub: record proof`。
- `ideahub.publish.commitMessage`：发布标记的提交文案，默认 `ideahub: mark published`。

仓库配置在 `.ideahub/config.json`，不含 Token。

## 许可证

[MIT](LICENSE)

