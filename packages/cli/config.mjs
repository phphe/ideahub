// Developer config for the ideahub CLI (requirement.md 6.7). This package owns
// its own copy; it does not read the VS Code extension's config.mjs. The CLI
// needs the OAuth App client id used by `npx @ideahub/cli login` (device flow) and the
// proof file version it accepts. An empty oauthClientId is valid: login then
// falls back to a manual token. The client secret never belongs here.
export default {
  oauthClientId: 'Iv23liILCafYLpMseji1',
  // Proof file Front Matter `version` this build accepts. Must match the value
  // written by the extension so generated proof files can be verified.
  proofFileVersion: '1',
};
