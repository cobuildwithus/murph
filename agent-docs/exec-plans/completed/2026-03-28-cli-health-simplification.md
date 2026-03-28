# CLI Health Simplification

## Goal

Shrink the CLI health abstraction stack incrementally so behavior ownership is explicit, while preserving the current user-facing CLI surface, generated help/schema output, and existing assistant/manifest registration.

## Why

- The current health stack spreads one taxonomy across contracts, CLI descriptors, generic method-name registries, dynamic service builders, and command factories.
- One small change currently ripples across descriptors, method-name unions, runtime factories, and registration layers.
- `supplement` is the clearest leak: it behaves like a protocol alias surface but currently lives as a CLI-only exception outside the generic health service path.

## Constraints

- No rewrite.
- Preserve existing root commands, subcommands, help text, schema output, and direct service-binding manifests.
- Keep descriptor-driven docs/help generation stable for this pass.
- Avoid widening overlap with adjacent CLI lanes already editing `assistant-cli-tools.ts`, `vault-cli-command-manifest.ts`, `integrated-services.ts`, and `types.ts`.

## Incremental Shape For This Pass

1. Pilot explicit ownership with the small registry-doc cluster: `goal`, `condition`, `allergy`.
2. Encode `protocol` plus the `supplement` alias seam in one explicit adapter module so supplement behavior is no longer a hidden integrated-services exception.
3. Keep descriptor metadata as the manifest for docs/help/registration, but stop using it to construct runtime behavior for the pilot families.
4. Leave non-pilot health families on the existing descriptor-driven fallback so the change stays narrow.

## Expected Files

- `packages/cli/src/usecases/health-services.ts`
- `packages/cli/src/usecases/integrated-services.ts`
- `packages/cli/src/usecases/types.ts`
- New explicit health-adapter module(s) under `packages/cli/src/usecases/`
- Targeted stability tests in `packages/cli/test/health-tail.test.ts` and `packages/cli/test/incur-smoke.test.ts`

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Direct CLI scenario proof for the affected health commands if scripted coverage leaves a gap

## Completion Notes

- Required audit sequence after implementation: `simplify` -> `test-coverage-audit` -> `task-finish-review`.
- Close this plan with `scripts/finish-task` if the task lands in this turn.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
