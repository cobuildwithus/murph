# Repair canary runtime authority and bound provider WebSocket queues

Status: active
Created: 2026-09-13
Updated: 2026-09-13

## Goal

- Let the fixed-account canary observe the ordinary iMessage runtime's canonical outcome without inventing browser consent grants. Bound relay memory retained while authorization or accounting waits.

## Success criteria

- Fresh messaging-only account passes the read-only observer; inactive, suspended, deleted, or explicitly withdrawn accounts fail at both authority checks. Browser Vault retains its current-consent requirement.
- Message admission bounds pending UTF-8 bytes and message count before enqueueing, including binary, multibyte, empty, and oversized frames. Queued terminal usage and completion delivery survive provider overflow before orderly shutdown.
- Focused failing-before/passing-after proof, Web/Worker typechecks, parent review, required ReviewGPT and exact-head CI pass before release readiness.

## Scope

- In scope: existing canary observer, existing WebSocket relay, focused synthetic tests and owner contracts.
- Out of scope: consent grants or new privileged mutation endpoints, normal Browser Vault policy, provider replay, broader runtime recovery, unrelated open work.

## Constraints

- Web owns account access and explicit withdrawal. Reuse its runtime decision at initial/final observation; retain fixed configured identity, input-free bearer route, canonical checkpoint/replica validation, generic failure response, and closed diagnostics.
- Relay owns only ephemeral queue admission. Keep serial processing, no retry, and existing terminal accounting. New bounds add no database/provider calls or timers.
- Isolated checkout at ad68eb63915e72a6e7aab3f83894684343b5b69e; user requests both fixes. Production-secret handling remains hosted-only.

## Risks and mitigations

1. Incorrectly treating a messaging account's absent browser grants as revoked consent. Reuse runtime policy; exercise real access/consent owners and unchanged Browser Vault authority.
2. Overflow drops an already billed terminal or forwards another request after shutdown. Stop new admission immediately, preserve accepted provider work in order, then close downstream; test blocked persistence and peer-close races.
3. Payload bytes alone do not bound empty-frame promises. Bound message count as well, and release reservations on success and error.
4. Per-connection limits do not prove a whole-isolate memory ceiling or the cause of an observed production OOM. State this limit and validate actual workerd transport behavior.

## Tasks

1. Trace reset/signup/observer authority and relay lifecycle; write focused regressions.
2. Correct the existing owners and prove failures plus ordinary success paths.
3. Update durable contracts and changelog decision; inspect complexity and full diff.
4. Scoped commit and PR; required external review concurrent with CI; follow through authorized release boundaries.

## Decisions

- Reset deletes the canary account and ordinary iMessage signup does not grant current browser launch consent. A one-time grant cannot repair subsequent runs. The internal counts observer needs runtime access, while the browser data API keeps its separate authority.
- Reuse the existing 32 MiB byte ceiling across both directions and cap pending message count at 4,096. Provider overflow closes provider admission immediately and drains already accepted completions before downstream close; client overload remains fail-closed.
- Product UX Patch: Outcome: bounded streaming and truthful canary evidence. Reaches: ordinary streaming, delayed authorization/accounting, overflow, disconnect and access revocation. Proof: actual relay and actual authority composition with synthetic external edges. No presentation or provider-input changes.

## Verification

- Focused Web observer/route/access/browser-authority tests; Cloudflare relay node and workerd tests; affected app typechecks; complexity diff and repository guards.
- Required exact-head CI owns broad tests. Live hosted canary and deployment receipts remain separate from local synthetic evidence.
- Before source correction: the new actual-authority fixture failed with the generic unavailable response (five denial/browser-protection cases passed); five relay burst/overload cases failed solely because admission never closed (15 cases passed).
- Candidate: 80 Web reader/route/actual-runtime-authority/browser-authority tests, 22 relay node tests and seven native workerd WebSocket tests pass. Web and Cloudflare typechecks pass. Complexity: relay maximum 16 to 15; observer maximum 19 unchanged; no hotspots. Whitespace and docs drift pass.
- Parent candidate review: Ready. Retains exact identity/replica/checkpoint fences, no-store and generic diagnostics; canonical runtime policy denies withdrawal. Provider overload blocks new admission, keeps existing queue bounded and drains accepted terminal accounting/delivery. Native workerd verifies close ordering. No new waits, external calls, provider inputs, schemas, persisted state or timers on foreground execution.
- Changelog decision: not applicable. Fixed-canary observation is operator-only and the relay change is internal resource-admission hardening; the cause of a particular production memory failure remains unproven, so no member-visible incident-recovery claim is made.
- Remaining: draft PR, required final review and exact-head CI, then deployment/canary evidence under the existing authorized delivery path.
