<p align="center">
  <img src="docs/assets/logo.jpeg" alt="IdeaHub logo" width="180">
</p>

<p align="center">
  <strong>English</strong> | <a href="README.zh-CN.md">简体中文</a>
</p>

## What is IdeaHub

In the AI era, how do we protect our ideas? How do we prove our originality? This tool exists for that purpose, and calls on platforms to strengthen the protection of developers' originality.

IdeaHub is an open-source tool for proving that an idea existed before a certain point in time.

It computes a content fingerprint from the original idea text and publishes only the fingerprint to an immutable GitHub Release, without publishing the idea text in advance. Once the project is published, you can publish the original idea text, and anyone can then verify it.

## Core mechanism

1. **Content fingerprint**: normalizes the project content and computes its SHA-256.
2. **Immutable Release as a time anchor**: each fingerprint creates a GitHub immutable Release with the tag `ideahub-<sha256>`.

## Workflow

- Search for **IdeaHub** in the VS Code Marketplace and install it, or [click here](https://marketplace.visualstudio.com/items?itemName=ideahub.ideahub-vscode).
- Create a public repository on GitHub from [this template](https://github.com/phphe/ideahub-remote-template), or [click here](https://github.com/new?template_name=ideahub-remote-template&template_owner=phphe) to get started. Then enable release immutability in the repository settings (open Settings and check "Enable release immutability").
- Open an empty folder in VS Code, click the IdeaHub icon in the Activity Bar and initialize it. Enter the repository URL from the previous step, for example "https://github.com/your_name/repo_name".
- Click the plus icon in the IdeaHub panel to add a project, and write your idea in the opened ideas.md. For an existing project, click its name to open ideas.md.
- After adding content to ideas.md, click the "Prove" button to publish the content fingerprint (hash) of that segment to the remote repository. It is recommended to prove right away; you can run a proof once before finishing work each day.
- Once the original idea can be made public, click the "Publish" button to publish the original idea text of the project to the remote repository. Others can then see your idea text and use ideahub to verify its timestamp proof.

## Content guidelines

- Keep the idea text concise; a one-sentence summary followed by a paragraph of details works well.
- Avoid including times in the text.
- After a proof is generated, a marker is inserted at the bottom of that segment. Write new content after the marker; modifying or adding content before it invalidates the proof of that segment.
- Renaming the project (the folder name) invalidates all proofs of that project.
- Images and files are allowed, but they must be placed inside the project folder. The proof covers the idea text and the project files referenced in the text; unreferenced files, external files and links are not included.

## Notes

- The local Git repository that stores your ideas and the remote repository that stores proofs must not be the same repository, and you must not push the local repository to the remote proof repository manually. This tool adds a `pre-push` hook to the local Git repository that blocks pushes to the remote proof repository. To back up the local idea repository, create a separate empty remote repository, but set it to private; otherwise your idea text will be exposed.
- The idea text must not contain the emoji "🔏".

## Verify others' proofs with the CLI

```sh
npx ideahub check <project-url>
```

Three outcomes: `PASS` exits with 0, `FAIL` with 1, and execution errors with 2.

The CLI queries the GitHub API. You can sign in to GitHub to raise the API quota: `npx ideahub login` (60 requests/hour anonymously, 5,000/hour after signing in).

## Configuration

- `ideahub.proof.autoCommit`: whether to automatically create a Git commit when proving and publishing; default `true`.
- `ideahub.proof.commitMessage`: commit message used when proving; default `ideahub: record proof`.
- `ideahub.publish.commitMessage`: commit message used when publishing; default `ideahub: mark published`.

The local repository configuration lives in `.ideahub/config.json`.

## Examples

- Local idea repository: https://github.com/phphe/ideahub-example
- Remote proof repository: https://github.com/phphe/ideahub-proof-demo

## License

[MIT](LICENSE)
