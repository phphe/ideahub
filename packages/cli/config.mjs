// Developer config for @ideahub/cli (requirement.md 6.7). This package owns
// its own copy; it does not read the VS Code extension's config.mjs. The CLI
// only needs the OAuth App client id used by `ideahub login` (device flow).
// An empty string is a valid value: login then falls back to a manual token.
// The client secret never belongs here.
export default {
  oauthClientId: 'Iv23liILCafYLpMseji1',
};
