# @murphai/setup-cli

Workspace-private CLI-only onboarding and host setup surface for Murph.

This package owns the setup wizard, host provisioning helpers, AgentMail setup helpers,
and assistant/channel/wearable onboarding flows. It depends on
`@murphai/operator-config` for setup contracts and runtime helpers,
and `@murphai/assistant-engine` for both the assistant-facing runtime seams and the
canonical inbox/vault service assembly used during setup.
