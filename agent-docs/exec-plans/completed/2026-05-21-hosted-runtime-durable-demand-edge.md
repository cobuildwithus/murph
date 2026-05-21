# Hosted runtime durable demand edge

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Prevent accepted hosted-runtime starts from consuming non-durable demand before the
  runtime has durable work to import, and clean up two remaining runtime processing
  retry/timeout edge cases.

## Success criteria

- Manual, browser-vault refresh, device-sync recovery, and mailbox-lag recovery
  wakes are represented by durable mailbox/control facts before Temporal is
  signaled.
- Temporal remains a pointer/wake orchestrator and does not need to retain those
  control requests in volatile workflow flags for correctness.
- `retry_later` keeps its shared response contract but backs off persistent
  infrastructure failures more slowly than startup races.
- Legacy `630_000`/`660_000` ensure-processing timeout values are normalized
  before the first processing activity.
- Focused tests cover the new durable control request path and the two smaller
  cleanup fixes.

## Scope

- In scope:
  - Hosted runtime signal helpers, mailbox/control contracts, mailbox routing,
    runtime demand selection, Cloudflare ensure-processing retry timing, and
    Temporal workflow option normalization.
  - Focused web, hosted-execution, assistant-runtime, Cloudflare, and Temporal
    regression tests as needed.
- Out of scope:
  - Replacing Temporal as orchestrator.
  - Polling Cloudflare failure state from web demand.
  - Broad hosted-runner scheduling or mailbox import rewrites.

## Constraints

- Technical constraints:
  - Signals stay pointer-only wake hints.
  - Durable demand truth stays in web-owned mailbox/control state and is acked by
    runtime import/watermark progress.
  - Preserve existing deploy-skew/legacy parsing compatibility where feasible.
- Product/process constraints:
  - Do not expose user identifiers, local paths, mailbox payloads, prompts,
    secrets, or raw auth material in logs/docs/tests.
  - Preserve unrelated dirty worktree edits and overlapping active ledger rows.

## Risks and mitigations

1. Risk: Control mailbox items wake the runtime but lose source-specific behavior.
   Mitigation: Carry the control reason through the wake contract and runtime
   system mailbox handling, including browser-vault refresh force semantics.
2. Risk: Broad runtime contract changes cause deploy skew.
   Mitigation: Keep new items additive and retain legacy signal flags as wake hints.

## Tasks

1. Add a durable hosted runtime control wake contract and mailbox route.
2. Persist non-mailbox runtime signals as durable system mailbox items before
   signaling Temporal.
3. Teach runtime demand to derive source/reason from control mailbox backlog when
   present.
4. Add per-reason `retry_later` backoff and normalize legacy ensure-processing
   timeout values in initial workflow options.
5. Add focused regression tests and run required verification.

## Decisions

- Use the existing hosted mailbox/system lane as the durable control ledger so
  runtime progress is acknowledged by the same import watermarks as other
  mailbox-backed demand.

## Verification

- Commands to run:
  - Focused affected Vitest files.
  - `pnpm typecheck`.
  - Repo diff/privacy checks required by the completion workflow.
- Expected outcomes:
  - Focused tests pass.
  - Typecheck passes or any unrelated pre-existing failure is reported with a
    clear boundary.
Completed: 2026-05-21
