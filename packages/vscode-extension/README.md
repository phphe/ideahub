# 创意仓库 / IdeaHub

`Your Ideas. Your History. Your Proof.`

一个 VS Code 扩展：在本地记录创意形成过程，并把每次新增内容的 Hash 发布为 GitHub Release，作为可验证的时间证明。

## 安装（开发版）

```sh
pnpm install
pnpm run build
```

然后在 VS Code 中按 `F5` 启动扩展开发宿主，或使用 `pnpm run package` 打出 `.vsix` 后通过「扩展 → 从 VSIX 安装」安装。

## 使用概要

1. 打开一个空文件夹，在活动栏点击「创意仓库」图标，初始化本地仓库。
2. 填写你在 GitHub 上**手动创建**的公开创意仓库地址，并完成克隆。
3. 在根目录创建项目文件夹（文件夹内必须包含 `ideas.md`）。
4. 对项目执行「标记」：生成 Hash → 创建 `ideahub-<sha256>` Release → 写入标记。
5. 对项目执行「发布」：两次确认后，只把项目文件夹复制到内层仓库并推送。

## 安全边界

- 扩展不会自动提交、推送或公开本地仓库。
- 本地仓库不得连接远程创意仓库；扩展会安装 `pre-push` hook 阻止误推送。
- 远程创意仓库的 Release 不可变性需由你在 GitHub 仓库设置中手动启用。
- 扩展不保存任何 Token 或凭据；GitHub 认证使用 VS Code 内置 GitHub 认证。
