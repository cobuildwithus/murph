# Minimal conversation wearable status and reconcile

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Let a member ask Murph which wearable accounts are connected and request a
  normal reconciliation from conversation, using the existing hosted account
  list plus the web-owned mailbox/wake authority.
- Replace PR #554 with the smallest coherent read/action slice: status and
  reconcile only. Leave disconnect on the existing authenticated Settings
  surface.

## Success criteria

- Hosted conversation continues to return the existing bounded,
  credential-free account/status list for the active runtime member.
- Hosted conversation can request reconcile through the existing web-owned
  mailbox/wake path and receive a truthful result.
- Local `device account` behavior remains unchanged.
- The change adds no schema, persisted state, provider lifecycle guard,
  disconnect lease, recovery loop, local-account migration, or provider-specific
  branch.
- Focused tests, the routed verification lane, required completion audits,
  final-head CI, and ReviewGPT pass.

## Scope

- In scope: a narrow hosted reconcile contract, existing account-list and CLI
  bridge integration, Cloudflare transport, web owner adapter, focused tests,
  and durable boundary docs.
- Out of scope: conversational disconnect, provider revoke, stale-writer
  fencing, schema or migration changes, connection identity repair, background
  recovery, new confirmation state, provider implementation changes, and UI.

## Constraints

- Technical constraints: `apps/web` remains the sole hosted device-sync owner;
  Cloudflare remains transport-only; member identity comes only from the active
  write fence and signed callback; status and action responses carry no tokens,
  provider payloads, health values, or free-form diagnostics.
- Product/process constraints: preserve conversation-first control without
  making a simple status/reconcile outcome pass through the heavier disconnect
  lifecycle; preserve unrelated working-tree and ledger work.

## Risks and mitigations

1. Risk: a new generic action surface recreates PR #554's breadth.
   Mitigation: add a reconcile-only contract; reuse the existing account list
   for reads and reject disconnect or arbitrary action shapes.
2. Risk: hosted account inspection fetches credential material unnecessarily.
   Mitigation: explicitly request the existing redacted runtime snapshot and
   retain its exact response-shape test.
3. Risk: reconcile reports success without durable work.
   Mitigation: return only after the existing mailbox/wake owner accepts the
   durable intent, and test no-connection and active-connection cases.
4. Risk: overlapping work changes the hosted CLI bridge.
   Mitigation: keep edits narrow, inspect latest `main` first, and rebase/verify
   against the current base before handoff.

## Tasks

1. Trace latest-main account commands, hosted CLI bridge, device-sync runtime
   port, signed Cloudflare web-control routing, and the web scheduled-wake owner.
2. Choose the smallest contract and prove which PR #554 layers can be deleted.
3. Implement hosted reconcile and focused owner-boundary tests.
4. Update only the durable docs whose live boundary changes.
5. Run verification, required audits, parent final review, and scope/shape
   comparison against PR #554.
6. Finish the plan-bearing commit, push, open a draft replacement PR, and run
   CI plus ReviewGPT to a clean merge-ready head.

## Decisions

- Deliver roughly 80% of PR #554's current user-visible value with the account
  list already on `main` plus hosted reconcile. Treat one-account `show` as
  redundant and delete all conversational disconnect preparation.
- Represent manual reconcile as one durable device-sync wake. The hosted
  runtime delegates job materialization to the existing
  `DeviceSyncService.queueManualReconcile` owner, so web does not mutate the
  connection schedule or duplicate provider scheduling policy.
- Do not reuse PR #554 commits. Reimplement on current `main` so review-driven
  lease, migration, recovery, and provider-hardening machinery cannot leak into
  the replacement.
- Do not add assistant prompt prose unless command discovery is proven
  insufficient; the typed CLI surface should be the composable capability.

## Verification

- Passed focused contract, CLI bridge, assistant-runtime, Cloudflare, and web
  tests throughout implementation, including 85 web reconcile/wake tests.
- `pnpm build` passed and prepared the fresh worktree's package artifacts.
- The exact owner-scoped `pnpm test:diff` passed across all seven touched
  owners, including affected package suites, web build/test/lint/typecheck, and
  Cloudflare verification.
- `pnpm verify:acceptance` passed every repository lane except that its
  concurrently scheduled assistant-engine coverage worker exceeded the local
  4 GB Node heap. The exact failed coverage lane then passed alone with an 8 GB
  heap: 154 files and 2,230 tests passed, with one file and four tests skipped.
- The required `coverage-write` pass found no remaining gap after adding direct
  proof for signed-member binding, optional-port deploy skew, and mailbox-only
  manual reconcile. `git diff --check` passed.

## Results

- Reused the hosted account list already on `main` and added only hosted manual
  reconcile; conversational `show` and `disconnect` remain intentionally out of
  scope.
- Kept web as the member-ownership validator and durable mailbox owner,
  Cloudflare as signed transport, and the existing device-sync service as the
  sole provider-specific job materializer.
- Added no schema, migration, provider edits, lifecycle state, recovery loop,
  lease, queue, or dependency. Manual reconcile writes no secondary sync-signal
  or connection schedule state.
- The completed replacement is 915 additions and 31 deletions across 29 files,
  including 425 lines of tests and 106 lines of durable plan/docs. Production
  source is 360 additions and 21 deletions. PR #554 currently has 4,982
  additions and 316 deletions across 72 files.
Completed: 2026-07-15
Completed: 2026-07-15
