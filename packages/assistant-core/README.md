# @murph/assistant-core

Dedicated headless assistant boundary package for non-CLI consumers.

It owns the local-only assistant, inbox, vault, and operator-config surface used by hosted runtimes and local daemons while intentionally excluding CLI command routing, Ink/UI entrypoints, and assistantd client helpers, which remain in `murph`.
