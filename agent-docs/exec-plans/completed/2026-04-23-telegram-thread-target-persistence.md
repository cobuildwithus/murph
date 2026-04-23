Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Preserve direct Telegram business and DM-topic thread context in hosted member routing so later outbound sends reuse the original direct surface instead of collapsing back to a bare user id.

## Success criteria

- Hosted member routing persists a dedicated Telegram thread target alongside the existing Telegram user-id binding used for lookup.
- Write paths that only know the Telegram user id preserve any existing richer thread target instead of downgrading it.
- Inbound direct Telegram webhooks refresh the stored thread target for the matched member when a richer thread id is available.
- Hosted activation and other outbound notification route builders prefer the stored Telegram thread target and only fall back to the bare user id when no richer target is known.
- Focused `apps/web` regression coverage exists for route persistence, webhook refresh, settings sync preservation, and outbound route selection.

## Scope

- In scope:
- `apps/web/app/api/settings/telegram/sync/route.ts`
- `apps/web/src/lib/hosted-onboarding/{hosted-member-routing-state,hosted-member-routing-store,hosted-member-routing-telegram,hosted-member-routing-linq,member-private-codecs,messaging-state,member-activation,member-channel-sync,webhook-provider-telegram}.ts`
- directly coupled `apps/web/test/{hosted-onboarding-member-store,hosted-onboarding-telegram-dispatch,settings-telegram-sync-route,hosted-onboarding-member-activation,hosted-onboarding-linq-home-routing,hosted-onboarding-linq-transport,hosted-onboarding-member-channel-sync,hosted-onboarding-privy-invite-status}.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-telegram-thread-target-persistence.md,COORDINATION_LEDGER.md}`
- Out of scope:
- broader Telegram auth, contact-privacy, or billing work already active in the tree
- new generic routing abstractions outside the hosted onboarding Telegram seam
- changing Telegram webhook direct-message eligibility rules
- Prisma schema or migration churn for this slice

## Constraints

- Preserve the existing Telegram user-id blind-index lookup contract for inbound member resolution.
- Keep the persisted thread target private/encrypted on the routing row; do not introduce raw Telegram ids in plaintext columns.
- Treat this as a high-risk hosted messaging-routing change: run the required `apps/web` verification lane, capture direct scenario proof, and complete the required `coverage-write` plus `task-finish-review` audits.
- Preserve overlapping dirty-tree edits in `hosted-member-routing-telegram.ts`, `hosted-member-routing-store.ts`, `webhook-provider-telegram.ts`, and `member-activation.ts`.

## Risks and mitigations

1. Risk: a user-id-only resync path could overwrite a previously richer business or DM-topic thread target.
   Mitigation: preserve the existing stored thread target unless a new validated target is provided.
2. Risk: storing an arbitrary thread target string could let invalid Telegram delivery targets persist.
   Mitigation: normalize stored thread targets through the shared Telegram target parser/serializer seam.
3. Risk: active `apps/web` rows already touch the same Telegram routing files, so an isolated thread-target fix could accidentally trample adjacent rotation-hardening work.
   Mitigation: keep the change additive on the encrypted private-state payload and routing refresh paths only, with no schema churn.

## Tasks

1. Completed: inspect the current routing persistence flow and confirm the rich Telegram thread target is dropped before outbound route reconstruction.
2. Completed: register this active plan and ledger claim for the unowned persistence slice.
3. Completed: store the Telegram thread target inside the encrypted routing private payload and preserve it across user-id-only sync writes.
4. Completed: refresh the stored thread target from inbound direct Telegram webhooks and prefer it in outbound route reconstruction.
5. Completed: add focused regression coverage for sync preservation, webhook refresh, and outbound route selection.
6. Completed: run truthful verification plus the required audit passes and assess the exact scoped commit path in the dirty tree.

## Decisions

