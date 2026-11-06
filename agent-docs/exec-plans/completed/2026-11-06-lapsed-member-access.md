# Allow lapsed members to use the product

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Goal and scope

Signed-up human members retain native and Web product access after billing lapses. AI access, usage, runtime ownership and funding remain independently authoritative. The parent owns final review, commit, PR and plan closure; all changes remain uncommitted. No production access, billing mutation, migration or iOS change occurred.

The first brief stopped on a proven second strict companion check behind heartbeat and push registration. The follow-up explicitly authorized replacing that product-path check, finding other product-path strict checks, and completing the spending/queue audit. This plan was returned from completed to active under that instruction.

## Implementation and decisions

- The existing product assert now also permits human `canceled`, `paused`, `unpaid` and `past_due` states. Suspension is checked first; unfinished signup and synthetic containers retain prior behavior. No new entitlement state or owner was added.
- Companion `requirePersonalMember` locks the member and sponsorship rows, then uses product authority, retaining consent and private-conversation checks. Runtime presence still begins with its separate callback fence.
- Parent review reverted the connected-app claim change. It is not needed to reach the app, it added error-code branching, and it stays strict as it is today. The shared predicate work planned next covers it without that code.
- New phone reservations check `readHostedAiUsageGate` inside the existing reservation transaction, after exact replay detection and before creating the call. Kernel managed-login continuation checks it before claiming the handoff or contacting the provider. Neither uses paid billing as its new spending check.
- Meal-photo acceptance previously reached a strict runtime wake check after committing. Only the typed `HOSTED_RUNTIME_USER_INACTIVE` refusal is now treated as expected deferred work, including exact duplicate/conflict wake attempts. Other errors keep their existing handling; no runtime fence was loosened.
- Updated the four owner comments, companion and meals contracts, Architecture, and one public changelog fragment. No test was removed. The old blanket admission refusal expectation now follows product authority.
- The shared strict active-access predicates/readers, AI access decision, usage gate/resolver, runtime claims, Stripe and billing writes are unchanged.

## Product walkthrough

Synthetic native requests execute the actual admission owner, product guard, onboarding/status services, heartbeat and push-route services, and numbers/meals authority. All eight requests succeed for the same canceled member. Admission returns exactly `{ ok: true }` with no enrollment, welcome or billing change. Optional timezone persistence still issues its existing conditional update restricted to unfinished signup; it matches no canceled member.

The same unsponsored canceled fixture, including stale paid-subscription evidence, is denied by real runtime AI access and usage owners. Suspended, unfinished and synthetic-container refusals remain. Settings continues to expose billing management for all four lapsed states and hides unavailable AI-model configuration. Saved data can be read; queued changes need runtime access before appearing in a fresh replica.

## Caller audit

Inventory was repository-scoped across every reference to `assertActiveHostedMemberAccessAllowed`, `requireActiveHostedMemberAuthFromBearerToken`, both `requireActiveHostedAppSession` wrappers and `assertBrowserVaultMemberAuthority`, then traced through their effect owners.

