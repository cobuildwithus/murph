# Hosted Runtime Fetch Diagnostics

## Goal

Identify the likely June 1 regression source for hosted workspace snapshot direct R2 upload failures, then add simple generalized raw-redacted error diagnostics for hosted upstream/provider fetch failures without exposing snapshot ids, object keys, presigned URLs, paths, payloads, or user identifiers.

Success criteria:

- Hosted upstream/provider failures emit enough raw-redacted error text to identify the failing boundary.
- Direct R2 checkpoint failures benefit from the generic hosted fetch diagnostics without an R2-specific wrapper.
- Diagnostics redact object keys, snapshot ids, URLs, local paths, payloads, direct identifiers, and secret-like values.
- Focused hosted-runtime tests cover the new diagnostic surface.
- Verification and required completion audits are run or any blockers are recorded.

## Constraints

- Preserve existing dirty hosted-runtime/provider-fetch/outbox changes unless they must be coordinated explicitly.
- No branch or worktree changes.
- Do not expose secrets, local paths, direct identifiers, snapshot object keys, or presigned URL material.
- Keep Cloudflare as execution transport and web as workspace checkpoint owner.

## Current Evidence

- User-reported incident at 2026-06-01 14:53 ET: duplicate Linq deliveries followed by deferred runtime residue and no hosted workspace checkpoint commit.
- Device sync appeared drained; hosted workspace stayed uncheckpointed with mailbox lag.
- Repeated idle checkpoint failure text: `Hosted workspace snapshot direct R2 upload request failed.`
- Restarted local hosted runtime at 2026-06-01 15:26 ET.
- Before the next checkpoint, mailbox imports were already caught up in-process at conversation seq `7` and system seq `4`, but the durable workspace row stayed version `0`, so demand kept seeing lag.
- The restarted runner completed an idle workspace snapshot at 2026-06-01 15:36:36 ET. The direct R2 upload finished successfully, workspace version advanced to `1`, snapshot ref became present, and redacted status persisted the imported mailbox seqs.
- No hosted runtime log rows were written after the successful checkpoint aside from device-sync sweeper activity, which indicates the mailbox-driven replay loop stopped once durable workspace progress existed.
- Recent candidate commits include:
  - `7b0ebf08f` `Harden hosted provider fetch boundaries`
  - `e5b142964` `Remove hosted attachment ambient fetch fallback`
  - `569475578` `Fix hosted runtime latency fence`
- Static read: committed provider-fetch hardening changed the general runtime fetch to internal/plain fetch and gives direct R2 external URLs a raw fetch path, so it is not proven to be the direct R2 failure cause. The observed message points at a transport-level failure inside the existing hosted fetch wrapper; the next run needs the underlying redacted cause text.
- Updated assessment: current source plus a restarted hosted-local runner no longer reproduces the direct R2 upload failure. The strongest supported explanation is stale hosted-local runner/bundle/process state across the June 1 provider-fetch/platform changes; the exact old low-level R2 transport cause was not recoverable because the pre-restart failure rows only persisted wrapper-level detail.

## Plan

1. Inspect recent provider-fetch, public-internet fetch, and R2 presign/upload changes. Done.
2. Add one generic raw-redacted error-text primitive and wire it through hosted runtime error metadata. Done.
3. Add external provider fetch transport-failure logging without wrapping or changing thrown errors. Done.
4. Add focused tests for raw-redacted diagnostics, direct R2 transport failures, provider failures, checkpoint failure persistence, and child failure classification. Done.
5. Run focused Cloudflare tests, typecheck, diff verification, required audits, then finish with a scoped commit if safe. Done; scoped commit blocked by overlapping unrelated dirty work in the same hosted runtime files.

## Verification

- Passed: focused Cloudflare node tests for runtime bridge, hosted runtime redaction, runner platform, and node runner child diagnostics.
- Passed: `pnpm --dir apps/cloudflare typecheck`.
- Passed: `pnpm test:diff` for the Cloudflare and assistant-runtime diff scope.
- Passed: `git diff --check`.
- Runtime proof: restarted hosted-local dev completed the idle workspace snapshot and advanced durable workspace version to `1`.

## Handoff

- No scoped commit was created because the working tree already had unrelated dirty changes in overlapping hosted runtime files. The active plan was archived and the coordination ledger row was removed to avoid stale plan state.
Status: completed
Updated: 2026-06-01
Completed: 2026-06-01
