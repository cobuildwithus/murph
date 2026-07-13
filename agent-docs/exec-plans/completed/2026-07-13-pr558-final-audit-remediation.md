# PR 558 final audit remediation

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Make PR #558's self-service leave and newsletter opt-out authority causally
  bound to the accepted mailbox turn, while guaranteeing durable share cleanup
  remains serviceable when the destination runtime is inactive.

## Success criteria

- Remove the ambiguous legacy `selfOptOut` protocol and its pending-frontier
  inference.
- Inactive reconciliation derives pending system maintenance from durable
  mailbox lag and dispatches only the existing no-AI maintenance mode.
- That maintenance mode imports and checkpoints the system lane before media
  retention without entering assistant/model/provider work.
- Focused tests, relevant package typechecks, required completion audits, CI,
  and one clean final exact-head ReviewGPT audit all pass.

## Scope

- In scope: group-tool request parsing, hosted mailbox cleanup, inactive
  reconciliation, Temporal dispatch, no-AI runtime maintenance import, focused
  tests, and rollout/runtime protocol docs.
- Out of scope: new queues, detached retry workers, model execution while
  inactive, and unrelated runtime lifecycle changes.

## Constraints

- Technical constraints: keep the durable mailbox as the cleanup source of
  truth; preserve runtime workspace write fencing; do not process the
  conversation lane or execute queued system work in inactive maintenance.
- Product/process constraints: preserve live/replayed leave and opt-out,
  remove unsafe compatibility instead of trusting model-authored identity, and
  keep the PR draft until a clean audit covers the final corrected head.

## Risks and mitigations

1. Risk: importing system mail while inactive could execute user-visible work.
   Mitigation: import/checkpoint the system lane only; do not run the system
   mailbox execution phase, assistant phase, model, or provider egress.
2. Risk: removing the legacy request breaks a Web-first mixed-version rollout.
   Mitigation: require an ordinary coordinated drain/cutover and document it in
   the durable deployment contract.

## Tasks

1. Delete the legacy self-opt-out request shape and pending-frontier helper.
2. Expose inactive system mailbox lag to reconciliation and dispatch no-AI
   maintenance when it is pending.
3. Import/checkpoint the system lane inside the existing maintenance path and
   preserve retry/batch continuation wakes.
4. Add focused regressions and update durable rollout/runtime documentation.
5. Verify, audit, commit, push, re-audit the exact head, and finish PR gates.

## Decisions

- Reject the pending-frontier bridge: no server-owned causal identifier exists
  in the legacy request, so any inference is ambiguous.
- Reuse the existing `inbox_media_retention` processing mode as bounded no-AI
  maintenance instead of adding a queue or a second runtime lifecycle.
- Gate the newly command-producing inactive-system Temporal branch with the
  active `hosted-runtime-inactive-system-maintenance` patch id. Pre-patch
  histories keep their prior wait command; new executions may dispatch the
  maintenance Activity. Keep the marker until pre-patch histories drain, then
  move through `deprecatePatch()` before eventual removal.
- Require a coordinated Web/runner/Temporal protocol cutover. The deleted
  sender-string request has no causal server-owned identifier, so a mixed
  compatibility bridge would be unsound.

## Verification

- Focused hosted-execution parser tests: 37 passed.
- Focused Web group/mailbox/reconciliation tests: 155 passed.
- Focused assistant-runtime entrypoint tests: 208 passed.
- Hosted Temporal package tests: 79 passed; the replay-gate-focused files
  account for 21 passing tests.
- Relevant hosted-execution, assistant-runtime, Temporal, and prepared Web
  typechecks passed; scoped Web lint passed.
- `pnpm hosted-temporal:guard`, `pnpm docs:drift`, and
  `pnpm test:scenario-integrity` passed.
- The serial diff-aware lane passed every selected owner and reverse dependent:
  repo guards and 308 repo-tool tests, affected typechecks, affected package
  tests, package-boundary verification, Web build/lint/tests, and Cloudflare
  verification.
- Direct proof covers canonical mailbox-id authority, parser rejection of the
  deleted legacy request, inactive system-versus-conversation lag, pre-patch
  Temporal replay behavior, system-only import without assistant/model work,
  retryable import without watermark advancement, and stale share-id regrant
  preservation.

## Completion audits

- Final ReviewGPT on the previous PR head found two accepted High issues: the
  non-causal pending-frontier identity inference and inactive cleanup that
  could remain unserviceable. This remediation removes the former and makes
  the latter durable without AI work.
- Parent security/privacy tracing found no remaining medium-or-higher issue:
  authority remains bound to live canonical mailbox ids and current routes;
  inactive maintenance imports only system-lane work under the workspace write
  fence and exposes counts/watermarks rather than mailbox payloads.
- Parent coverage review found the proof surface sufficient after adding the
  Temporal replay gate regressions. The required final exact-head ReviewGPT
  round runs only after this scoped commit is pushed.
Completed: 2026-07-13