- Keep Telegram routing split into two persisted facts: a blind-indexable raw user id for inbound lookup and a private serialized thread target for outbound delivery.
- Reuse the shared Telegram target parser/serializer so stored thread ids stay canonical across plain, business, and DM-topic direct threads.
- Avoid Prisma/schema churn in this dirty branch by versioning the encrypted Telegram private payload instead of adding a new database column.

## Verification

- Commands to run:
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-onboarding-member-store.test.ts test/hosted-onboarding-member-activation.test.ts test/settings-telegram-sync-route.test.ts test/hosted-onboarding-telegram-dispatch.test.ts`
- `pnpm --dir apps/web typecheck:prepared`
- `pnpm --dir apps/web lint`
- `bash scripts/workspace-verify.sh test:diff apps/web/app/api/settings/telegram/sync/route.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-state.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-telegram.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-linq.ts apps/web/src/lib/hosted-onboarding/member-private-codecs.ts apps/web/src/lib/hosted-onboarding/messaging-state.ts apps/web/src/lib/hosted-onboarding/member-activation.ts apps/web/src/lib/hosted-onboarding/member-channel-sync.ts apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-member-activation.test.ts apps/web/test/settings-telegram-sync-route.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-onboarding-linq-transport.test.ts apps/web/test/hosted-onboarding-member-channel-sync.test.ts apps/web/test/hosted-onboarding-linq-home-routing.test.ts apps/web/test/hosted-onboarding-privy-invite-status.test.ts`
- `HOSTED_WEB_ENCRYPTION_KEY='AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE' HOSTED_WEB_ENCRYPTION_KEY_VERSION='v1' pnpm --dir apps/web exec tsx --eval '...'`
- `git diff --check`
- required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- stored Telegram routing keeps richer direct-thread targets when known, inbound webhooks refresh them, and outbound route builders reuse them instead of collapsing to the bare user id.
- Actual results:
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-onboarding-member-store.test.ts test/hosted-onboarding-member-activation.test.ts test/settings-telegram-sync-route.test.ts test/hosted-onboarding-telegram-dispatch.test.ts` passed with 4 files / 72 tests green after the audit-driven follow-up fixes and proof additions.
- `pnpm --dir apps/web typecheck:prepared` passed on the final rerun.
- `pnpm --dir apps/web lint` passed with pre-existing warnings only.
- `bash scripts/workspace-verify.sh test:diff ...` failed for unrelated pre-existing `apps/web/test/browser-vault-dashboard-pages.test.tsx` expectations that still assert `Library · 4 experiments` while the current branch renders `Library · 5 experiments`, plus an unrelated `apps/web/test/hosted-onboarding-linq-dispatch.test.ts` `sent_at` expectation mismatch.
- Direct scenario proof passed: encrypt/decrypt the stored Telegram private payload, reconstruct messaging state, and confirm the outbound route keeps `telegram_user_123:business:biz-42:dm-topic:9` as the delivery target.
- `git diff --check` passed after the final follow-up fixes.

## Outcome

- Implementation landed, focused proof is green, and the required audit passes are complete. The only remaining red verification lane is the scoped `apps/web` `test:diff` command, and its failures are outside this Telegram routing slice.

## Audits

- `simplify` completed and surfaced two real fixes: stop trusting browser-supplied Telegram thread ids in the settings sync path, and fail closed on unsupported JSON payload schemas / non-direct stored targets.
- `coverage-write` completed on `gpt-5.4-mini`; it reran the exact scoped `test:diff` lane, made no edits, and confirmed the remaining failures are unrelated app drift outside this slice.
- `task-finish-review` completed after one allowed rerun; the first pass surfaced the untrusted settings-thread input and webhook downgrade regression, both were fixed, and the rerun returned no findings.

## Commit note

- No exact task-only commit was created because this slice overlaps pre-existing uncommitted work in shared Telegram routing files (`hosted-member-routing-store.ts`, `hosted-member-routing-telegram.ts`, `webhook-provider-telegram.ts`, `member-activation.ts`) and the shared coordination ledger file, so a path-based commit would have absorbed unrelated active-row edits.
