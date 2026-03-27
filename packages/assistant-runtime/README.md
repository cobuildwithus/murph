# `@healthybob/assistant-runtime`

Headless hosted/runtime surface for Healthy Bob assistant execution.

This package exists so hosted runtimes such as `apps/cloudflare` do not need to import their execution seams directly from the published `healthybob` CLI package.

Current responsibilities:

- expose typed hosted-runtime contracts used by the Cloudflare runner
- run one-shot hosted assistant/inbox/parser/device-sync/share-import passes behind an explicit runtime context object
- provide an isolated child-process execution helper so per-user env overrides do not force container-wide request serialization

Current non-goals:

- CLI command routing
- Ink/UI surfaces
- replacing the canonical vault or hosted bundle model

The current implementation still composes the existing assistant/runtime exports from `healthybob`, but the hosted/runtime boundary is now this package rather than the CLI package itself.