| Caller group | Verdict and evidence |
| --- | --- |
| Native admission/sign-in; initial onboarding/status; heartbeat/push | Product access allowed. Real service composition tested. Junction SDK token creation is a device authorization session, not model execution. Companion locks/consent/private checks preserved. Runtime presence callback authority remains strict. |
| Browser vault, homepage preparation, numbers, meals, demographics, journal reads | Saved replica reads and bounded control/KMS/object access; no model or new provider task. Product and consent checks retained. Best-effort browser refresh still uses strict runtime authority; missing/stale replicas can wait for access recovery. |
| Member actions, journal/meal mutations, Messages mini-app | Commit encrypted mailbox work and attempt a bounded post-commit wake. Acceptance does not require model execution. Reconciliation returns `user_not_active` with no work retry clock; preference handoff SQL filters active people and rechecks authority. Existing retention-only clocks remain valid. |
| Manual/automatic meal photos | Bounded image staging, authority recheck, deduplicated mailbox append. Fixed post-commit inactive wake refusal so accepted photos return 202 without client retry. Stored photos may wait for runtime access. Ordinary storage/KMS costs remain. |
| Progress/device-import monitoring | Real progress monitor excludes canceled-member conversation/system rows before alerting; no send occurs. Device-import observation filters through `readHostedRuntimeAiAllowedMemberIds`. Tests cover inactive exclusion and bounded sweeps. No lapsed-member retry/page loop was found after the photo fix. |
| Phone calls | Sole production creation entry is the signed internal callback. Added usage check at real reservation rather than relying on upstream admission. Denied inactive/exhausted usage creates no call and starts no provider; allowed usage reaches reservation without paid-plan evidence. Exact replay/reconciliation stays available. |
| Physical notes | First complimentary offer is reserved once under member locking, as explicitly allowed by the brief. Later notes already check AI usage and remaining capacity. Replay remains idempotent. No change needed. |
| Computer handoff | Reading an owned handoff exposes an existing Live View; Done records completion for later runtime resume. Neither creates a new browser. Managed-login continuation can create Kernel work, so the new usage gate precedes the claim and all new provider effects. Existing runtime start/resume fences remain. |
| Clinical records | Browser claim/OAuth uses product session, origin and consent checks; discovery/token exchange and encrypted source persistence enqueue a retrieval run. Wake is best-effort with a known committed pointer. Retrieval/document operations retain strict runtime authority and `loadRunnableClinicalRun` returns inactive as non-retryable. Model parsing cannot start through the product path alone. No paid ordering API was found in these paths. |
| Device connect/settings/callbacks | Existing configured-source, CSRF, consent, exact OAuth/member binding and WHOOP capacity remain. Connect/SDK sessions authorize health-data collection, not AI work. Diagnostics/backfill requires its existing diagnostic enable gate. Scheduled reconciliation and background imports keep strict runtime eligibility. |
| Connected-app claim page/start/callback | Unchanged: stays strict for lapsed members, as today. An issued link needs the follow-up shared predicate work. Assistant intent creation and tool execution keep strict admission. |
| Action approvals | Challenge/signature/ownership checks remain. Decision commits with a runtime control row and best-effort wake; it does not execute the approved external action. Runtime re-reads authority before effect. |
| Voice and voice-input mailbox | Voice route checks `resolveHostedRuntimeAiUsageGate` before reservation/control. Voice-input requires a current runtime owner with `platformAiUsageAllowed`; close/cleanup remains possible. No gate change. |
| Address book, contact card, HRV/health metadata, sync diagnostics | Bounded projection or ingestion, with session/consent and transactional authority checks as owned today. Any subsequent assistant work goes through runtime admission. No direct model or new paid task found. |
| Assistant style/model preferences | Style is a saved preference/queued change. Model configuration independently uses strict AI availability and plan-specific choices; `HOSTED_ACCESS_REQUIRED` maps to configuration unavailable. It does not own Settings billing recovery. Left unchanged. |
| Ops and production canary | Product wrapper does not replace Ops allowlist/role authority. Canary independently reads strict runtime AI access. No operational action was performed. |
| Settings billing recovery | Page reads normal authenticated session and derives `hasHostedRecoverableBilling`; existing customer plus lapsed state yields `canManageBilling`. Tests now explicitly assert this for canceled/paused/unpaid/past_due, and refusal for suspension. |

