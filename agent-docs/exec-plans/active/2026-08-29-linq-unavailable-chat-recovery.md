# Recover replies from unavailable Linq chats

Status: active
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Restore an already-supported private Linq reply when its stored direct chat has
  become unavailable, using the existing safe direct-thread materialization
  owner and without broadening message, retry, route, or provider authority.

## Success criteria

- A provider-shaped HTTP 409 / Linq code 2013 send failure reaches the same
  bounded direct-thread materialization path as the existing definitive stale
  chat classification when every existing recovery precondition holds.
- The original reply remains single-owner and idempotent; no second send occurs
  after an ambiguous provider outcome.
- Other 409s and unclassified failures remain terminal and do not gain fallback.
- Focused regression tests, affected typechecks, completion audits, exact-head
  CI, and final ReviewGPT pass are green on the PR head.

## Scope

- In scope: the Linq provider error classifier, the existing hosted direct-chat
  recovery predicate, focused provider-shaped tests, and durable contract text
  only where the final implementation changes an operational guarantee.
- Out of scope: device sync, line selection, message content, copy, retry timing,
  database schema, provider configuration, production state repair, canaries,
  and recovery for any failure that could be ambiguous after provider entry.

## Constraints

- Technical constraints: reuse existing error context and direct-thread
  materialization; add no state owner, queue, scheduler, provider call, or
  unbounded telemetry. Preserve current home-route, native-reply, media, and
  idempotency gates.
- Product/process constraints: ReviewGPT exclusively authors production code and
  remediation. Production evidence and review packets remain privacy-safe.

## Risks and mitigations

1. Risk: treating a generic conflict as a stale chat could send a duplicate or
   reroute into the wrong conversation.
   Mitigation: admit only the exact provider code 2013 / HTTP 409 / send-message
   tuple and retain every existing direct-thread recovery precondition.
2. Risk: the provider may have accepted the message before returning failure.
   Mitigation: rely on the documented resource-state error and test that no
   transport, timeout, 5xx, generic 409, or unknown 2xxx code gains fallback.
3. Risk: a recovery attempt can change iMessage delivery behavior unexpectedly.
   Mitigation: run provider-shaped boundary tests plus the existing hosted
   delivery recovery suite and inspect the composed outbox path.

## Tasks

1. Add a focused failing test proving code 2013 is currently terminal while the
   existing safe recovery preconditions are satisfied.
2. Send ReviewGPT the redacted root-cause and implementation packet.
3. Inspect and apply only a scoped ReviewGPT patch, then run focused proof.
4. Commit, push, open the PR, and run preliminary specialists plus final
   ReviewGPT concurrently with required CI.
5. Resolve findings, finish the plan, and leave the ordinary bug-fix PR ready
   for human merge.

## Decisions

- Product UX effort: Patch.
- Outcome: a member's ordinary reply continues in a valid direct chat when the
  previously stored Linq chat is definitively unavailable.
- Reaches: private Linq replies using existing direct-thread recovery authority.
- Proof: a provider-shaped code-2013 regression reaches one materialization
  attempt and one accepted send, while generic conflicts remain terminal.
- Production root cause: one terminal reply received HTTP 409 / provider code
  2013; current classification admits only HTTP 404 `chat_not_found` to the
  existing materialization path.

## Verification

- Red proof: the provider-shaped code-2013 assistant-runtime regression failed
  with the original HTTP 409 `VaultCliError` before the implementation patch.
- Green proof: the full hosted-provider-effects test file passes 24/24 and the
  full HTTP Linq runtime test file passes 74/74 after the patch.
- Boundary proof: the classifier accepts only the existing 404
  `chat_not_found` tuple and the exact 409/code-2013 tuple; generic 404/409,
  nearby status codes, transport failures, different operations, paths, and
  providers remain excluded.
- Type proof: the affected assistant-runtime and operator-config package
  typechecks pass.
- Product UX walkthrough: Ready (Patch). The affected member's private reply
  reaches one newly materialized direct chat and sends once; the existing
  safety, idempotency, route, media, and ambiguity gates remain unchanged.
- Changelog decision: update in the same PR because a member can experience the
  restored reply. Keep the item generic, privacy-safe, and free of incident or
  provider internals.
- Remaining gates: repository privacy/identifier guards, changelog proof,
  preliminary specialists, final ReviewGPT, and exact-head PR checks.
