# Hosted-member privacy Batch 2 messaging-routing cutover

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Move Linq and Telegram routing bindings off the legacy wide `HostedMember` row and onto the additive `HostedMemberRouting` table introduced in Batch 1.
- Remove durable `telegramUsername` storage while preserving the current Telegram settings UI behavior from the live sync response.

## Success criteria

- Linq webhook/provider reads and writes use `HostedMemberRouting` for chat binding state.
- Telegram webhook/provider reads and writes use `HostedMemberRouting` for Telegram blind-index lookups and binding state.
- Linq identity resolution still comes from identity-side phone blind indexes rather than routing state.
- Telegram settings sync no longer durably stores `telegramUsername`, but the route still returns the live username from the current Privy sync result when available.
- Focused hosted-web tests cover the cutover behavior and no legacy `HostedMember` Linq/Telegram linkage remains on the edited runtime paths.

## Scope

- In scope:
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts`
- `apps/web/app/api/settings/telegram/sync/route.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-member-store.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts`
- related hosted-web tests under `apps/web/test/**`
- Out of scope:
- auth/onboarding request cutover beyond what these routing paths already use
- Stripe billing changes
- removal of the legacy schema columns themselves
- broader cleanup outside the live messaging-routing path

## Constraints

- Preserve unrelated dirty worktree edits.
- Follow the additive Batch 1 helper/store layer rather than re-spreading routing logic.
- Preserve entitlement checks and sparse/sanitized webhook payload handling.
- Keep privacy posture improved or unchanged; do not introduce new durable personal identifiers.

## Risks and mitigations

1. Risk: A partial cutover leaves one webhook path reading stale legacy columns.
   Mitigation: Trace every Linq and Telegram runtime read/write in scope and add focused regression assertions.
2. Risk: Removing durable `telegramUsername` breaks current UI display behavior.
   Mitigation: Keep the settings sync response populated from the current Privy-linked Telegram account result instead of storage.
3. Risk: Shared-worktree overlap in hosted onboarding causes accidental loss of adjacent edits.
   Mitigation: Re-read touched files before patching and keep the diff tightly limited to the owned routing surfaces.

## Tasks

1. Inspect the Batch 1 hosted-member store helpers and the live Linq/Telegram provider call sites.
2. Cut Linq binding reads and writes over to routing-table helpers while preserving phone-based member identity lookup.
3. Cut Telegram lookup/binding reads and writes over to routing-table helpers and remove durable username storage.
4. Update the activation-path Linq first-contact read so live welcome routing still uses the additive routing table after the write cutover.
5. Add or update focused hosted-web tests for the cutover and the live Telegram sync response behavior.
6. Run required verification, final audit review, and a scoped commit.

## Verification

- Commands to run:
- Focused hosted-web Vitest for touched tests.
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Direct proof:
- Inspect the edited runtime paths to confirm Linq and Telegram linkage no longer flow through legacy `HostedMember` columns.

## Outcome

- `webhook-provider-linq.ts` now resolves members through identity-side phone lookup helpers and writes `linqChatId` through `HostedMemberRouting`.
- `webhook-provider-telegram.ts`, `settings/telegram/sync/route.ts`, and the activation-path read in `stripe-billing-policy.ts` now use routing-side blind-index and chat-binding helpers instead of legacy `HostedMember` routing fields.
- Durable `telegramUsername` storage was removed from the runtime path and then dropped from the schema cleanup migration; the sync route still returns the live username from the current Privy-linked Telegram account when available.
- Focused hosted-web tests covering Linq dispatch, Telegram dispatch, sync behavior, webhook idempotency, billing activation routing, and hosted onboarding routes passed under the final integrated tree.