Public provider evidence supports the distinction between authorization and execution: [Junction pricing](https://www.junction.com/pricing) describes plan/user capacity and [Composio pricing](https://composio.dev/pricing) includes unlimited connected accounts separately from tool execution. Actual private account contracts and invoices were not inspected. This audit does not claim that network, storage, KMS or provider account capacity is free.

## Remaining restrictions and evidence limits

- Assistant model configuration/plan-specific choices still require their existing strict AI eligibility. Connected-app intent creation is still assistant-only. Scheduled sync and browser-vault regeneration wait for runtime access. Billing/funding management and top-ups keep their existing payer/plan rules; this patch does not replace those owners.
- Unfinished activation, suspension and missing consent still restrict product access as before. Lapsed members with sponsored access may legitimately receive AI through the unchanged sponsor rules.
- Synthetic tests mock persistence, native credential verification, consent boundaries, encryption and external providers where needed. They exercise real service composition and access policies, not a live iOS session, live Postgres concurrency, Stripe, Junction, Composio, Kernel or Retell. No live assistant journey was needed because prompts/model behavior were not changed.
- No deployment, production experiment, full acceptance/coverage run, PR CI or ReviewGPT was performed; the user reserved commit/PR ownership for the parent. The changelog's source PR list is empty until that PR exists.
- Final candidate review traced changed effects, replay paths, lock order, callback authority and side effects. No unresolved code finding remains. No repository-actionable tooling friction was introduced; test fixture corrections were local implementation mistakes.

## Verification log

All exit codes below are the command's real completion status, without shell pipelines. Commands run from repository root.

Preparation:

- `pnpm install --prefer-offline`: 0.
- `pnpm build:workspace:incremental`: 0.
- `pnpm --dir packages/health-commons generate && pnpm --dir apps/web prisma:generate`: 0; both commands succeeded.

### Test command A

```sh
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/lapsed-member-product-access.test.ts
```

Three executions: 1 (fixture corrections needed); 1 (real pre-fix access failures: 8 failed, 4 passed); 0 (12 passed after implementation). The red run proved the deeper heartbeat/push guard, not just mocked route behavior.

### Test command B

```sh
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/lapsed-member-product-access.test.ts apps/web/test/phone-calls-reservation-usage.test.ts apps/web/test/phone-calls-service.test.ts apps/web/test/hosted-computer-managed-auth.test.ts apps/web/test/hosted-execution-computer-use.test.ts apps/web/test/companion-presence.test.ts apps/web/test/companion-push-route-store.test.ts apps/web/test/hosted-onboarding-companion-member-access.test.ts apps/web/test/hosted-onboarding-entitlement.test.ts apps/web/test/hosted-execution-usage-allowance.test.ts
```

Exit 1: 9 files/542 tests passed; new phone suite could not import because its usage-module mock omitted a shared export. Fixed by retaining actual module exports in the mock.

### Test command C

```sh
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/phone-calls-reservation-usage.test.ts apps/web/test/hosted-computer-managed-auth.test.ts apps/web/test/hosted-execution-computer-use.test.ts apps/web/test/connected-apps-service.test.ts apps/web/test/connected-apps-internal-route.test.ts apps/web/test/hosted-runtime-progress-alert-monitor.test.ts
```

Exit 1: 341 passed, 4 failed. Phone fixture needed an explicit transfer-number resolver; connected-app suspension expected the old error. Corrected both; no failure was silenced.

### Test command D

```sh
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/phone-calls-reservation-usage.test.ts apps/web/test/connected-apps-service.test.ts
```

Exit 0: 2 files, 66 tests.

### Test command E

```sh
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/lapsed-member-product-access.test.ts apps/web/test/phone-calls-reservation-usage.test.ts apps/web/test/phone-calls-service.test.ts apps/web/test/hosted-computer-managed-auth.test.ts apps/web/test/hosted-execution-computer-use.test.ts apps/web/test/companion-presence.test.ts apps/web/test/companion-push-route-store.test.ts apps/web/test/hosted-onboarding-companion-member-access.test.ts apps/web/test/hosted-onboarding-entitlement.test.ts apps/web/test/hosted-execution-usage-allowance.test.ts apps/web/test/connected-apps-service.test.ts apps/web/test/connected-apps-internal-route.test.ts apps/web/test/hosted-runtime-progress-alert-monitor.test.ts apps/web/test/device-sync-companion-meal-photo-capture-routes.test.ts
```

Exit 0: 14 files, 697 tests, including both photo acceptance paths after inactive runtime denial.

### Test command F

```sh
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/settings-page.test.ts apps/web/test/settings-billing-portal-button.test.ts apps/web/test/hosted-billing-settings.test.tsx apps/web/test/physical-notes-service.test.ts apps/web/test/physical-notes-replay.test.ts apps/web/test/clinical-records-control-plane.test.ts apps/web/test/clinical-records-runtime-routes.test.ts apps/web/test/device-connection-consent-boundary.test.ts apps/web/test/device-connect-intent-route.test.ts apps/web/test/member-action-mailbox-boundary.test.ts apps/web/test/hosted-orchestration-reconciliation-facts.test.ts apps/web/test/hosted-preference-handoff-sweeper.test.ts apps/web/test/hosted-device-import-alert-monitor.test.ts apps/web/test/hosted-orchestration-signal-runtime.test.ts apps/web/test/hosted-runtime-progress-alert-monitor.test.ts apps/web/test/changelog-page.test.tsx
```

Exit 0: 16 files, 454 tests. Changelog generation ran first via Web typecheck preparation.

### Test command G

```sh
pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-computer-managed-auth.test.ts apps/web/test/hosted-execution-computer-use.test.ts apps/web/test/settings-page.test.ts
```

Exit 0: 3 files, 294 tests after extracting the computer sign-in policy check and strengthening Settings recovery assertions.

### Other checks

- `pnpm --dir apps/web typecheck:prepared`: sequential exits 0, 2, 0, 0. The failed run found a newly added alert test fixture whose inferred billing-ref type was null; corrected the fixture without a cast. Final run includes all source/test changes and generates changelog fragments.
- `pnpm --dir apps/web lint`: 0; existing warnings in untouched lines/files, no error.
- `pnpm --dir apps/web exec oxlint src/lib/computer-use/service.ts src/lib/hosted-onboarding/request-auth.ts test/settings-page.test.ts`: 0 after final source edits; one pre-existing unused-parameter warning on an untouched test line.
- `pnpm complexity:diff`: 1 then 0. Initial inline computer gate increased existing method debt by one; extracted the sign-in policy check into a named local helper. Final total debt is unchanged in every changed source file.
- `pnpm docs:drift`: 0 twice, including the updated handoff record.
- `pnpm docs:gardening`: 0 twice, no issues.
- `git diff --check`: 0.
- Authored-content privacy and whitespace scan (including all untracked files): 0; no local identifiers or trailing whitespace found.

## Parent handoff

Implementation, focused verification and caller audit are complete locally. Keep this plan active and the diff uncommitted until the parent reviews and owns final completion. Populate changelog PR provenance when the parent creates the PR. Deployment needs no data migration; older Web instances continue old product refusals until rolled forward, and reverting restores those refusals without state repair.

## Parent review and deep review

- Parent review reverted the connected-app claim change, kept index links on the plan's final location, and rewrote the changelog in plain language. Mutation checks confirmed the new tests catch both gate changes: removing the assert change failed 8 tests, restoring the strict heartbeat check failed 4.
- Independent deep review found one defect: a member lapsing during an admitted turn could reach the complimentary physical note with no usage check, because the widened assert used to refuse them. Accepted in part. Its suggested fix, requiring usage for every complimentary note, would narrow a shipped offer for active members, so only members admitted by product access alone now need usage for it. Physical notes spec updated.
Completed: 2026-11-06
