# Independent Linq email authorities

## Outcome and ownership

User continuation authorizes the remaining PR #2820 correction at unchanged,
clean head `6daa21f9e4a59579f6a0ea657cc9ca3b803f218a`. Preserve the recovered
iMessage handle while honoring a separate verified email on the same member.
No merge or production deployment is authorized.

The resolver already checks both canonical owners and rejects cross-member
disagreement. The subsequent eager handle write wrongly tries to convert every
verified-email match into the member's single retained handle. The existing
writer correctly rejects that replacement before mailbox admission.

Choose deletion: remove that eager write and its private adapter. New unverified
members still retain their handle at identity creation; recovery still binds it
atomically through the existing writer. Existing direct messages resolve through
their current handle or verified-email owner. Neither authority needs to be
copied into the other. Key rotation remains with the encrypted-source owner.
No new state, abstraction, query, schema, or lifecycle is necessary.

## Product UX patch

Prove a recovered-handle member can also message from their separate verified
email, with exactly one mailbox item on replay and the recovered source intact.
Retain foreign-owner rejection, unverified instant start, verified first contact,
and recovered-handle routing through activation. Access and line policy remain
owned by their existing boundaries; no group behavior or assistant prompt changes.

## Work and proof

- [x] Reproduce recovery followed by verified inbound with real identity/routing.
- [x] Delete the eager write and document the independent authorities.
- [x] Run focused PostgreSQL and dispatch proof, typecheck, lint, complexity,
  privacy/readback checks, and parent UX/security review.
- [x] Finish the local candidate and prepare the scoped commit and PR evidence.
- External gates after commit: exact-head CI alongside fresh full ReviewGPT.

The previous round-3 attempt is diagnostic only: the Pro model alias disagreed
with response metadata. Correct the invocation before retrying substantive
round 3. Preserve the immutable first-reviewed baseline and prior valid round-2
head. No additional local database fanout or provider call is introduced.
The existing schema-first Web rollout and old-writer drain remain applicable.

## Candidate evidence

The real PostgreSQL recovery/activation-to-verified-inbound regression failed
before the deletion with the canonical handle conflict. It passes after the
27-line production deletion, as does its deliberately conflicting-owner variant.
The same-member case commits exactly one mailbox item on duplicate delivery and
leaves the entire retained identity record unchanged. No production lines were
added. Existing unverified instant start, verified first contact, key rotation,
authenticated encryption, and unlink proof pass: 231 focused tests total across
five suites, including six PostgreSQL cases. All 213 migrations applied to a
fresh isolated loopback proof database.

Web typecheck, focused ESLint, complexity, diff whitespace, and identifier scans
pass. Existing planner hotspots remain cohesive owners; the deletion adds no
complexity debt. Parent ownership/security and Product UX verdict: Ready. The
existing changelog item still covers this same-PR outcome.

The unchanged production-derived fresh routine-goal live journey passed with
`gpt-5.6-terra` and local subscription auth on the already proven alternate
profile. Manual reply verdict: Ready; one provider request, zero progress
updates, one canonical resume check, concise identity questions. No provider
credentials or production access were used.
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
