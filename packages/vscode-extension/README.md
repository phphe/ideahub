# IdeaHub

A VS Code extension that records how ideas take shape locally and publishes the fingerprint of each new piece of content as a GitHub immutable Release — a verifiable timestamp proof. The idea does not need to be published in advance.

English | [简体中文](README.zh-CN.md)

## What it is

In the AI era, how do we protect our ideas and prove our originality? IdeaHub exists for that purpose, and calls on platforms to strengthen the protection of developers' originality.

The extension computes a content fingerprint from the original idea text and publishes only the fingerprint to an immutable GitHub Release, without publishing the idea text in advance. Once the project is formally published, you can make the original text public, and anyone can verify when it existed.

## Core mechanism

1. **Content fingerprint**: normalizes the project content and computes its SHA-256.
2. **Immutable Release as a time anchor**: each fingerprint creates a GitHub immutable Release with the tag `ideahub-<sha256>`.

## Prepare the remote proof repository

- Create a public repository on GitHub from [this template](https://github.com/phphe/ideahub-template), or [click here](https://github.com/new?template_name=ideahub-template&template_owner=phphe) to get started.
- Enable release immutability in the repository settings (open Settings and check "Enable release immutability").

## Workflow

1. Open an empty folder in VS Code, click the IdeaHub icon in the Activity Bar and initialize it.
2. Enter the URL of the remote proof repository from the previous step, for example `https://github.com/your_name/repo_name`; the extension validates it and clones it into the local idea repository as the inner repository (`.ideahub/remote/`).
3. Click the plus icon in the IdeaHub panel to add a project (a folder inside the local idea repository), and write your idea in the opened `ideas.md`; for an existing project, click its name to open `ideas.md`.
4. Click "Prove" to publish the content fingerprint of that segment to the remote proof repository. Proving right away is recommended; you can also prove once before finishing work each day.
5. Once the idea can be made public, click "Publish" to push the project content to the remote proof repository. Others can then view the original text and use ideahub to verify its timestamp proof.

## Content guidelines

- Keep the text concise: summarize in one sentence, then describe the details in a paragraph.
- Avoid including times in the text.
- After a proof is generated, a marker is inserted at the bottom of that segment. Write new content after the marker; modifying or adding content before it invalidates the proof of that segment.
- Renaming the project (the folder name) invalidates all proofs of that project.
- Images and files are allowed, but they must be placed inside the project folder. The proof covers the idea text and the project files referenced in the text; unreferenced files, external files and links are not included.

## Notes

- The local idea repository and the remote proof repository must not be the same repository, and you must not push the local idea repository to the remote proof repository manually. The extension adds a `pre-push` hook that blocks such pushes; to back up the local idea repository, create a separate empty remote repository and set it to private, otherwise your idea text will be exposed.
- The idea text must not contain the emoji "🔏".

## Configuration

- `ideahub.proof.autoCommit`: whether to automatically create a Git commit when proving and publishing; default `true`.
- `ideahub.proof.commitMessage`: commit message used when proving; default `ideahub: record proof`.
- `ideahub.publish.commitMessage`: commit message used when publishing; default `ideahub: mark published`.

The local idea repository configuration lives in `.ideahub/config.json`.

## More

- For verifying others' proofs with the CLI, quota details and example repositories, see the [root README](https://github.com/phphe/ideahub/tree/main/README.md).
- License: [MIT](../../LICENSE).
