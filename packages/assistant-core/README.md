# @murph/assistant-core

Dedicated headless assistant boundary package for non-CLI consumers.

It owns the local-only assistant, inbox, vault, and operator-config surface used by hosted runtimes and local daemons while intentionally excluding CLI command routing, Ink/UI entrypoints, and assistantd client helpers, which remain in `murph`.

Its package exports mirror the source module layout via subpaths so CLI, hosted-runtime, and daemon code can import the headless owner package directly instead of routing through `murph` compatibility files.
