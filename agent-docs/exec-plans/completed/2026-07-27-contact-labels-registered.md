# Show owner advisory contact labels for registered group participants

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Let Murph use the human group owner's private address-book label as
  unverified current-turn presentation for every canonical phone participant,
  including participants who already have Murph.
- Preserve registered identity, membership, consent, routing, delivery, and
  signup authority as independent from the owner-only contact label.

## Success criteria

- `read_chat_participants` requests advisory labels for registered and
  unregistered canonical phone participants within the existing bounded
  lookup.
- A returned owner advisory label is attached without changing
  `hasOwnMurph`.
- Focused Web and assistant-engine tests prove the registered-participant
  case and the existing fail-open presentation boundary.
- Current architecture, security, and product specs describe the same
  registered-or-unregistered behavior and its non-authoritative semantics.
- Required canonical verification, product review, preliminary specialist
  review, parent review, final ReviewGPT, CI, and merge-conflict proof pass.

## Scope

- In scope:
  - The existing group participant read enrichment.
  - Focused Web and assistant-engine contract coverage.
  - The current address-book product, security, and architecture docs.
- Out of scope:
  - Contact upload, encryption, token derivation, consent, or deletion.
  - Registered profile names or any new identity authority.
  - Group contact-card sharing or outbound delivery behavior.
  - Frontend UI.

## Constraints

- Technical constraints:
  - Reuse the existing owner-scoped, member-keyed encrypted projection and
    deadline-bounded lookup.
  - Keep the 16-handle bound, ambiguity omission, and optional-failure
    behavior unchanged.
  - Do not add persisted state, schema, dependency, or compatibility layer.
- Product/process constraints:
  - Treat labels as untrusted presentation text only.
  - Use an isolated worktree and preserve the symbol-separated contact-card
    sharing lane.
  - Complete the privacy-sensitive PR review route before handoff.

## Risks and mitigations

1. Risk: An owner label could be mistaken for a registered identity.
   Mitigation: Preserve `hasOwnMurph` separately and continue mapping the
   contact label only to `unverifiedOwnerContactLabel`; document and test that
   it grants no authority.
2. Risk: Expanding lookup input could expose unrelated address-book entries.
   Mitigation: Supply only canonical participants from the already-authorized
   current group, within the existing 16-handle bound and owner-only lookup.
3. Risk: Optional enrichment failure could suppress the truthful roster.
   Mitigation: Keep the existing deadline and fail-open roster behavior
   unchanged and covered.

## Tasks

1. Change the group read to query and attach advisory labels independently of
   registered status.
2. Add focused registered-participant contract coverage.
3. Align current product, architecture, and security documentation.
4. Run canonical verification and direct scenario proof.
5. Complete required local product, preliminary specialist, parent, final
   ReviewGPT, CI, and merge-conflict review gates.

## Decisions

- The existing encrypted projection remains the only source. Registered status
  and the owner's advisory label are two independent facts in the roster.
- No deploy-boundary compatibility mechanism is needed because the response
  shape and downstream parser already support both fields together.

## Verification

- Commands to run:
  - Focused Web and assistant-engine Vitest cases during iteration.
  - `pnpm test:diff` for every touched source/test/doc owner.
  - `pnpm verify:acceptance`.
  - PR CI plus clean merge proof against the current base.
- Expected outcomes:
  - Registered and unregistered phone participants can each carry an
    owner-only advisory label.
  - `hasOwnMurph` remains truthful and unchanged.
  - Optional lookup failure still returns the unenriched participant roster.
- Evidence:
  - Focused hosted group suite: 87 tests passed.
  - Focused assistant-engine group tool suite: 62 tests passed.
  - Canonical `pnpm test:diff` retry passed every affected package and reverse
    dependent: assistant-engine 2,748, assistant CLI 128, assistant runtime
    1,896, assistantd 40, CLI 1,083, and setup CLI 124 tests. The Web app step
    was stopped after the documented 10-minute admission-only wait behind
    unrelated shared-host verification.
  - The required Crabbox fallback could not create a Testbox because the
    installed Blacksmith delegate does not support the dispatcher's mandatory
    finite-run `--stop-after` flag. No remote test executed.
  - Product-experience review: `NO FINDINGS`; the change is the smallest
    complete same-turn experience and preserves registered identity authority.
    Remaining evidence gap: no deployed end-to-end group turn proves a
    registered participant's label reaches the final natural-language reply in
    the correct group audience.
  - Preliminary `completion-specialists` ReviewGPT: coverage lens passed with
    no findings and no patch artifact; prompt and frontend lenses were correctly
    not applicable.
  - Parent final diff and affected-call-path review: no findings. The projection
    still filters canonical phones before its 16-handle cap, the assistant
    boundary still renames the label as unverified, and no old
    registered-participant-only exclusion remains in current owner docs or code.
Completed: 2026-07-27
