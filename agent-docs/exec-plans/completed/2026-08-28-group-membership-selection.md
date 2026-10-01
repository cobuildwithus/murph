# Select joined groups by membership inventory

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Let a private member discover every joined group through the existing paged
  membership inventory, with safe per-group participant context and independent
  availability.
- Make joined-group consultation target only an opaque membership ID returned by
  that inventory, while Web remains authoritative for membership, runtime, and
  route validity at the effect boundary.
- Delete server-side inference from participant clues and the digest state that
  bound a handoff to that inference.

## Product UX Product Change

### Outcome

A member can naturally identify the intended joined group from titles,
participant counts, and safe participant labels, clarify among similar groups,
and hand work to the selected group without one unreadable group blocking the
rest.

### Entry And Promise

- Entry: in a private conversation, the member asks Murph to consult or tell one
  of their joined groups, using a title, participant, or ordinary group cue.
- Promise: Murph reads the paged membership inventory, asks one natural question
  when more than one entry remains plausible, and targets only the selected
  server-issued membership ID. A successful handoff is queued to that joined
  group; it is never described as delivered before the existing delivery owner
  proves delivery.

### Affected People

- One usable group: the member sees no internal identifiers and Murph proceeds
  from the unique inventory entry.
- Several groups with an overlapping safe participant label: Murph distinguishes
  them using real participant count, other safe labels, and a safe title when
  present, then waits for the member's choice.
- Partial provider or route evidence: usable memberships remain visible; only
  the affected entry reports unavailable participant details or handoff status.
- Stale clarification after leave and rejoin: the old membership ID is rejected
  because the newly joined generation has a different ID.
- No active membership or a membership whose runtime/route authority changed:
  Web rejects the action truthfully without guessing, falling back, or targeting
  another group.
- People in the selected group: only the explicitly requested bounded context
  reaches that group through the existing group-Murph authoring and delivery
  path; inventory labels remain private to the requesting member.

### Challenge And Resolution

- A raw roster could expose contact handles. The inventory emits only authorized
  contact names, otherwise bounded phone hints or a generic email label.
- Reading all memberships at once would create unbounded provider fanout. The
  existing page boundary remains authoritative; Murph exhausts the opaque
  cursor chain before choosing or asking the final clarification.
- Discovery cannot be the action authority. Web re-locks the exact membership
  and revalidates requester ownership, active access, runtime identity, and
  route authority immediately before the existing ask or handoff path proceeds.

### Proof Path

- Deterministic hosted-execution and Web tests prove the inventory shape,
  per-entry partial availability, safe labels, bounded page fanout, stale-ID
  rejection, and exact membership/runtime/route revalidation.
- Deterministic Assistant Engine tests prove the list-first contract and strict
  membership-ID ask/handoff schemas.
- A focused real-Codex journey proves natural disambiguation across synthetic
  groups and the final selected membership ID handoff, with reply and effect
  inspection.

### UX Finish

- Clarification uses the smallest useful distinction and never exposes opaque
  IDs, full phone numbers, email addresses, provider handles, or raw titles that
  resemble contact handles.
- Per-entry unavailable data is honest and does not erase other entries.
- Pagination and pending handoff behavior remain explicit to the model while
  member-facing language stays conversational.

### Done When

- Every listed membership has its existing ID, safe title, real participant
  count when available, safe participant labels, and independent availability.
- `ask` and `handoff` accept only an inventory-issued membership ID as their
  joined-group selector.
- Participant-target matching, digest binding, and direct name-selection prompt
  guidance are absent from production code and provider-visible contracts.
- The selected effect is revalidated at the existing Web authority boundary,
  and focused deterministic plus real-Codex proof are Ready.

## Scope

- In scope: hosted execution contracts/parsers, Web membership listing and
  consultation selection, Assistant Engine schemas/prompts, focused tests, one
  real-Codex journey, durable architecture notes if the public contract changes,
  and a public changelog item.
