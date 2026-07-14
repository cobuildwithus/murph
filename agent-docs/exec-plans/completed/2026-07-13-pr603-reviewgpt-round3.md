# PR 603 ReviewGPT Round 3 Remediation

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Resolve the three accepted ReviewGPT round-3 findings without adding another routing model or state owner.
- Preserve semantic Telegram conversation identity separately from bot-bound delivery authority in every proactive path.
- Preserve valid same-identity direct authority across transient probe failures while allowing definitive denial to revoke it.

## Accepted findings

1. The onboarding follow-up drops the explicit Telegram delivery target and later treats the semantic conversation hash as `chat_id`.
2. The direct-authorization protocol collapses definitive denial and temporary unavailability, allowing transient failures to erase a valid route.
3. The group-newsletter nudge carries a delivery address as its conversation identifier and can split Telegram conversation history.
4. The security/privacy completion pass found that a recurring onboarding automation could retain the activation-time Telegram target after a verified identity relink.
5. The security/privacy completion pass found that Privy Telegram mutations did not transactionally publish the current route or revocation to the runtime.
6. The security/privacy completion pass found that a claimed or queued send could retain a former target through provider entry after the member's route changed.

## Constraints

- Reuse `HostedExecutionAssistantNotificationRoute` for newsletter delivery instead of expanding the feature-specific route type.
- Reuse the cron current-route snapshot seam for onboarding follow-ups.
- Keep inbound-observed Telegram routes authoritative over direct-probe results.
- Preserve a bot-bound route on temporary failure only for the same verified Telegram identity.
- Do not add schema, repair queues, compatibility tables, or background reconciliation.
- Route changes must reconcile through the existing encrypted channel-update mailbox owner, and a member-paused automation must stay paused.
- Every bot-bound provider request must prove its actual routing fields and the active member's exact current persisted route immediately before provider entry.

## Tasks

1. Persist separate semantic and delivery targets in onboarding follow-up automation routes and add execution proof.
2. Carry typed `authorized`, `denied`, and `unavailable` direct-probe results across Worker, control client, and web routing ownership.
3. Replace the newsletter-specific two-field route with the existing assistant notification route and prove one Telegram conversation.
4. Run focused owner tests and typechecks, required completion audits, parent review, finish-task, push, CI, and ReviewGPT until clean.

## Verification log

- ReviewGPT round 3 on `8eb74b472b`: three findings received and accepted after static production-path validation.
- Security/privacy completion audit: zero remaining validated Medium-or-higher findings after Privy route publication, managed pause ownership, and final Telegram provider-entry authorization fixes.
- Focused verification: web Telegram/Privy/channel suites, Cloudflare Telegram route and egress suites, assistant cron/channel suites, hosted execution parsers, assistant runtime events, control client, and operator runtime helpers passed.
- Owner typechecks: web, Cloudflare, contracts, assistant engine/runtime, hosted execution, Cloudflare control client, and operator config passed.
- Coverage-write completion audit: clean after six tests-only proofs; 478 focused tests passed.
- `pnpm test:diff`: syntax, architecture, privacy/logging, dependency, boundary, all affected typechecks, contracts, and changed-owner package tests passed before the transitive untouched `packages/core/test/preferences.test.ts` causal-token stress case timed out at 60 seconds under the parallel suite; the exact case passed alone (1 passed, 18 skipped) in 54.14 seconds.
Completed: 2026-07-13
