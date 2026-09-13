# Reliable channel connection and contextual outreach

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal

Connecting a verified phone or email reliably exposes a working contact action and greets that destination once. Members who have never messaged Murph receive the existing welcome; members with prior inbound conversation receive a short contextual greeting without restarting onboarding.

## Scope and constraints

Fix proven Web contact-label, missing-route, email-save recovery, and stale-phone authority gaps. Preserve assigned home lines, email-based iMessage authority, migrated-auth guards, provider capacity limits, and canonical delivery validation. Reuse mailbox/outbox identities and existing runtime conversation evidence; add no scheduler or persistent product state. Preserve the original signup founder email but replace the delayed email-link founder side effect with assistant outreach. No production changes or member messages.

## Tasks

1. Audit reachable Web and native connection paths with four scoped agents.
2. Fix line assignment and stale phone bindings; prove failure, retry, capacity, and concurrency behavior.
3. Fix contact actions and email sync recovery with rendered regression tests.
4. Share destination-scoped welcome production across activation and later connections.
5. Select exact welcome versus contextual greeting at runtime using existing lifetime conversation evidence; constrain private history to direct conversations and preserve ordinary notification isolation.
6. Run focused deterministic tests, relevant typechecks, real-model greetings in both channel directions, and parent review; update owner docs and changelog, then create a scoped commit.

## Decisions and evidence

- Confirmed: old phone chat authority survived verified phone changes; clear coupled old-phone fields inside identity reconciliation while retaining the assigned home line.
- Confirmed: Home could mislabel email as Text and expose an authenticated no-op without a route.
- Confirmed: failed email sync after verification had no usable retry; a reload mismatch could not recover.
- Confirmed: delayed email connection sent the founder template rather than an assistant channel greeting.
- Unconfirmed pending-only Home projection hypothesis is excluded until a reachable failing writer is proven.
- One parent owns integration and completion; agents have non-overlapping edit scopes.

## Verification

Use synthetic fixtures only. Verify same-channel retries and concurrent attempts do not duplicate delivery or capacity claims; new destinations remain independent. Check inactive, suspended, unverified, migrated-auth, stale destination, capacity exhaustion, rollback, and provider failure cases. Run Web, hosted-execution, assistant-runtime, and assistant-engine typechecks as affected. Review actual concise model replies and exact effect counts for email-to-phone and phone-to-email journeys.

## Implementation and review results

- Web repairs missing phone routes before Home/Settings contact projections, preserves eligible assigned lines at full proactive quota, and retires old-phone chat bindings on verified phone changes.
- Activation and later connection share destination-scoped identities. Email sync queues Murph outreach and no longer sends the delayed founder template; obsolete recent-member founder wrapper removed.
- Home labels and fallback actions match their targets. Email verification/save interruption recovers without another code, including after reload.
- Runtime selects copy from imported conversation evidence at execution. Accepted output is reused on retry and legacy keys converge only for the same destination. A queued old-email welcome cannot be retargeted to the new email, and an old-email reply cannot suppress the new greeting.
- Parent reviewed source, transactions, route authority, bounded context, privacy, and rendered retry/saving/contact states. No new database schema, scheduler, or product state owner.

## Verification results

- Web focused suites passed: channel producer, activation composition, identity and routing, page contact recovery, email UI recovery, auth/native integration, signup side effects, and changelog. Later retained-line expectations were updated to preserve assigned numbers while retaining fallback for unassigned members; all 70 home-routing tests passed.
- Real PostgreSQL: 8 focused tests passed using an isolated session-owned database, then owned fixtures/database were removed. Three concurrent same-destination attempts plus replay produce one mailbox event, one quota unit, and one postcommit signal. Parallel email/phone plus replay produce two events and one quota unit. Capacity exhaustion, lost claims, rollback, and stable assigned-line behavior are covered.
- Browser: 2 Playwright viewport journeys passed at 390 and 1440 pixels. Parent inspected production-component contact, retry, and saving captures from the synthetic noindex study at `/screenshots/channel-connection`. No external network or uploads.
- Runtime mailbox/recovery suites: 159 tests passed; contextual runtime gate including retained activation: 7 passed; focused email delivery authority: 8 passed. New-key Web authority: 22 passed; Linq callback authority: 9 passed. Full engine notification regression exposed unwanted welcome-recovery work on Telegram. Recovery is now explicitly limited to email and phone, preserving existing Telegram behavior; the final three-suite engine run passed all 97 tests without adding filesystem or mock workarounds.
- Final Web, assistant-runtime, and assistant-engine typechecks passed after implementation and callback edits.
- Docs drift and privacy/whitespace checks passed. Final complexity guard passed with no new above-threshold debt; existing activation and notification hotspots decreased.
- Existing local subscription was expired; the permitted alternate-home procedure found a working subscription without reading or copying credentials. Both real-model contextual journeys passed with gpt-5.6-terra using the local subscription: one model request each, one message per connected channel, and no additional model call or message on replay. Parent reviewed both actual synthetic replies as Ready: natural text/email acknowledgement and grounded prior-context reference, no onboarding restart. Both exact-text delivery-order journeys passed with two intents and zero model requests.

## Deployment boundary

Local implementation only. Deploy compatible runtime readers before Web emits the new keys; keep those readers while any new-key notification is retained. No production member, routing, provider, or deployment mutations were made.

## Focused commands

- Web suites use `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage` with the named test files above; PostgreSQL used the actual Web Vitest config and an isolated loopback test database.
- Engine: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-notification-turn-runtime.test.ts test/assistant-connected-channel-greeting.test.ts test/assistant-channel-welcome-replay.test.ts`.
- Runtime: package Vitest config, focused connected-channel policy, callback authority, mailbox notification, and retained signup-welcome recovery suites.
- Live: `pnpm test:assistant:live -- --test 'greets a new channel contextually after private conversation on email' --codex-home <LOCAL_SUBSCRIPTION_HOME>` and the unique `on linq` counterpart. Exact-text selectors end in `emailFirst=true` and `emailFirst=false`.
- Browser: task-specific `VIEWPORT_OVERFLOW_PORT` and `NEXT_DIST_DIR_SUFFIX`, with `pnpm --dir apps/web exec playwright test e2e/pr-channel-connection-design-proof.spec.ts --config playwright.config.ts --project chromium`.
- Final checks: Web `typecheck:prepared`, engine/runtime `typecheck`, `pnpm complexity:diff`, `pnpm docs:drift`, and `git diff --check`.

The screenshot-gallery overlay friction entry is task-owned and included in the scoped commit. Local proof covers the implemented journeys; remote CI and deployment were not run in this task.

## Final disposition

Ready for review and ordered deployment. All required local proof completed, parent review found no unresolved in-scope defect, and the implementation preserves existing state and delivery owners. No PR, remote CI, or production deployment was requested or performed.
Completed: 2026-09-12
