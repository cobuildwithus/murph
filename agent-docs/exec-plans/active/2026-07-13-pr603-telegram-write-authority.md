# PR 603 Telegram Write Authority

Status: active
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Resolve ReviewGPT round 1's accepted finding by restoring automatic Telegram signup outreach only from authority that is bound to the configured bot.
- Represent both inbound-observed and bot-authorized delivery through the existing Telegram thread-target owner without promoting identity into authority.

## Success criteria

- A bare or legacy Telegram user id does not become a delivery route.
- A new Telegram signup skips the redundant messaging setup step only after the configured bot has concrete provider-backed authority to message that Telegram account.
- Inbound-observed Telegram threads remain valid delivery routes and keep precedence over any direct authorization.
- Bot changes, identity changes, absent proof, and failed proof all fail closed.
- Focused tests, required completion audits, CI, and ReviewGPT complete with no unresolved accepted findings.

## Scope

- In scope: Telegram binding, existing encrypted routing state, narrow provider verification, target grammar and final sender validation, focused tests, and the durable contract needed by the correction.
- Out of scope: generic authorization frameworks, background reconciliation, unrelated Telegram group/reminder behavior, and custom replacement of Privy authentication.

## Constraints

- Use one explicit routing owner and the existing encrypted member-routing envelope where durable proof is required.
- Bind authorization to both the Telegram user and the configured bot without persisting tokens or secrets.
- Prefer fail-closed derivation over compatibility inference for historical identity-only rows.
- Preserve unrelated working-tree and coordination-ledger work.

## Risks and mitigations

1. Risk: provider login proves identity but not bot write authority.
   Mitigation: require a provider-backed check or signed grant that specifically covers the configured bot before persisting direct authorization.
2. Risk: a different configured bot silently reuses stale authorization.
   Mitigation: carry the non-secret bot identity in the opaque delivery target and require it to match the final sender's token-derived bot id.
3. Risk: authorization complexity spreads across consumers.
   Mitigation: keep validation and route derivation at the hosted member-routing boundary; consumers receive one resolved delivery target.

## Tasks

1. Prove the narrowest Telegram/Privy authority acquisition path supported by current provider contracts.
2. Add failing regressions for bare identity, bot mismatch, successful authority, and inbound-thread precedence.
3. Implement the smallest bot-bound target using the existing encrypted Telegram thread state and final sender boundary.
4. Run focused verification and required security/privacy, frontend, and coverage-write audits.
5. Commit and push the follow-up patch; rerun CI and ReviewGPT until clean.

## Review history

- ReviewGPT round 1 on commit `0a1d4910e4` accepted one high-severity finding: the patch promoted identity-only Telegram ids to delivery authority without proving write access for the configured bot.
- The first local follow-up attempted the proof in `apps/web`; the required security/privacy audit correctly rejected that placement because production Telegram credentials are Worker-owned and hosted containers receive only an injected sentinel.
- Accepted correction: use the existing Vercel-OIDC Cloudflare control client for a narrow Worker-owned `sendChatAction` probe, return only the public bot id, and compare that bot id with the actual Worker token immediately before provider egress.

## Decisions

- Reuse the existing encrypted `telegramThreadId` routing envelope and extend the shared target grammar with optional `:bot:<botId>`; do not add a database field, routing schema version, queue, or reconciliation service.
- Treat omitted thread input as preserve, explicit failed proof as clearing only a bot-bound target, and inbound-observed targets as independently valid with precedence over direct authorization.
- Keep the existing write fence or provider-egress token as the delivery authority. The public bot-id header is only an additional constraint and is stripped before the Telegram provider fetch.

## Verification log

- `packages/cloudflare-hosted-control`: 43 tests passed; typecheck passed.
- Focused web onboarding/routing: 96 tests passed.
- `packages/assistant-engine` Telegram runtime: 43 tests passed.
- `packages/operator-config` runtime helpers: 30 tests passed; typecheck passed.
- `apps/cloudflare` typecheck passed; focused Worker route test: 12 tests passed.
- `packages/messaging-ingress` typecheck passed.
- Required security/privacy audit: no actionable Medium-or-higher findings after the Worker-boundary correction; a delta rerun after internal-header tightening and defensive bot-id normalization was also clean.
- Required frontend review: zero evidence-backed findings; 193 focused UI/server tests passed. Live Privy plus Worker-owned Telegram replay remains the explicit provider/browser verification gap.
