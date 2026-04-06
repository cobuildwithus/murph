# @murphai/setup-cli

Workspace-private CLI-only onboarding and host setup surface for Murph.

This package owns the setup wizard, host provisioning helpers, AgentMail setup helpers,
and assistant/channel/wearable onboarding flows. It depends on
`@murphai/operator-config` for setup contracts and runtime helpers,
`@murphai/assistant-engine` for assistant-facing runtime seams, and
`@murphai/vault-inbox` for inbox and vault service assembly used during setup.
