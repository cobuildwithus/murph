# Preserve speakers in private-to-group handoffs

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Keep member actions, claims, and experiences attributed to the member when
  private Murph hands context to a group.
- Remove the real-person example from this feature's tests and fixtures.
- Preserve the existing authority, persistence, routing, and delivery design.

## Product UX Patch

- Outcome: a group handoff reads as Murph relaying a member's update, never as
  Murph claiming the member's action as its own.
- Reaches: existing private-to-group context handoffs only.
- Proof: focused prompt-contract tests cover source attribution and target
  composition, while existing execution tests retain route and delivery proof.

## Scope

- In scope: the source handoff field contract, the target output contract,
  focused tests and fixtures, and a public changelog item.
- Out of scope: new fields, persisted state, runtime validation, routing,
  delivery, consent, retries, and unrelated group behavior.

## Constraints

- State each model-facing rule once at its owning boundary.
- Use a neutral member reference when no safe group-recognizable name exists;
  never invent identity.
- Do not ban Murph from all first-person language, only from presenting a
  member's actions, claims, or experiences as Murph's own.
- Keep examples synthetic and free of names or private feedback wording.

## Tasks

1. Tighten the source context field and target output contracts.
2. Replace the named handoff example across focused tests and fixtures.
3. Add focused regression assertions and the public changelog item.
4. Run focused tests and typechecks, inspect the diff, and complete the Product
   UX walkthrough.
5. Commit, push, open the PR, and run the required preliminary Product UX,
   prompt, and coverage review against the exact candidate head alongside CI.

## Verification

- Focused Assistant Engine prompt and tool-contract tests.
- Existing handoff tests in Assistant Engine, Web, Cloudflare, and hosted
  execution.
- Assistant Engine and Web typechecks.
- Focused changelog registry test.
- `git diff --check` and privacy-sensitive diff inspection.
- Exact-head CI and preliminary specialist ReviewGPT pass.

