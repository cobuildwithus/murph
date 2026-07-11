# Deferred group reaction context

Status: completed
Created: 2026-07-10
Updated: 2026-07-11

## Goal

- Let Murph observe added and removed reactions in established Linq group chats as weak social context on the next natural group turn.

## Success criteria

- Signed reaction webhooks stage the actor, reaction operation, and bounded exact target-part context for an established active group route.
- A reaction alone never signals hosted execution or creates a standalone reply.
- Pending reactions join the next actionable input for the same group, including removals that retract earlier evidence.
- Provider retries are once-only in the mailbox, raw reaction content stays encrypted, and react-to-join consent behavior is unchanged.
- Group guidance treats reactions as weak, group-scoped evidence and updates the existing Knowledge Wiki only from repeated patterns.
- Focused verification, required completion audits, privacy review, and a scoped commit pass.

## Scope

- In scope: Linq reaction parsing, target-message lookup, established group-route mailbox staging, context-only assistant input grouping, group-chat guidance, focused tests, and a durable product spec.
- Out of scope: Telegram inbound reactions, a reaction scheduler or wake, a second preference store, direct-chat reactions, group auto-provisioning from reactions, and changing join-offer revocation semantics.

## Constraints

- Preserve the foreground reply and product-critical flow invariants.
- Keep reaction text and handles out of observability rows and logs; store prompt context only in the encrypted mailbox and canonical vault projection.
- Reuse the conversation mailbox and Knowledge Wiki owners; add no reaction-specific persisted subsystem.
- Preserve unrelated working-tree changes and coordinate around the active mailbox-consumption lane; overlap is limited to narrow additive input metadata and grouping behavior.

## Risks and mitigations

1. Risk: a reaction becomes a reply candidate or causes provider-message cleanup.
   Mitigation: use a distinct non-wakeable conversation mailbox kind, stage it with no provider message reply target, and hold context-only groups until an actionable input arrives.
2. Risk: a reaction is detached from what was liked or disliked.
   Mitigation: retrieve the canonical target message, validate chat/message/part identity, and persist a bounded target-part rendering.
3. Risk: Vercel emits the new conversation mailbox kind before the hosted runner understands it.
   Mitigation: document and verify runner-first deployment ordering.

## Tasks

1. Add the durable product contract and typed reaction fields.
2. Stage validated group reactions in the encrypted conversation mailbox without a runtime handoff.
3. Make context-only Linq inputs wait for and group with the next actionable group input.
4. Add focused parser, webhook, contract, runtime/grouping, and skill tests.
5. Run scoped verification, required audits, privacy inspection, and the final scoped commit.

## Decisions

- Use a distinct `conversation.reaction` kind in the existing conversation mailbox lane; runtime import projects it to an assistant input with `contextOnly: true`. The reaction is transient ingress evidence, not a new state owner.
- Fetch target content at ingress because reaction webhooks carry target identity but not the reacted-to content.
- Dedupe exact retries by provider event id; preserve ordered add/remove events so a later removal can retract the earlier weak signal.

## Verification

- Focused suites passed for hosted provider parsing/staging, hosted-execution parsing, mailbox import, assistant grouping/reply behavior, bounded pending context, and group skill assets.
- `pnpm verify:acceptance` passed with workspace typechecks, all package coverage and package-boundary checks, web build/lint/dev smoke plus 4,269 tests, Cloudflare verification plus 1,713 tests, and fixture smoke coverage.
- Run `git diff --check` and a final identifier/secret/path scan before committing with `scripts/finish-task`.

## Audit resolution

- Security/privacy review: no unresolved medium-or-higher findings after the canonical group/account validation and scanner isolation fixes.
- Coverage-write: added fail-closed route tests plus different-actor, interleaved-group restart, more-than-one-window, semantic add/remove ordering, and context-only pending-boundary regressions; no unresolved gaps.
- Deep review: fixed the accepted cursor head-of-line defect by pairing context through the existing group route, retaining unmatched context behind the channel cursor, and scanning through deferred-only pages; fixed semantic reaction ordering by provider occurrence time; shared that route identity with hosted foreground selection; bounded retained context to 32 per group and 256 total with terminal overflow evidence; and made overflow use the same provider-occurrence ordering so a delayed add cannot outlive its earlier-delivered removal. The final re-audit found no remaining production-impacting findings.
Completed: 2026-07-11
