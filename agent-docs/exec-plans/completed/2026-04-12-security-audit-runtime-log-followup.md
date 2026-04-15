# Land watched security audit runtime/logging follow-up patch

Status: completed
Created: 2026-04-12
Updated: 2026-04-12

## Goal

- Land the still-applicable changes from `murph-security-audit.patch` so hosted device-sync runtime updates fail closed on stale observed state and hosted execution error surfaces stop leaking raw identifiers or unsanitized error text through logs, cron JSON, and persisted outbox fields.

## Success criteria

- Hosted device-sync runtime compare-and-swap updates reject stale local-state and disconnect/token mutations rather than mutating newer runtime state.
- Hosted-web device-sync callers send the observed runtime version fields needed for those guards and fail with a retryable conflict if the runtime rejects the write.
- Hosted execution log and outbox error handling reuse the shared safe-message normalization helpers so user ids and raw opaque error text are not echoed back through operator logs or persisted status fields.
- Required verification, audit passes, same-thread review request, wake re-arm, and scoped commit complete, or unrelated blockers are identified precisely.

## Scope

- In scope:
- `apps/cloudflare/src/device-sync-runtime-store.ts`
- `apps/cloudflare/src/user-key-store.ts`
- `apps/cloudflare/test/device-sync-runtime-store.test.ts`
- `apps/web/app/api/internal/hosted-execution/usage/cron/route.ts`
- `apps/web/src/lib/device-sync/{agent-session-service.ts,prisma-store/local-heartbeats.ts,wake-service.ts}`
- `apps/web/src/lib/hosted-execution/{control.ts,dispatch.ts,logging.ts,outbox.ts,usage.ts}`
- targeted touched-owner tests only if needed for direct proof
- Out of scope:
- New security findings outside the downloaded patch.
- Broader canonical-vault trust-boundary or local control-plane review beyond the returned artifact.

## Constraints

- Technical constraints:
- Preserve unrelated dirty `apps/cloudflare`, `packages/assistant-runtime`, `packages/cloudflare-hosted-control`, `packages/messaging-ingress`, and `scripts/verify-workspace-boundaries.mjs` edits already in the worktree.
- Treat the downloaded patch as behavioral intent, not overwrite authority; merge against the current repo layout and existing tests.
- Product/process constraints:
- Follow the high-risk repo workflow: active ledger row, active plan, required verification, required audit passes, same-thread file-attached review request, detached wake re-arm, and scoped commit.

## Risks and mitigations

1. Risk: The patch crosses two app owners on a security-sensitive runtime seam.
   Mitigation: Keep the landing limited to the exact patch files and use coverage-bearing verification plus the required audit passes.
2. Risk: Cloudflare and hosted-web already have unrelated dirty edits in adjacent areas.
   Mitigation: Touch only clean files from the patch slice and avoid overlapping package-boundary files already in progress.
3. Risk: Error-message sanitization can change operator-observable behavior and stored retry state.
   Mitigation: Reuse the shared hosted-execution normalization helpers instead of inventing new redaction rules.

## Tasks

1. Register the bounded wake lane in the coordination ledger and active plan.
2. Port the watched patch intent into the live Cloudflare and hosted-web files, adding the new helper and focused runtime-store regression test.
3. Run the required verification and audit flow, then fix only task-caused issues.
4. Send the required same-thread review request with attached files, arm the next wake hop, and create the scoped commit.

## Decisions

- Keep the CAS behavior centralized in the Cloudflare device-sync runtime store and update callers to provide the needed observed version fields instead of adding caller-local conflict heuristics.
- Centralize hosted execution safe log formatting in one small hosted-web helper backed by `@murphai/hosted-execution` observability utilities.
- Sanitize persisted outbox `lastError` values on both direct dispatch failure writes and when consuming status/event errors from Cloudflare.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff apps/cloudflare apps/web`
- Expected outcomes:
- Green verification for the touched app slices, or clearly separated unrelated blockers with evidence.

## Outcome

- Landed the watched security audit patch across the hosted device-sync runtime store, hosted-web device-sync callers, and hosted execution logging/error formatting seams.
- Hardened the Cloudflare runtime store so stale observedUpdatedAt or observedTokenVersion writes no longer mutate local state or clear tokens during stale disconnect-like updates.
- Updated hosted-web refresh, disconnect, and heartbeat callers to send the observed runtime version fields and fail closed with retryable runtime conflicts when stale writes are rejected.
- Routed hosted execution control, dispatch, usage, cron, and outbox error surfaces through the shared safe formatter so raw bearer/email-like content and over-detailed operator text do not flow straight into logs or persisted outbox `lastError`.
- Added focused regression coverage for the Cloudflare runtime store CAS behavior, legacy schema rejection, metadata sanitization, hosted-web log message changes, and the new hosted execution logging helper.

## Verification results

- Scoped verification mode was used after broader repo/app commands proved untruthful for this narrow lane because of unrelated pre-existing failures elsewhere in the dirty worktree.
- FAIL unrelated pre-existing: `pnpm typecheck`
  `packages/assistantd/test/http-coverage.test.ts` and `packages/assistantd/test/http.test.ts` fail on pre-existing `AssistantLocalService` typing mismatches around `providerOptions`; this slice does not touch `packages/assistantd`.
- FAIL unrelated dirty-tree broadening: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/device-sync-runtime-store.ts apps/cloudflare/src/user-key-store.ts apps/cloudflare/test/device-sync-runtime-store.test.ts apps/web/app/api/internal/hosted-execution/usage/cron/route.ts apps/web/src/lib/device-sync/agent-session-service.ts apps/web/src/lib/device-sync/prisma-store/local-heartbeats.ts apps/web/src/lib/device-sync/wake-service.ts apps/web/src/lib/hosted-execution/control.ts apps/web/src/lib/hosted-execution/dispatch.ts apps/web/src/lib/hosted-execution/logging.ts apps/web/src/lib/hosted-execution/outbox.ts apps/web/src/lib/hosted-execution/usage.ts`
  The diff-aware lane broadened into `apps/cloudflare verify` and failed in unrelated `apps/cloudflare/test/node-runner.test.ts` on a `providerMetadataJson` typing error outside this patch slice.
- PASS: `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/device-sync-runtime-store.test.ts`
- PASS: `pnpm --dir apps/web typecheck`
- PASS: `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/agent-session-service.test.ts test/hosted-execution-control.test.ts test/hosted-execution-dispatch.test.ts test/hosted-execution-routes.test.ts`
- PASS: `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-execution-outbox.test.ts -t "keeps not-configured queued outcomes retryable as delivery failures|maps backpressured outcomes onto the right retry status"`
- PASS: `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-execution-logging.test.ts`
- PASS direct scenario proof: `pnpm exec tsx --eval '...'`
  Confirmed a stale disconnect returned `tokenUpdate: "skipped_version_mismatch"` while leaving the runtime snapshot `status: "active"` and `tokenVersion: 2`, and confirmed `formatHostedExecutionSafeLogError` redacts fake bearer/email content to `authorization=Bearer [redacted] [redacted-email]`.

## Audit results

- PASS after follow-up fix: required final review
  Restored missing runtime-store regression coverage for legacy schema rejection and metadata sanitization in `apps/cloudflare/test/device-sync-runtime-store.test.ts`.
  Added direct hosted-web helper coverage in `apps/web/test/hosted-execution-logging.test.ts` so the redaction behavior is automated instead of only proven ad hoc.
Completed: 2026-04-12
