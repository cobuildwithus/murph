# SMS instant start, Starter image card gate, abuse alerts, and Growth activity

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

New SMS contacts can start chatting without a browser. Personal Starter image generation requires a saved card. Operators receive abuse signals through existing email recipients, and recent-member Growth activity includes pre-activation texts.

## Scope and decisions

- Retain signed ingress, model admission, phone-prefix eligibility, once-per-member starter grants, and current line ownership.
- Apply instant start only to newly created members; no existing pending-account recovery or backfill.
- Apply image card requirement to every personal Starter account. Preserve paid, sponsored, group, and local success paths.
- Save cards without purchasing a subscription or automatically charging. Stripe remains card authority.
- Reuse operational email configuration and incident deduplication. Alerts identify suspicious aggregate activity, without private transcripts or contact data.
- Derive recent-member activity from provider evidence and mailbox receipts without double counting or creating executable mailbox items for analytics.

## Tasks

1. Implement provider protocol eligibility and composed first-message proof.
2. Implement card setup and an image-provider authorization gate with clear assistant recovery.
3. Add bounded abuse signal reads to the existing alert cron.
4. Fix recent-member counts, copy, and receipt deduplication.
5. Run focused tests and typechecks, real-assistant proof, rendered UI proof, and parent review; update durable contracts and changelog; commit the scoped result.

## Product UX journeys

- New eligible SMS greeting: one activation and original message reaches Murph, no verification-link detour.
- Replayed webhook or existing pending member: no duplicate grant or newly invented instant-start authority.
- Personal Starter requests an image without a card: zero paid image requests and one useful card setup instruction; text chat still works.
- Card saved without purchase: image generation works within the existing allowance; missing or detached cards fail closed.
- Paid, Family-sponsored, and group conversations retain their authorized image behavior.
- Growth shows pre-activation inbound activity once, including after activation, using receipt-time windows.
- Suspicious signup/use bursts send one incident email to existing operational recipients; healthy traffic and retries do not flood email.

## Verification

Focused ingress, Stripe/card setup, provider egress, alert incident/cron, Growth, assistant tool, and rendering tests; relevant Web/Cloudflare/package typechecks. Live synthetic assistant journey after deterministic proof. Parent review and complexity diff before scoped commit. No production writes or live test notifications.

## Progress

- Reproduced cause: SMS excluded by instant-start eligibility; recent-member table reads only assistant mailbox receipts, which omit pre-activation texts.
- User confirmed existing operational alert recipients and card gate for all personal Starter accounts.
- Isolated task checkout created from available origin/main. Remote SSH fetch failed and then stalled; stopped only the owned tool session. Refresh remains needed for PR publication, which is outside the current local-fix request.

## Implementation and parent review

- New phone-based SMS/RCS contacts share the existing model admission and exact-inbound activation path. A default-off rollout switch prevents opening SMS before the image gateway is deployed. Existing pending accounts remain unchanged.
- The image generation/edit gateway calls a signed Web access route before provider spend. Direct Starter reads current Stripe card attachment and revalidates the customer binding; missing cards and provider/access failures deny the request. Existing allowance, paid, sponsored, and group owners remain canonical.
- Settings saves cards using card-only Stripe Checkout setup mode. Setup events finish their receipt lifecycle without subscription activation, charges, welcome effects, or usage grants.
- The assistant receives a bounded payment-card failure and trusted recovery instructions. Text remains available; completion never starts an image retry.
- The existing alert cron reads bounded signup/rapid-use aggregates and reuses operational recipients, incident leases, and delivery idempotency. No notification was sent during development.
- Recent-member Growth adds retained pre-activation inbound receipts, deduplicates provider redeliveries and mailbox identities, and labels account creation as First seen. Global active-user metrics retain their existing meaning.
- Parent reviewed all changed source and test boundaries, current-card and signed-member authority, receipts, consumer-first deployment, privacy, and success-path preservation. No schema migration, new dependency, cached card state, analytics writer, or automatic suspension was introduced.
- Complexity guard passed: OpenAI request handler decreased from 34 to 30; Stripe event receipt handler decreased from 40 to 32. Other changed existing hotspots did not increase. Request-body validation and Stripe event application have explicit owners; broader unrelated refactors are unnecessary.

## Verification results

- Web focused ingress/card/Stripe/Growth/cron suites: 411 passing tests; the additional provider/mailbox dashboard composition test passed in the 60-test Growth suite.
- Web environment, Stripe receipt, changelog, and operational email configuration suites: 163 passing tests.
- Existing latency/overshoot incident monitor suites: 50 passing tests, covering the reused incident lifecycle.
- Cloudflare full provider-egress suite: 262 passing tests, including denied generation/edits with zero upstream image calls and old/incompatible Web responses failing closed.
- Assistant image provider/tool/completion suites: 53 passing tests.
- Local PostgreSQL: 2 passing tests using transaction-local synthetic tables, proving provider/mailbox deduplication and signup/rapid-use thresholds.
- Web, Cloudflare, assistant-engine, and hosted-execution typechecks passed. `pnpm complexity:diff`, `pnpm docs:drift`, and whitespace checks passed.
- Focused `pnpm test:assistant:live -- --test <Starter card recovery journey>` passed using the documented alternate subscription-auth fallback. One real provider turn, zero tool actions, no media, and an accurate Settings/payment-card explanation. Initial auth failures were pre-action; the first executable run exposed ambiguous error wording, fixed at the tool-result and trusted completion boundaries before the passing replay.
- Playwright: all four desktop/mobile Growth and card-setup checks passed. Card setup uses the production component at `/design?tab=components#starter-image-card-component`, with synthetic failure, one request, enabled retry, and no overflow. Growth uses `/screenshots/ops#growth-recent-member-retention`. Parent inspected the resulting screenshots.
- Initial card-browser attempts against the composed account gallery were obstructed by unrelated open modal previews; the final proof uses an isolated production-component study. Browser startup also encountered local preparation delays; the documented prepared-input server path completed successfully.

## Product UX disposition

Ready for the scoped local candidate: new SMS admission/replay, cardless image denial, attached-card success and detachment, paid/sponsored/group preservation, assistant recovery, aggregate alerts, and Growth receipt accounting have focused proof. No existing-member migration was requested.

Ordinary text turns add no awaited card/network work. Image attempts add one signed Web callback, the existing short database-only usage-gate read, current encrypted billing-reference reads, and at most one Stripe card list (5-second timeout, zero retries). Stripe work stays outside database transactions. Growth adds one serial aggregate for at most 20 members without increasing the existing peak query concurrency. Abuse reads at most 1,000 recent accounts in one aggregate query.

The new assistant guidance is emitted only for trusted background image completions; ordinary individual/group initial prompts and tool schemas are unchanged. The focused real completion turn proves the actual user-visible failure explanation.

## Rollout and remaining external evidence

This task is a local fix and scoped commit. No push, PR, merge, deployment, production configuration, live card setup, or real abuse email was performed. Before publication, refresh the base and run the applicable final ReviewGPT/CI gates on the pushed candidate.

Deploy compatible Web access/setup consumers with `HOSTED_ONBOARDING_LINQ_SMS_INSTANT_START_ENABLED` unset, then deploy the gateway and assistant bundle. Verify signed cardless denial, card-backed image success, and operational alert configuration through the reviewed hosted path; then set that Web flag to `1`. Warm old runtimes still traverse the new gateway, but may show generic failure text until updated. Old Web responses fail closed. Rolling below the gateway check would reopen image access; preserve that enforcement floor. No data backfill or migration is required.
Completed: 2026-09-10
