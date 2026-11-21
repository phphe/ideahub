<p align="center">
  <img src="docs/assets/logo.jpeg" alt="IdeaHub logo" width="180">
</p>

<p align="center">
  <a href="README.md">English</a> | <strong>简体中文</strong>
</p>

## IdeaHub 是什么

AI时代, 如何保护我们的创意? 如何证明我们的原创性? 此工具为此而生, 并在此呼吁各大平台增强对开发者原创性的保护.

IdeaHub 是一个开源工具，用来证明创意在某个时间点之前就已经存在。

根据创意原文生成内容指纹, 仅把指纹发布到GitHub不可变的 Release, 不用提前发布创意原文. 在项目发布后, 可以发布创意原文, 然后任何人都可以进行校验.

## 核心机制

1. **内容指纹**：对项目内容做规范化后计算 SHA-256。
2. **不可变 Release 作为时间锚点**：每个指纹创建一个 tag 为 `ideahub-<sha256>` 的 GitHub不可变Release。


## 使用流程

- 在 VS Code 的扩展市场搜索 **IdeaHub** 安装。或者[点击此处](https://marketplace.visualstudio.com/items?itemName=ideahub.ideahub-vscode).
- 通过[此模板](https://github.com/phphe/ideahub-template)在 GitHub 创建一个公开仓库, 作为你的远程证明仓库，你也可以[点击此处](https://github.com/new?template_name=ideahub-template&template_owner=phphe)开始创建，然后在仓库的设置里开启 Release 不可变性(打开Settings页面->勾选"Enable release immutability")。
- 在vscode中打开一个空文件夹（它将成为本地创意仓库），在活动栏点击 IdeaHub 图标并初始化。远程证明仓库地址填入上一步的仓库网址, 如"https://github.com/your_name/repo_name".
- 在IdeaHub面板点击加号图标新增项目（项目是本地创意仓库里的一个文件夹）, 在打开的ideas.md中编写创意文本. 已有项目可以点击项目名打开ideas.md. 
- ideas.md里添加内容后, 点击"证明"按钮把该段文本的内容指纹(hash)发布到远程证明仓库. 建议即时使用证明功能, 可以每天结束工作前使用一次证明功能.
- 在创意原文可以公开后, 点击"发布"按钮把该项目的创意原文发布到远程证明仓库, 此时其他人可以看到您的创意原文并使用ideahub验证您的创意的时间证明.

## 内容规范
- 建议撰写创意文本时行文简洁, 可以采用一句话概括, 再以一段话描述细节. 
- 不建议在文本中包含时间. 
- 生成证明之后, 该段文本底部会插入标记. 新内容应该在标记之后撰写, 在标记之前修改或添加内容将导致该段文本的证明失效.
- 修改项目名称即文件夹名称将导致该项目的所有证明失效.
- 可以包含图片和文件, 但是图片和文件需要放在该项目文件夹内部. 生成的证明涵盖创意文本以及文本中引用的项目内文件, 但不包括未被引用的文件、外部文件和链接.

## 注意
- 本地创意仓库和远程证明仓库不能是同一个仓库，也不能手动把本地创意仓库推送到远程证明仓库；本工具会在本地创意仓库添加 `pre-push` hook 阻止误推送。如需备份本地创意仓库，另建一个远程空仓库并设为私有，否则会泄露你的创意原文。
- 创意文本里不应包含emoji"🔏".



## 用 CLI 验证他人的证明

```sh
npx ideahub check <项目网址>
```

3种结果: `PASS` 退出码为 0，`FAIL` 为 1，执行错误为 2。

cli通过github api查询, 可登录github提升api配额：`npx ideahub login`（匿名 60 次/小时，登录后 5000 次/小时）。

## 配置

- `ideahub.proof.autoCommit`：证明和发布时是否自动提交git commit，默认 `true`。
- `ideahub.proof.commitMessage`：证明时提交git commit的提交文案，默认 `ideahub: record proof`。
- `ideahub.publish.commitMessage`：发布时提交git commit的提交文案，默认 `ideahub: mark published`。

本地创意仓库配置在 `.ideahub/config.json`。

## 示例

- 本地创意仓库: https://github.com/phphe/ideahub-local-example
- 远程证明仓库: https://github.com/phphe/ideahub-remote-example

## 许可证

[MIT](LICENSE)

