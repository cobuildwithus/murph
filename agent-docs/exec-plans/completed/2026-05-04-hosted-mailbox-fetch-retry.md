# Hosted mailbox fetch retry

Status: completed
Created: 2026-05-04
Updated: 2026-05-04

## Goal

- Reduce one-off hosted assistant turn failures when the Cloudflare runner hits a transient hosted mailbox fetch transport error, without retrying mutating control-plane calls.

## Success criteria

- Hosted mailbox fetch and payload fetch retry transient network failures once before failing the turn.
- Mutating hosted web-control callbacks such as workspace checkpoint, runtime log write, usage recording, device-sync apply, and device connect-link remain single-attempted.
- Focused Cloudflare runtime-platform tests prove the retry behavior and privacy-safe logging shape.

## Scope

- In scope: `apps/cloudflare` runtime platform web-control mailbox read calls and focused tests.
- Out of scope: changing hosted mailbox schema, delivery/outbox semantics, model behavior, Linq routing, or WHOOP OAuth/session creation.

## Constraints

- Technical constraints: mailbox fetches are read-only signed POSTs; only retry calls that are safe to replay.
- Product/process constraints: preserve redacted logging and avoid exposing message bodies, account identifiers, URLs, tokens, or local paths.

## Risks and mitigations

1. Risk: Retrying broad POST callbacks could duplicate side effects.
   Mitigation: keep retry scoped to mailbox fetch and mailbox payload fetch only.
2. Risk: Retry logs might leak details from failed requests.
   Mitigation: reuse existing structured request metadata and assert no sensitive response/body data in focused tests.

## Tasks

1. Confirm DB evidence and code path for transient hosted mailbox fetch failure.
2. Add narrow retry helper for mailbox fetch/payload fetch calls.
3. Add focused Cloudflare tests.
4. Run focused verification and required audits for the high-risk hosted runtime change.

## Decisions

- Treat the observed `fetch failed` as a transient read-side callback failure; do not change assistant/model or outbox behavior.
- Retry only mailbox read callbacks because they are replay-safe and were the observed failure point.

## Verification

- Commands to run: focused `apps/cloudflare` test for `runner-platform`, plus routed typecheck/test lane as time permits.
- Expected outcomes: retry tests pass; no sensitive data appears in redacted log assertions.
Completed: 2026-05-04
