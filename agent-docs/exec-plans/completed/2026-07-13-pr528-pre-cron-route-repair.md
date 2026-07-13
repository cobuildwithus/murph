# PR 528 pre-cron route repair

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Ensure persisted direct-Linq route-transition proof repairs legacy personal-home reminders before any due cron occurrence can freeze the former explicit target.

## Success criteria

- Hosted automation repairs from the complete pending-input proof set after reply handoff and before cron processing.
- Repair failure aborts the pass before cron, status/checkpoint tail work, or proof consumption.
- More than 50 pending inputs, refresh-added inputs, sequential transitions, and foreground provider ordering retain focused regression proof.
- Required owner tests, typechecks, completion audits, exact-head CI, one exact-corrected-head ReviewGPT audit, and review threads are clean.

## Scope

- In scope: hosted automation pass ordering, complete observed pending-input ID exposure, removal of the later workspace repair, focused tests, PR evidence.
- Out of scope: new schedulers, queues, lifecycle managers, inferred route authority, or unrelated onboarding timing changes.

## Constraints

- Keep repair in the hosted automation owner and reuse the existing pending-input wake/retry path.
- Preserve foreground provider execution before repair and retain foreground cron deferral.
- Keep heavy verification serial and do not duplicate browser audits for one exact head.

## Tasks

1. Add a fail-closed pre-cron pass hook and expose the complete observed pending-input ID set.
2. Run the canonical legacy-route repair from the hosted owner and remove workspace post-pass repair.
3. Add focused ordering, backlog, failure, and transition coverage.
4. Verify, audit, commit, push, and obtain one exact-corrected-head ReviewGPT result.
5. Clear exact-head CI, findings, threads, and merge-readiness gates.

## Decisions

- Accepted the corrected-head ReviewGPT High after tracing the production scan-to-cron path and the bounded background selection.
- Use one ordering barrier rather than new durable retry machinery; thrown repair failures leave the existing pending proof and wake path intact.

## Verification

- `pnpm --filter @murphai/assistant-engine exec vitest run test/assistant-automation-runtime.test.ts test/managed-automations-core.test.ts --maxWorkers=1 --no-file-parallelism` — passed (167 tests).
- `pnpm --filter @murphai/assistant-runtime exec vitest run test/hosted-runtime-maintenance.test.ts test/hosted-runtime-turn-input.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts --maxWorkers=1 --no-file-parallelism` — passed (288 tests).
- `pnpm --filter @murphai/assistant-engine typecheck` — passed.
- `pnpm --filter @murphai/assistant-runtime typecheck` — passed.
- Serial `pnpm test:diff` for the four changed production files — dependency, workspace-boundary, cycle, stale-name, Temporal, crypto, raw-health-log, all six affected typechecks, and assistant-cli/assistant-engine/assistant-runtime/assistantd tests passed. The CLI dependent suite reached a known unrelated artifact-repair-lock timeout cluster (119 failures after 957 passes and 1 skip); its first root error was `Timed out waiting for the CLI runtime artifact repair lock to clear` in `packages/cli/test/cli-test-helpers.ts`.
- Parent security/privacy audit — passed: proof IDs remain vault-local, route evidence is strictly filtered to direct inbound Linq records, and logs expose only a repair count.
- Parent simplicity/ownership audit — passed: one engine ordering barrier delegates route-specific work to the hosted runtime owner; the later duplicate workspace repair was deleted; failure reuses the existing pending-input wake/rollback path.
- `git diff --check` — passed.
Completed: 2026-07-13