- Out of scope: historical roster backfill, provider-route repair, new persisted
  state, new selector tokens, group creation/leave behavior, and changes to the
  downstream group outbox or provider delivery owners.

## Constraints

- Keep database transactions short and database-only; provider, contact, and
  cryptographic work stays outside them.
- Bound enrichment to one existing membership page and at most the established
  provider concurrency and deadline.
- Preserve old-reader/new-reader deploy skew deliberately and document the safe
  deployment order before opening the PR.
- Preserve unrelated checkout and worktree state.

## Tasks

1. Define the per-membership participant inventory and membership-ID consultation
   contracts at the hosted-execution owner.
2. Refactor Web listing to enrich each page independently and replace inferred
   selection with exact membership authority revalidation.
3. Simplify Assistant Engine schemas and prompt guidance to list, clarify, then
   act with the exact returned membership ID.
4. Replace obsolete participant-matcher coverage with deterministic contract,
   partial-result, generation-fence, and composed effect proof.
5. Add and run the focused real-Codex journey, update the changelog, typecheck,
   inspect provider-input impact, and complete the Product UX walkthrough.
6. Commit and push the candidate, open the PR, then run the required preliminary
   Product UX/prompt/coverage pass and sensitive final ReviewGPT gate with CI.

## Verification

- Focused hosted-execution parser/contract tests.
- Focused hosted Web group listing, ask/handoff, and PostgreSQL admission tests.
- Focused Assistant Engine schema, prompt, parser, and real-Codex journey tests.
- Package typechecks for every touched owner plus changelog registry proof.
- `git diff --check`, secret/private-identifier inspection, provider-input
  measurement, exact-head CI, preliminary specialists, and final ReviewGPT.

## Product UX Walkthrough

- Ready. A focused real-Codex journey used three synthetic joined groups across
  two inventory pages. They shared one participant label and included colliding
  visible titles. Murph exhausted both pages, distinguished all three with real
  chat participant counts, waited for the member's clarification, and handed
  off with exactly the selected membership ID. It neither exposed IDs nor
  called more than one handoff.
- The walkthrough caught and removed three brittle behaviors before the
  candidate was frozen: vague "the other" clarification, a false claim that
  joined-group messaging was unavailable, and exclusion of groups that had
  additional people beyond the participant named by the member. Its final pass
  also caught and corrected use of Murph-member counts instead of real chat
  participant counts.
- Deterministic journeys separately cover a unique match, partial roster
  availability, stale membership IDs after leave/rejoin, changed runtime/route
  authority, and replay with a different selected membership.

## Local Evidence

- Hosted Web: six focused files passed (230 tests); changelog registry passed
  (39 tests); package typecheck passed.
- Hosted execution: three focused files passed (76 tests); package typecheck
  passed.
- Cloudflare: three focused files passed (230 tests); package typecheck passed.
- Assistant Engine: group-tool, prompt, tool-description, and model-behavior
  coverage passed (217 tests), and the focused scripted exact-ID journey passed;
  the parser compatibility matrix passed (8 tests); package typecheck passed.
  The two-page focused real-Codex journey passed on `gpt-5.6-terra`; its
  reviewed member-facing behavior is Ready.
- Assistant Runtime: the two affected context and automation files passed (70
  tests); package typecheck passed.
- Provider input, measured from the same normalized complete request with the
  deferred group schema absent initially: direct scope changed from 22,317
  tokens / 105,380 bytes to 22,360 tokens / 105,751 bytes (+43 / +371); group
  scope remained 18,770 tokens / 89,508 bytes (no change).
- `git diff --check` and private-identifier inspection passed. The preliminary
  specialist and final round-1 findings were accepted and resolved. Round 2
  required the repository's authored-source retrospective; it was recorded with
  an explicit continuation decision because the inventory, membership-ID
  transport, and final Web effect boundary are one indivisible outcome with net
  source deletion and no new durable state owner. Final ReviewGPT round 3 then
  passed the full patch with no remaining production findings.
Completed: 2026-08-28
