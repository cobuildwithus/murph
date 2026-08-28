# Select joined groups by membership inventory

Status: active
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
  existing page boundary remains authoritative; Murph follows the opaque cursor
  until it finds the target or exhausts the list.
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

- Ready. A focused real-Codex journey used three synthetic joined groups that
  shared one participant label and included colliding visible titles. Murph
  listed once, distinguished all three with a participant count and another
  safe clue, waited for the member's clarification, and handed off with exactly
  the selected membership ID. It neither exposed IDs nor called more than one
  handoff.
- The walkthrough caught and removed three brittle behaviors before the
  candidate was frozen: vague "the other" clarification, a false claim that
  joined-group messaging was unavailable, and exclusion of groups that had
  additional people beyond the participant named by the member.
- Deterministic journeys separately cover a unique match, partial roster
  availability, stale membership IDs after leave/rejoin, changed runtime/route
  authority, and replay with a different selected membership.

## Local Evidence

- Hosted Web: six focused files passed (225 tests); changelog registry passed
  (9 tests); package typecheck passed.
- Hosted execution: three focused files passed (76 tests); package typecheck
  passed.
- Cloudflare: three focused files passed (230 tests); package typecheck passed.
- Assistant Engine: group-tool, prompt, tool-description, and scripted exact-ID
  coverage passed (142 focused tests plus one changed scripted journey); package
  typecheck passed. The focused real-Codex journey passed and its reviewed
  member-facing behavior is Ready.
- Provider input, measured from the same normalized complete request with the
  deferred group schema absent initially: direct scope changed from 24,897
  tokens / 114,914 bytes to 24,913 tokens / 115,138 bytes (+16 / +224); group
  scope remained 22,298 tokens / 102,874 bytes (no change).
- `git diff --check` passed. Exact-head CI and the required preliminary and
  final ReviewGPT gates remain pending until the candidate PR exists.
