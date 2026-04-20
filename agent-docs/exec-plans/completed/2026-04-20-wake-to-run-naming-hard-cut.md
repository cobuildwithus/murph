# Finish the wake-to-run naming hard cut

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Remove the remaining wake-shaped internal naming residue in the Cloudflare runner and `packages/assistant-runtime` so the runtime surface reads as run-centric instead of wake-centric.

## Success criteria

- The targeted Cloudflare runner internals no longer expose `RunnerRunProcessor`'s previous wake-shaped naming or `RunnerRuntimeAlarmScheduler`'s previous wake-shaped naming.
- The targeted hosted-runtime internal types/helpers no longer expose the remaining `HostedWake*` names called out in the task, and the follow-up metric surface now reads in ingress/run terms.
- Directly coupled tests and imports compile and pass without reintroducing wake-shaped behavior through the renamed surfaces.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-run-processor.ts`
- `apps/cloudflare/src/user-runner/runner-runtime-alarm-scheduler.ts`
- directly coupled Cloudflare tests only if required by the rename
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/{callbacks,context,events,execution,models,typing}.ts`
- directly coupled assistant-runtime tests only if required by the rename

## Constraints

- Keep this as a local naming hard cut only; do not change hosted-run protocol behavior.
- Preserve unrelated dirty-tree edits across Cloudflare, hosted web, and shared hosted packages.
- Keep `wake` only where it still refers to real ingress payloads, legacy fixtures, or low-level compatibility seams rather than run-centric runtime orchestration.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/src/user-runner/runner-runtime-alarm-scheduler.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/{callbacks,context,events,execution,models,typing}.ts apps/cloudflare/test packages/assistant-runtime/test`
- planned: `git diff --check`

## Notes

- The runtime protocol is already `runDrain`-centric; this task only removes naming residue that still suggests the old wake-shaped execution model.
- Renames should stay local to owner internals unless a coupled export or test seam requires the new name to propagate outward.
Completed: 2026-04-20
