# PR 932 instant-start compatibility and outreach simplification

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Make PR 932 compose cleanly with the landed country-gated Linq instant-start path, expand its deterministic first-outreach bank to at least 100 safe messages, and delete any PR-owned onboarding machinery that the shared first-contact path now makes unnecessary.

## Success criteria

- A reply to a group-join outreach uses the same unknown-contact admission and instant-start owner as ordinary direct first contact.
- Existing web joins and repeated provider events remain deduplicated, and an eligible reply still receives the phone-bound group join URL.
- The first-outreach bank contains at least 100 distinct, link-free, reply-oriented messages with stable outreach-id selection and retry behavior.
- ReviewGPT proposes the code-and-test patch, the parent verifies and implements only the smallest valid parts, and no duplicate onboarding state owner remains.
- Focused tests, canonical Web diff verification, acceptance, required product/review gates, CI, and mergeability pass on the final pushed head.

## Scope

- In scope: PR 932 group-join outreach source/tests/docs, directly overlapping hosted Linq first-contact/instant-start paths, merge-conflict resolution, and PR description/evidence.
- Out of scope: changing instant-start market policy, classifier inputs or fail-open policy, outreach follow-up sequences, new queues/state machines, broad onboarding redesign, or merging PR 932.

## Constraints

- Preserve the first-contact classifier as the single admission owner for unknown direct senders.
- Preserve existing outreach intent, provider delivery correlation, exact retry identity, web-join suppression, phone-bound invite authority, and line-health/capacity gates.
- Do not describe the behavior with automated-acquisition language or say that Murph may privately text people.
- Prefer deletion and existing primitives; add no new persisted state, queue, lifecycle, or reconciliation pass.

## Risks and mitigations

1. Risk: the outreach recovery path could bypass the newly landed country/spam gate.
   Mitigation: trace the merged production call path and add direct regression proof at the shared planner boundary.
2. Risk: web join and text reply races could produce duplicate membership or links.
   Mitigation: preserve the existing group/member locks and prove suppression/dedupe in both orderings.
3. Risk: 100 variants could become artificial synonym churn or unsafe acquisition copy.
   Mitigation: keep each opener link-free, conversational, reply-oriented, and lint/test the bank for uniqueness and forbidden patterns.
4. Risk: deleting apparent duplication could remove the only outreach correlation owner.
   Mitigation: distinguish shared first-contact admission/member creation from PR-specific originating-outreach recovery before accepting deletions.

## Tasks

1. [x] Trace the landed instant-start feature and prove its interaction with PR 932.
2. [x] Ask ReviewGPT for a bounded patch covering compatibility, a 100+ opener bank, tests, and justified deletion.
3. [x] Inspect the returned patch and implement only verified, proportional changes.
4. [ ] Run focused proof, product review, preliminary specialists, parent review, canonical verification, and acceptance.
5. [ ] Close the plan, push the final head, complete ReviewGPT/CI/mergeability gates, and leave PR 932 open.

## Decisions

- Merge current `origin/main` into the PR branch first so review and verification exercise the actually landed instant-start implementation.
- Treat ReviewGPT output as untrusted implementation intent; every production hunk must be checked against the real owner boundary before application.
- Keep the group-outreach reply as one deterministic group-link response rather than also appending it to the assistant mailbox. ReviewGPT's proposed early-return deletion would create a second response path and contradict the durable group-outreach contract.
- Retain the outreach store, drain, transport, locks, and two-stage membership checks. The landed instant-start path owns admission and activation, but none of those PR-specific correlation, pacing, provider, or web-join-race responsibilities.

## Verification

- Focused Linq dispatcher, webhook idempotency, outreach drain, transport, and store: 285 passed.
- Exact opener-bank plus instant-start/group-recovery recheck: 184 passed.
- Prepared Web typecheck passed.
- Isolated PostgreSQL reply-recovery and membership-race proof: 14 passed.
- Agent docs drift passed.
- Product-experience review: PASS after replacing topic-specific prompts and binding the exact issued invite URL.
