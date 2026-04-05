# @murphai/assistant-cli

CLI-only assistant surface for Murph.

This package owns the daemon-aware assistant wrappers, assistant command registration,
foreground terminal logging, and the Ink chat UI. It depends on `@murphai/assistant-core`
for the headless assistant runtime and on `@murphai/assistantd` for optional loopback
daemon routing.
