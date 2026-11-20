# IdeaHub

`Your Ideas. Your History. Your Proof.`

一个 VS Code 扩展：在本地记录创意形成过程，并把每次新增内容的 Hash 发布为 GitHub Release，作为可验证的时间证明。

[English](README.md) | 简体中文

## 安装

在 VS Code 扩展市场搜索 **IdeaHub** 安装，或访问 [Marketplace 页面](https://marketplace.visualstudio.com/items?itemName=ideahub.ideahub-vscode)。

## 基本用法

1. 打开一个文件夹，在活动栏点击 IdeaHub 图标并初始化。
2. 填入你在 GitHub 上手动创建的公开创意仓库地址，扩展会完成校验与克隆。
3. 新建项目并编辑 `ideas.md`，点击「证明」把内容指纹发布为不可变 Release。
4. 创意可以公开后，点击「发布」把项目内容推送到远程创意仓库。

## 说明

- 扩展不保存 Token，认证使用 VS Code 内置 GitHub 认证。
- 远程创意仓库的 Release 不可变性需在 GitHub 仓库设置中手动启用。

完整流程、内容规范与配置项见[根 README](https://github.com/phphe/ideahub/tree/main/README.zh-CN.md)。
