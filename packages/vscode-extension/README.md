# IdeaHub

`Your Ideas. Your History. Your Proof.`

A VS Code extension that records how ideas take shape locally and publishes the hash of each new piece of content as a GitHub Release — a verifiable timestamp proof.

English | [简体中文](README.zh-CN.md)

## Install

Search for **IdeaHub** in the VS Code Marketplace and install it, or open the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=ideahub.ideahub-vscode).

## Basic usage

1. Open a folder, click the IdeaHub icon in the Activity Bar and initialize it.
2. Enter the public idea repository URL that you created manually on GitHub; the extension validates it and clones it.
3. Create a project, write in `ideas.md`, and click "Prove" to publish its content fingerprint as an immutable Release.
4. Once the idea can be made public, click "Publish" to push the project content to the remote idea repository.

## Notes

- The extension stores no token; GitHub authentication uses VS Code's built-in GitHub authentication.
- Release immutability must be enabled manually in the GitHub repository settings.

For the full workflow, content guidelines and settings, see the [root README](https://github.com/phphe/ideahub/tree/main/README.md).
