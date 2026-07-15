# Personality Dashboard Convergence

## Goal

Make hosted Humor, Push, and Detail changes requested in a private conversation update the Settings projection durably and causally, then enable the existing dashboard controls only after the web, database, and hosted runtime rollout prerequisites are proven.

## Constraints

- Keep `bank/preferences.json` as canonical personality truth and Postgres as the Settings display/write projection.
- Route hosted conversation and Settings mutations through one durable web-owned handoff instead of adding a best-effort reverse copy or reconciliation job.
- Preserve sparse per-dial updates, explicit resets, defaults-versus-custom source semantics, and exact mailbox causal ordering across conversation and Settings.
- Reject stale projection writes field by field; a later change to one dial must not suppress a fresh sibling change.
- Preserve private-direct audience gating, active runtime write-fence authority, member binding, and ordinary reply availability.
- Keep local, non-hosted assistant-style writes vault-local because they have no dashboard projection.
- Do not enable the production flag until the database cutover and immediate Cloudflare runner convergence are verified for the merged implementation.

## Plan

1. Map the canonical vault, web projection, mailbox sequence, callback authority, and every personality mutation path; capture the verified state-inconsistency finding.
2. Extend the existing hosted assistant-personalization callback so hosted dial set/reset operations transactionally update the projection and append the existing sparse preference event at the accepted input's causal sequence.
3. Add per-dial projection causal watermarks and an additive migration so stale conversation callbacks cannot overwrite newer Settings intent.
4. Keep the headless tool's local path unchanged while routing the hosted path through the durable callback and returning the authoritative post-write effective snapshot.
5. Add focused contract, web transaction, runtime bridge, ordering, reset, idempotency, and stale-race regressions; update durable architecture, product, runtime-protocol, and deployment docs.
6. Run scoped and full required verification, completion audits, parent final review, and the PR/ReviewGPT/CI lane.
7. After merge, deploy Web with the gate off, let the old-function drain and database cutover complete, deploy Cloudflare with immediate container convergence, set the Vercel gate to `1` and redeploy Web, then prove both Settings-to-conversation and conversation-to-Settings ordering in production.

## Verification

- Prisma generate/validate and the Web prepared typecheck pass.
- Focused Web route, transaction, migration, assistant-engine, hosted-execution,
  assistant-runtime bridge, and Cloudflare port tests pass.
- Package typechecks pass for Web, Cloudflare, assistant-engine,
  assistant-runtime, and hosted-execution.
- The required prompt review returned zero findings; coverage-write added the
  same-value Settings barrier regression and all focused coverage lanes pass.
- The state-inconsistency re-audit returned zero verified findings after the
  retired direct-vault resolver was hard-rejected and deleted from current
  source.
- Full acceptance reached green workspace typecheck, docs/artifact guards, all
  Web tests, Web lint/build, and owner coverage before unrelated machine-wide
  OOM and timing failures; isolated fallbacks pass. Final verification will run
  again after rebasing onto current `main`.

## State

Implementation and local audit are complete. Rebase, final verification,
PR/ReviewGPT/CI, deployment, and gate enablement remain; the production flag is
still disabled.

Status: active
Updated: 2026-07-15
