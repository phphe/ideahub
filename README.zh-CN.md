<p align="center">
  <img src="docs/assets/logo.jpeg" alt="IdeaHub logo" width="180">
</p>

<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

## IdeaHub 是什么

IdeaHub 是一个开源工具，用来证明一个创意在某个时间点之前就已经存在。

把创意写进自己的 GitHub 仓库，并不能独立证明时间：提交时间和文件修改时间都由自己掌控，别人无法据此确认内容在当时已经存在。IdeaHub 把创意内容与 GitHub 上不可变的 Release 绑定在一起，让拿到项目网址的第三方可以自行校验：这段内容确实在记录的时间之前就已存在。

## 核心机制

1. **内容指纹**：对项目内容做规范化后计算 SHA-256。规范 JSON 固定键顺序、`files` 键升序；正文去空行、去两端空白、统一换行，`Published:` 标记行不参与计算；项目内被引用的文件按 git blob SHA-1 计入。
2. **不可变 Release 作为时间锚点**：每个指纹创建一个 tag 为 `ideahub-<sha256>` 的 GitHub Release。开启 Release 不可变性后，该 Release 不能再被修改或删除，从而留下可验证的时间记录。
3. **写回标记**：在 `ideas.md` 末尾追加 `` ###### `Proof: YYYY-MM-DD HH:mm:ss (UTC+08:00) [ideahub]` ``。标记之前的内容，就是该时间点已经存在的内容。
4. **生成证明文件**：发布时根据已证明内容生成项目的 `README.md`，包含 Front Matter（`version`）、说明与统计，以及按时间升序排列的 `` ## 🔏 `Proof: ...` `` 证明块。标记中带 `🔏` 的图片与链接会一并纳入后续校验范围。

> Release 的不可变性需要在 GitHub 仓库设置中**手动开启**；IdeaHub 会检测并在未开启时提示。

## 安装 VS Code 扩展

扩展尚未上架 VS Code Marketplace，当前从源码构建：

```sh
pnpm install
pnpm run build
pnpm --filter ideahub-vscode package
```

然后安装生成的 `packages/vscode-extension/ideahub-vscode-0.1.0.vsix`（VS Code 的「扩展」视图 →「从 VSIX 安装」，或执行 `code --install-extension <VSIX 路径>`）。开发时也可以直接按 `F5` 启动扩展开发宿主。

扩展界面跟随 VS Code 的显示语言，当前支持英文与简体中文。

## 使用流程

1. **初始化**：打开一个空文件夹，在活动栏点击 IdeaHub 图标并初始化。扩展会创建本地 Git 仓库、`.ideahub/config.json`、`.ideahub/.gitignore` 和说明用的 `README.md`，并安装 `pre-push` hook。
2. **配置远程创意仓库**：在 GitHub 上手动创建一个**公开**仓库，把地址填到扩展里完成克隆。克隆位于 `.ideahub/remote/`，不纳入本地仓库的版本控制。
3. **创建项目**：在仓库根目录新建项目文件夹（例如 `MyGame`），在其中创建 `ideas.md` 并写下创意；也可以放入图片等需要被引用的文件。
4. **标记**：对项目执行「标记」。扩展计算内容指纹、创建 `ideahub-<sha256>` Release，并在 `ideas.md` 中写入 `Proof:` 标记。
5. **发布**：对项目执行「发布」，经两次确认后，扩展会先校验所有证明块，写入 `Published:` 标记，生成项目的 `README.md`，再只把该项目文件夹复制到 `.ideahub/remote/` 并推送。

安全边界：

- 本地仓库不要连接远程创意仓库；扩展安装的 `pre-push` hook 会阻止误推送。
- 发布只推送 `.ideahub/remote/` 中的公开副本，项目的 `ideas.md` 不会进入公开仓库。
- 扩展不保存 Token，GitHub 认证使用 VS Code 内置的 GitHub 认证。

## 用 CLI 验证他人的证明

拿到项目网址后，可以用 `ideahub` CLI 独立校验：

```sh
ideahub check <项目网址>
ideahub login            # 可选：登录后配额从 60 次/小时提升到 5000 次/小时
```

项目网址支持两种形式：

- `https://github.com/<owner>/<repo>/tree/<branch>/<path...>`
- `https://github.com/<owner>/<repo>/tree/<branch>/<path...>/README.md`

退出码：`PASS` 为 0，`FAIL` 为 1，执行错误（网络、限流、仓库不可访问等）为 2。

CLI 的 npm 包名为 `ideahub`，发布后可以直接使用 `npx ideahub check <项目网址>`。在当前仓库中也可以先构建再运行：

```sh
pnpm --filter ideahub build
node packages/cli/dist/index.js check <项目网址>
```

## 配置

扩展设置：

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `ideahub.proof.autoCommit` | `true` | 写入证明或发布标记后，是否自动提交对应标记行 |
| `ideahub.proof.commitMessage` | `ideahub: record proof` | 证明标记的自动提交文案 |
| `ideahub.publish.commitMessage` | `ideahub: mark published` | 发布标记的自动提交文案 |

仓库级配置保存在 `.ideahub/config.json`（版本号与远程创意仓库信息），不包含任何 Token。

## 许可证

[MIT](LICENSE)
