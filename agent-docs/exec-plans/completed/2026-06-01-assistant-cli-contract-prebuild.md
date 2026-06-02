# Assistant CLI Contract Prebuild

## Goal

Move assistant CLI surface contract generation out of hosted provider-turn startup by generating the compact contract as a build artifact and reading it at runtime.

## Scope

- `packages/assistant-engine` prompt/bootstrap code
- package build script and focused assistant-engine tests
- direct local benchmark of CLI bootstrap behavior

## Constraints

- Keep foreground assistant admission free of `vault-cli --llms-full`.
- Do not add a new scheduler, runtime owner, package dependency cycle, or broad prompt abstraction.
- Preserve the existing rendered contract shape unless wording needs to reflect compact/prebuilt generation accurately.
- Keep runtime fallback compact-only for source/dev checkouts without the build artifact.

## Verification

- Focused assistant CLI surface tests.
- `packages/assistant-engine` coverage lane or truthful `pnpm test:diff`.
- `pnpm typecheck`.
- Direct benchmark showing prebuilt runtime load avoids CLI manifest generation.

## State

- Diagnosis found `vault-cli --llms-full --format json` is ~5.9 MB pretty JSON and was called before compact fallback in the provider hot path.
- The renderer uses command names/descriptions and, only for small command sets, required inputs; it does not use output schemas.
- Assistant-engine now generates a compact-only `cli-surface-contract.generated.json` artifact during package build.
- Runtime reads the generated artifact before any state or CLI manifest generation, rejects malformed generated artifacts, and only uses compact `vault-cli --llms --format json` as a source/dev fallback.
- The assistant bootstrap schema is v4 and rejects legacy mode-bearing persisted contracts.
Status: completed
Updated: 2026-06-01
Completed: 2026-06-01
