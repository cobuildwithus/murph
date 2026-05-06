# Hosted runner IPC result transport

Status: completed
Created: 2026-05-06
Updated: 2026-05-06

## Goal

- Stop treating isolated runner stdout as the trusted child-result channel.
- Keep the fix small and maintainable by using Node IPC between the existing Cloudflare supervisor and known Node child process.

## Success criteria

- Child runtime stdout/stderr remain diagnostic logs only.
- The supervisor accepts exactly one structured IPC child result and validates it before returning.
- Spoofed stdout result frames do not affect invocation success/failure.
- Missing, malformed, duplicate, or success-with-nonzero-exit child results fail closed.
- Focused Cloudflare runner tests and required repo verification/audits complete or blockers are documented.

## Scope

- In scope:
- `apps/cloudflare` hosted runner parent/child result transport.
- Focused tests around spoofing, malformed/missing/duplicate results, nonzero exit, and log forwarding.
- Out of scope:
- Grandchild broker isolation for a stronger same-process-adversary threat model.
- Broad hosted runtime lifecycle or checkpoint refactors.
- Assistant provider/runtime behavior changes unrelated to child result transport.

## Constraints

- Technical constraints:
- Preserve current process-group cleanup, warm launcher root behavior, scrubbed child env, stdin bootstrap payload, and stdout/stderr redaction.
- Keep transport ownership in `apps/cloudflare/src/runner-job-transport.ts`; do not move Cloudflare child-process protocol into shared public packages.
- Product/process constraints:
- Preserve unrelated working-tree edits and active ledger rows.
- Coordinate around the active production latency row that also names `apps/cloudflare/src/node-runner-isolated.ts`.

## Risks and mitigations

1. Risk: IPC fixes stdout spoofing but is not a sandbox boundary for arbitrary same-process code.
   Mitigation: Document this as the chosen minimal boundary and keep grandchild broker isolation out of this scoped fix.
2. Risk: Existing tests assume stdout result framing.
   Mitigation: Update focused tests to use IPC helpers and add regressions for the former spoof path.

## Tasks

1. Replace stdout result parsing with structured IPC result delivery.
2. Add strict parent-side result count, shape, and exit-code validation.
3. Update child helper/tests to send results over IPC and fail closed without IPC.
4. Run focused verification, required audit passes, and final scoped commit or safe closeout.

## Decisions

- Use Node IPC instead of fd 3, temp files, or nonce-prefixed stdout because the launched child is intentionally Node and IPC keeps the protocol structured without adding path or fd conventions.
- Do not implement grandchild broker isolation in this task; it is a stronger threat model with materially more lifecycle complexity.

## Verification

- Passed:
  - `pnpm --dir ../.. exec vitest run apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/hosted-runner-static-secret-invariant.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage`
  - `pnpm --dir apps/cloudflare typecheck`
  - `git diff --check -- apps/cloudflare/src/node-runner-isolated.ts apps/cloudflare/src/node-runner-child.ts apps/cloudflare/src/runner-job-transport.ts apps/cloudflare/test/node-runner-isolated.test.ts apps/cloudflare/test/node-runner-child.test.ts apps/cloudflare/test/hosted-runner-static-secret-invariant.test.ts agent-docs/exec-plans/active/2026-05-06-hosted-runner-ipc-result.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Audits:
  - Security/privacy review: no findings.
  - Simplify review: two cleanup findings applied; remaining low test-dedup polish left out to avoid unnecessary churn.
  - Coverage-write: no changes needed; focused suite already covers the new failure modes.
  - Task-finish review: no findings.
- Blocked broader check:
  - `bash scripts/workspace-verify.sh test:diff ...` currently fails in unrelated `apps/cloudflare/test/hosted-local-active-turn-latency-e2e.test.ts` type errors for `label` on the local database fixture.
Completed: 2026-05-06
