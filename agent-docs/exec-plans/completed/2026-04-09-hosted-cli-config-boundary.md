# Enforce the hosted assistant CLI config boundary

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Make hosted assistant/provider turns treat incur config autodiscovery as local-only convenience instead of an accidental hosted runtime input.
- Keep the existing hosted snapshot contract narrow: portable vault state plus minimal operator config, not arbitrary home-directory CLI defaults.

## Success criteria

- Hosted assistant CLI invocations explicitly opt out of incur config autodiscovery.
- Hosted CLI-surface bootstrap uses the same opt-out path so manifest discovery cannot drift from command execution.
- Focused tests prove hosted invocations add the opt-out while local invocations keep existing behavior.
- Durable docs state that `~/.config/murph/config.json` is local-only and does not travel into hosted runs.

## Scope

- In scope:
- `packages/assistant-engine/**` for the assistant CLI invocation path and focused tests
- `packages/assistant-runtime/**` only if small threading changes are needed to pass hosted context cleanly
- `packages/cli/README.md`, `packages/runtime-state/README.md`, and `ARCHITECTURE.md` for durable boundary docs
- Out of scope:
- snapshotting `~/.config/**` into hosted bundles
- redesigning operator config or moving existing local CLI defaults into canonical config in this change
- broader hosted runtime refactors unrelated to the CLI config boundary

## Constraints

- Keep the implementation small and behaviorally explicit.
- Do not widen hosted snapshot contents.
- Preserve existing local CLI UX for non-hosted runs.

## Risks and mitigations

1. Risk: The fix could accidentally change local provider-turn behavior.
   Mitigation: Gate the opt-out on hosted execution context only and cover both hosted and local expectations in tests.
2. Risk: Manifest bootstrap and command execution could diverge.
   Mitigation: Thread the same hosted-context decision through both code paths.
3. Risk: The repo docs could still imply the old accidental behavior.
   Mitigation: Update the durable docs that define hosted snapshot and CLI config behavior.

## Tasks

1. Patch the assistant CLI execution path to add an explicit hosted-only config opt-out.
2. Thread hosted execution context through CLI-surface bootstrap manifest reads.
3. Add focused regression tests for hosted vs local invocation argv.
4. Update durable docs to mark incur config autodiscovery as local-only.
5. Run required verification, complete the required final review pass, and commit the scoped diff.

## Decisions

- The long-term architectural fix is to keep incur config local-only and make hosted runtime behavior ignore it explicitly rather than widening bundle portability.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages`
- Expected outcomes:
- Assistant-engine and hosted-runtime paths stay green under package verification, and hosted CLI invocation tests prove the explicit config boundary.
Completed: 2026-04-09
