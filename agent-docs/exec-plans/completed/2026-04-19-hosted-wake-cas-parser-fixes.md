# Hosted Wake CAS And Parser Fixes

## Goal

Fix the remaining hosted-wake correctness blocker by moving assistant delivery behind the winning web cursor CAS, and align the hosted parser shape with the live inline conversation-path contract.

Success criteria:
- seq-advancing web cursor CAS is the gate before hosted assistant delivery drain runs
- retries after seq CAS resume finalize/publish without re-entering pre-CAS delivery
- dead standalone hosted parser-maintenance seams are removed or no longer implied by docs/tests

## Constraints / Assumptions

- Do not overlap with the separate hosted-wake boundary-fixes lane already handling web materialization authority, snapshot typing, README/root-doc updates, and fetch-proof hardening.
- Preserve unrelated in-flight worktree edits.
- Keep the write set narrow to Cloudflare wake-drain files plus assistant-runtime parser cleanup/test surfaces.

## Key Decisions

- Treat pre-CAS delivery as the only correctness blocker in this lane.
- Defer assistant due-work ownership and other web-owned control-plane fixes to the overlapping lane already in flight.
- Keep parser handling inline on `conversation.message`; do not add `parser.drain`.

## State

- In progress; implementation and focused verification are complete, required audit passes are running.

## Done

- Loaded repo routing, verification, reliability, and completion docs.
- Reviewed current code and subagent findings for delivery ordering, parser shape, snapshot-only CAS, coalescing behavior, and cleanup debt.
- Narrowed scope to avoid overlap with the separate hosted-wake boundary-fixes lane.
- Confirmed same-seq snapshot-only cursor CAS is already landed and covered in the current worktree, so it is no longer part of this lane.
- Landed the Cloudflare post-CAS finalize path so committed pending state is resumed only after the winning web seq CAS.
- Added focused Cloudflare proofs for finalized snapshot publish after seq CAS and for the lost-CAS path never resuming finalize.
- Confirmed the assistant-runtime/parser surface already matches the inline `conversation.message` shape in this workspace, so no parser code changes were required in this lane.
- Ran focused verification:
  - `pnpm exec vitest --config apps/cloudflare/vitest.config.ts run apps/cloudflare/test/user-runner-hosted-wake.test.ts apps/cloudflare/test/user-runner-finalize-cas-conflict.test.ts --no-coverage` passed.
  - `pnpm exec tsc -p apps/cloudflare/tsconfig.typecheck.json --pretty false` failed only on unrelated `apps/cloudflare/test/runner-container.test.ts` stub drift (`ownsInternalWorkerProxyToken` missing).
  - `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-wake-processor.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts apps/cloudflare/test/user-runner-finalize-cas-conflict.test.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/workers/test-hosted-wake-control.ts` failed on unrelated existing blockers: `apps/web/package.json` public `./testing` boundary violation and the same `apps/cloudflare/test/runner-container.test.ts` stub drift.

## Now

- Wait on required `coverage-write` and `task-finish-review` audit passes.

## Next

- Resolve any audit findings and rerun affected focused checks if needed.
- Commit only the touched paths for this lane.

## Open Questions

- UNCONFIRMED: whether any required audit pass will ask for additional proof beyond the current focused Cloudflare tests.

## Working Set

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-wake-processor.ts`
- `apps/cloudflare/test/user-runner-hosted-wake.test.ts`
- `apps/cloudflare/test/user-runner-finalize-cas-conflict.test.ts`
- `apps/cloudflare/test/user-runner.test.ts`
- `apps/cloudflare/test/workers/test-hosted-wake-control.ts`
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
