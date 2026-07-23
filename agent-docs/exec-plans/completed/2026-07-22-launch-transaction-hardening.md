Goal (incl. success criteria):
- Keep tomorrow's signup and activation path available under a burst of new members by reducing pooled-connection occupancy inside the existing hosted Web owners.
- Remove repeated GCP KMS unwrap work from signup and activation transactions, strictly bound the authoritative Stripe work that must remain under the billing lock, and narrow or bound the global home-line routing lock without weakening route/capacity invariants.
- Success means focused call-count and concurrency regressions fail on the current implementation and pass after the change, the critical signup/activation/billing success paths remain replay-safe, and full repository acceptance plus the required PR review gates are green.

Constraints/Assumptions:
- This is high-risk auth, billing, crypto, and concurrency work. Preserve product-critical signup, trial, activation, and welcome flows; do not disable them as a reliability fix.
- Prefer reordering and the existing domain-root unwrap cache, transaction owners, idempotency keys, and routing locks. Add no queue, semaphore, state owner, table, schema, or reconciliation loop.
- PlanetScale M-80's current `max_connections=50`, PgBouncer `default_pool_size=45`, and `max_client_conn=900` are user-confirmed managed defaults and remain unchanged. PlanetScale documents size-dependent defaults and resize recalculation, but does not publish the exact M-80 tuple in its public table.
- Preserve the separate Privy metadata cleanup worktree and unrelated primary-checkout changes.
- `agent-docs/exec-plans/active/2026-06-21-hosted-signup-timezone-handoff.md` overlaps `authentication-service.ts`, `hosted-member-store.ts`, and `member-activation.ts`; this task stays isolated, minimizes those hunks, and will reconcile the current main/base before final proof.

Key decisions:
- Scope the existing hosted-domain-root unwrap cache to the shortest owning signup/activation transaction so repeated seal/open work shares one in-memory root only for that operation.
- Preserve the July provider-authority fixes: the final mutable Stripe reread and loser cancellation remain under the member lock. Bound member-lock acquisition to 2 seconds, those Stripe requests to one 5-second attempt, and auto-trial finalization/cleanup to 120 seconds; return typed retryable errors rather than allowing the historical 13-minute ceiling on this path.
- Retry only same-member lock acquisition in a fresh transaction before Stripe/KMS work. Do not replay finalization after downstream Linq contention because that would multiply rolled-back provider/KMS work during a burst; surface a user-safe retry instead, reusing the stable Stripe subscription on the next foreground request.
- Reuse nested unwrap-cache scopes and prewarm activation's control and ingress roots after provisioning but before taking the global line-pool lock. This keeps route encryption and mailbox materialization from making their first KMS unwrap while serializing all new claims.
- Preserve pool capacity and proactive-conversation exactness. Narrow the global routing lock only where existing route authority makes pool selection unnecessary; true new claims retain pool-before-member ordering and a final locked re-read.
- Use a transaction-scoped try-lock for true new home-line claims. A busy pool or route-state flip rolls the caller's transaction back with a typed retryable 503; the foreground retry begins a new transaction rather than waiting or spinning on a pooled connection.
- Preserve the existing join-flow recovery UI: every newly introduced pressure error is a typed retryable domain error, so the existing Retry action remains the single frontend recovery owner without a new client fallback or visual surface.

State:
- Done.

Done:
- Confirmed PlanetScale resize-default behavior from official parameter documentation and retracted the PS-80 example-based tuning recommendation.
- Traced the current signup KMS call fanout, auto-trial Stripe-in-transaction path, and global routing advisory-lock hold interval.
- Created an isolated task worktree from current `origin/main`.
- Added transaction-scoped root unwrap caching to both Privy completion branches and the secondary verified-email and Telegram transaction owners.
- Added nested cache reuse plus activation control/ingress prewarming before home-line routing.
- Bounded auto-trial reservation unwrap work, finalization/cleanup member-lock acquisition, authoritative Stripe requests, and transaction duration while preserving the final under-lock provider reread and cancellation invariants.
- Correctly detect Prisma adapter-pg `55P03` lock timeouts and reset `lock_timeout` immediately after acquiring the member row so later activation work is not accidentally subject to the acquisition budget.
- Added user-safe typed retry behavior for routing and billing-lock contention. The existing join-flow Retry action consumes the domain `retryable` field, so no frontend behavior or styling change is needed.
- Added a two-phase activation route decision: existing home/promotable pending authority uses only the member route lock; true claims use a fail-fast pool try-lock, then member lock and locked reread.
- Focused signup/time-zone, auto-trial, activation/crypto, routing, and client retry tests pass; focused Web typecheck and lint/diff checks pass.
- Direct PostgreSQL proof confirms the exact transaction advisory lock is reentrant for its owner, fails immediately for a concurrent transaction, and becomes available after transaction release.
- Preliminary completion-specialists ReviewGPT audited exact head `e1cff346d6` and returned two coverage findings: fail-fast prewarming could expose a sibling failure before a late root was zeroized, and the advisory-lock behavior lacked an executable PostgreSQL regression in CI.
- Replaced fail-fast prewarming with `Promise.allSettled`, added a deterministic late-root zeroization regression, and added a loopback-only two-client PostgreSQL concurrency suite to the hosted PostgreSQL CI job and testing map.
- The executable PostgreSQL concurrency suite passed against an isolated migrated database.
- Final canonical diff verification passed 6,258 tests with 155 skipped, lint with no errors, development smoke, typecheck, and the production build.
- Reconciled current `origin/main` with an ordinary merge; no newer base commit touched the task's onboarding owners.
- Clean-room repository acceptance passed in Blacksmith Testbox `tbx_01ky6my181q13t2rt0r6gwbxx4`, including all workspace typechecks, coverage lanes, Web production build, and Cloudflare suites.
- Parent final review found no remaining correctness, privacy, security, reliability, ownership, or unnecessary-complexity issue in the task patch.

Now:
- Close this execution plan and certify the exact pushed PR head through final ReviewGPT and required CI.

Next:
- Mark PR #886 ready after final ReviewGPT, required CI, and mergeability proof pass.

Open questions (UNCONFIRMED if needed):
- No existing durable owner completes a browser-abandoned auto-trial activation. The safe launch behavior is foreground retry with stable subscription reuse; a true pending-activation owner and extraction of Stripe/KMS work are explicitly deferred rather than adding a launch-time queue/table or weakening current correctness.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/authentication-service.ts
- apps/web/src/lib/hosted-onboarding/hosted-member-store.ts
- apps/web/src/lib/hosted-onboarding/hosted-member-routing-telegram.ts
- apps/web/src/lib/hosted-onboarding/member-activation.ts
- apps/web/src/lib/hosted-onboarding/auto-trial-enrollment-service.ts
- apps/web/src/lib/hosted-onboarding/linq-home-routing.ts
- apps/web/src/lib/hosted-onboarding/hosted-member-routing-linq.ts
- apps/web/src/lib/hosted-crypto/domain-root-unwrap-cache.ts
- apps/web/test/hosted-onboarding-linq-home-routing-postgres.test.ts
- .github/workflows/cloudflare-hosted-e2e.yml
- agent-docs/references/testing-ci-map.md
- focused hosted onboarding, billing, crypto, and PostgreSQL concurrency tests
- pnpm test:diff <touched paths>
- pnpm verify:acceptance
Status: completed
Updated: 2026-07-23
Completed: 2026-07-23
