# @murphai/assistant-cli

Private CLI command registration and foreground logging for Murph. Commands use
`@murphai/assistant-engine` directly for local assistant execution.

## Retained local commands

Use `murph assistant ask` for one local turn, `murph assistant deliver` for an
explicit outbound message, and `murph assistant run` for configured messaging
automation. Status, doctor, stop, session inspection, self-target, and onboarding
commands remain available. The shared vault CLI and hosted assistant are unchanged.

## Retired entrypoints

`murph chat`, `murph assistant chat`, and the optional `murph-assistantd` HTTP
server are removed. There is no Ink chat UI, loopback assistant server, remote
client, or daemon routing configuration. Use direct local commands or configured
messaging. Existing vault files and local session transcripts are preserved.
Device and inbox runtime lifecycles remain independent and supported.
