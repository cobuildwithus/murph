Goal (incl. success criteria):
- Restore the direct Linq runner wake to the simpler post-Temporal-acceptance order because the concurrent overlap has no demonstrated material end-to-end latency benefit.
- Preserve the direct wake as a best-effort latency hint and keep Temporal as the durable wake authority.
- Success means Temporal acceptance completes before the direct ensure starts, access or Temporal failure starts no direct wake, focused ordering tests pass, required local audits are resolved, and the PR reaches ReviewGPT `PASS` plus green CI.

Constraints/Assumptions:
- Prefer deletion and existing owners; add no queue, state machine, scheduler, persisted table, or compatibility path.
- Keep web as mailbox and `consumedAt` owner, Temporal as durable signal owner, and Cloudflare as the thin execution adapter.
- Preserve unrelated worktree changes and active coordination-ledger rows.
- Coordinate narrowly with the non-exclusive hosted-ingress-wake-repair and mailbox-consumed-at lanes.

Key decisions:
- Recompose the known-checkpoint path through the existing `signalHostedMailboxAppendRuntime` owner rather than retaining a prepare-plus-overlap branch.
- Keep the already-merged production-faithful late-ensure regression for accepted text replies unchanged.
- Treat the pre-existing reaction-only consume-authority gap as a separate correctness change because it requires generic persisted outbox retry semantics and is not caused by PR #749.

State:
- Done.

Done:
- Reconstructed PR #749, its earlier revert history, and PR #383's durable consume boundary.
- Verified production ordering and measured only a small direct-request scheduling lead with no demonstrated warm provider-start improvement.
- Verified the reaction-only path drops answered mailbox ids before the accepted delivery outcome; split that independent issue from this rollback to preserve a narrow review and rollback boundary.
- Restored all three production files exactly to PR #749's immediate parent while retaining stronger ordering, failure, access-denial, and late-timeout proof.
- Coverage-write found no actionable proof gap: 43 owner tests passed with 93.28% statements, 85.86% branches, 100% functions, and 93.15% lines; the eight-file focused suite passed 275 tests.
- Web TypeScript 7 typecheck, production build, lint, repository guards, and focused suites passed. The parallel full-web lane exposed only load-related dev-smoke and unrelated dynamic-import hook timeouts; isolated reruns passed the smoke and all 11 affected route tests.
- Parent final review confirmed a narrow net-deletion rollback with no new persisted state, owner, queue, retry path, or deployment coupling.

Now:
- Commit and publish the reviewed rollback.

Next:
- Open the PR, then complete the exact-head ReviewGPT and CI gates.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-service-wake.ts
- apps/web/src/lib/hosted-onboarding/webhook-service-types.ts
- apps/web/src/lib/hosted-orchestration/signal-runtime.ts
- apps/web/test/hosted-onboarding-webhook-wake-direct-ensure.test.ts
- apps/web/test/hosted-orchestration-signal-runtime.test.ts
- apps/web/test/hosted-onboarding-linq-thread-route.test.ts
- ARCHITECTURE.md
- agent-docs/references/hosted-runtime-protocol.md
Status: completed
Updated: 2026-07-16
Completed: 2026-07-16
