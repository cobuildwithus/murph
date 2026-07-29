# Use address-book labels as natural participant names

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Let group Murph treat the group owner's shared address-book labels as
  ordinary participant names for conversation, so it can refer to people
  naturally without disclaiming the labels as unverified.
- Preserve the existing hard boundary that a presentation name cannot select
  an identity, membership, route, consent, invite, profile, or other authority.

## Success criteria

- The stable hosted-group prompt explicitly tells Murph to use server-provided
  participant display names naturally when helpful.
- `read_chat_participants` exposes the label to the model as `displayName`
  rather than an unverified contact label.
- Transient participant-change context labels the value as an address-book
  name, while the enclosing event remains weak context and live roster truth
  remains authoritative.
- Focused tests prove the model-visible prompt and tool/event payloads, remove
  the old distrust wording, and preserve the no-authority contract.
- Required product review, preliminary ReviewGPT prompt/coverage review,
  parent final review, exact-head CI, and mergeability proof are complete.

## Scope

- In scope:
  - hosted group system-prompt guidance
  - model-facing group-tool projection
  - transient Linq participant-change prompt text
  - focused tests and the live architecture/product/security docs
- Out of scope:
  - address-book collection, encryption, storage, lookup, lifecycle, or KMS
    behavior
  - registered-member identity, sender attribution, membership, routing,
    consent, invite, or profile ownership
  - new persisted state, APIs, dependencies, background work, or frontend UI

## Constraints

- Technical constraints:
  - keep the Web-to-runner `ownerAdvisoryName` wire and its validation intact;
    change only the model-facing presentation contract
  - keep multi-label ` / ` alternatives honest rather than choosing a name
  - retain the live roster as the decision-time source for membership
- Product/process constraints:
  - do not copy the confidential screenshot or its names into source, tests,
    docs, commits, PR text, or review artifacts
  - use an isolated worktree/PR lane with focused local proof and exact-head CI
  - run local product-experience review and the preliminary ReviewGPT prompt
    and coverage lenses before final handoff

## Risks and mitigations

1. Risk: A conversational display name is mistaken for identity or authority.
   Mitigation: Keep handles and server-owned selectors as the only matching and
   action authority, and state that boundary beside the positive name guidance.
2. Risk: A conflicting multi-label value is presented as one confirmed name.
   Mitigation: Preserve the existing ` / ` alternatives and tell Murph not to
   choose between them.
3. Risk: Participant event history is mistaken for current membership.
   Mitigation: Keep the event in the existing weak quoted context and require a
   live roster read for membership-dependent decisions.

## Tasks

1. Update the stable hosted-group prompt and model-facing roster projection.
2. Update participant-change context wording and focused regression tests.
3. Align the live architecture and product-spec language, and confirm the
   existing security contract still states the unchanged no-authority boundary.
4. Run focused package/app tests and direct assembled-input proof.
5. Commit and push the candidate, open a PR, complete required reviews and CI,
   close the plan, and prove mergeability.

## Decisions

- Treat the address-book value as trusted presentation data but never identity
  or action authority.
- Keep the existing internal `ownerAdvisoryName` transport field to avoid an
  unnecessary cross-plane contract change; expose `displayName` only at the
  model boundary.
- Keep participant events structurally weak and change only the embedded name
  label plus the stable interpretation guidance.
- Keep the existing security contract unchanged: it already states the
  identity, membership, consent, routing, delivery, invite, signup, and profile
  authority exclusions this presentation-only change must preserve.
- Do not volunteer provenance disclaimers during ordinary name use, but answer
  a direct provenance question plainly and truthfully.

## Verification

- Commands to run:
  - focused Assistant Engine group prompt/tool/runtime tests
  - focused Web participant-context tests
  - focused Hosted Execution parser tests if the internal type comment or
    contract changes require them
  - `git diff --check`
  - deterministic base/head initial provider-input token and byte capture
  - required exact-head GitHub Actions
- Expected outcomes:
  - model-visible results use `displayName` and contain no old unverified-label
    field or distrust instruction
  - system prompt invites natural name use while prohibiting authority use
  - participant-change context says `address-book name`
  - all focused checks and required CI pass

## Verification results

- Assistant Engine focused prompt/tool/real-app-server tests: 99 passed.
- Web participant-context tests: 96 passed; the 7 opt-in database concurrency
  cases remained skipped under their normal local gate.
- Assistant Engine and Web owner typechecks: passed.
- `git diff --check`: passed.
- Product-experience review: `NO FINDINGS` after narrowing the provenance rule
  to preserve truthful answers to direct questions.
- Paired exact-base/head provider-input capture with pinned Codex
  `gpt-5.6-terra` code mode and `gpt-tokenizer` 3.4.0 `o200k_base`:
  - individual: 23,594 -> 23,594 tokens and 108,568 -> 108,568 bytes
  - group: 18,196 -> 18,327 tokens and 83,009 -> 83,666 bytes
- Preliminary ReviewGPT and exact-head CI remain pending until the review
  candidate is committed, pushed, and attached to the PR.
