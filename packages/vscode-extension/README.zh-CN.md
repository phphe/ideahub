# IdeaHub

一个 VS Code 扩展：在本地记录创意形成过程，并把每次新增内容的指纹发布为 GitHub 不可变 Release，作为可验证的时间证明。创意无需提前公开。

[English](README.md) | 简体中文

## 它是什么

AI 时代，如何保护我们的创意、证明我们的原创性？IdeaHub 为此而生，并呼吁各大平台增强对开发者原创性的保护。

扩展根据创意原文生成内容指纹，仅把指纹发布到 GitHub 不可变 Release，不用提前发布创意原文。项目正式发布后，可以公开创意原文，任何人都能校验其存在时间。

## 核心机制

1. **内容指纹**：对项目内容做规范化后计算 SHA-256。
2. **不可变 Release 作为时间锚点**：每个指纹创建一个 tag 为 `ideahub-<sha256>` 的 GitHub 不可变 Release。

## 准备远程创意仓库

- 通过[此模板](https://github.com/phphe/ideahub-remote-template)在 GitHub 创建一个公开仓库，也可以[点击此处](https://github.com/new?template_name=ideahub-remote-template&template_owner=phphe)开始创建。
- 在仓库设置中开启 Release 不可变性（打开 Settings 页面，勾选 "Enable release immutability"）。

## 使用流程

1. 在 VS Code 中打开一个空文件夹，在活动栏点击 IdeaHub 图标并初始化。
2. 远程创意仓库地址填入上一步的仓库网址，例如 `https://github.com/your_name/repo_name`；扩展会校验并克隆该仓库。
3. 在 IdeaHub 面板点击加号图标新增项目，在打开的 `ideas.md` 中编写创意文本；已有项目可点击项目名打开 `ideas.md`。
4. 点击「证明」把该段文本的内容指纹发布到远程仓库。建议即时证明，也可以每天结束工作前执行一次。
5. 创意可以公开后，点击「发布」把项目内容推送到远程创意仓库，其他人即可查看创意原文并使用 ideahub 验证其时间证明。

## 内容规范

- 建议行文简洁：一句话概括，再用一段话描述细节。
- 不建议在文本中包含时间。
- 生成证明后，该段文本底部会插入标记。新内容应写在标记之后；在标记之前修改或添加内容会使该段文本的证明失效。
- 修改项目名称（文件夹名称）会使该项目的所有证明失效。
- 可以包含图片和文件，但必须放在该项目文件夹内部。证明涵盖创意文本以及文本中引用的项目内文件，不包括未被引用的文件、外部文件和链接。

## 注意

- 本地储存创意的 Git 仓库和远程储存证明的仓库不能是同一个仓库，也不能手动推送到远程证明仓库。扩展会添加 `pre-push` hook 阻止误推送；如需备份本地创意仓库，另建一个远程空仓库并设为私有，否则会泄露创意原文。
- 创意文本里不应包含 emoji "🔏"。

## 配置

- `ideahub.proof.autoCommit`：证明和发布时是否自动提交 Git commit，默认 `true`。
- `ideahub.proof.commitMessage`：证明时的提交文案，默认 `ideahub: record proof`。
- `ideahub.publish.commitMessage`：发布时的提交文案，默认 `ideahub: mark published`。

本地仓库配置在 `.ideahub/config.json`。

## 更多

- 用 CLI 验证他人的证明、配额说明与示例仓库，见[根 README](https://github.com/phphe/ideahub/tree/main/README.zh-CN.md)。
- 许可证：[MIT](../../LICENSE)。
