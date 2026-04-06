# @murphai/assistant-cli

Workspace-private CLI-only assistant surface for Murph.

This package owns the daemon-aware assistant wrappers, assistant command registration,
foreground terminal logging, and the Ink chat UI. It depends on
`@murphai/assistant-engine` for the headless assistant runtime,
`@murphai/operator-config` for operator defaults and contracts, and
`@murphai/assistantd` for optional loopback daemon routing.
