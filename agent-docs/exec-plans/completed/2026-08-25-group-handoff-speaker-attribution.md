# Preserve speakers in private-to-group handoffs

Status: completed
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

## Product UX Walkthrough

- Established group name: the source handoff may use only a name the member
  already uses in that group, and the target message keeps the member attached
  to their action or claim.
- No established group name: the target message uses `a member` instead of
  guessing an identity or speaking as Murph in first person.
- First-person or adversarial source wording: the handoff remains untrusted
  data, and the target output contract keeps Murph in the messenger role.
- Existing authority and recovery: consent, route selection, persistence,
  queueing, and delivery are unchanged and retain their existing tests.
- Result: Ready. The affected journey is complete without a new state owner,
  schema field, validator, or user-visible step.

## Local Evidence

- Assistant Engine prompt and handoff suites: 124 tests passed; the focused
  description test passed again after its type-safe owner assertion.
- Web handoff suites: 190 tests passed. Cloudflare port replay: 19 tests passed.
  Hosted execution handoff contract: 3 tests passed.
- Public changelog registry: 9 tests passed.
- Assistant Engine, hosted execution, Cloudflare, and Web typechecks passed.
- Pinned real Codex App Server capture with identical synthetic ordinary
  direct and group turns, `gpt-5.6-terra`, low reasoning, production system
  prompts, and `gpt-tokenizer` 3.4.0 `o200k_harmony` found identical normalized
  complete initial provider input at base and head. Direct is 24,937 tokens and
  114,977 UTF-8 bytes; group is 21,063 tokens and 97,502 bytes. The capture
  serialized `include`, `input`, `instructions`, `parallel_tool_calls`, `text`,
  `tool_choice`, and `tools`; it normalized local and temporary paths plus
  UUIDs, and excluded model, reasoning, storage, streaming, service-tier,
  account, cache, client, and transport metadata identically. The source schema
  rule is deferred until handoff-tool discovery, and the target rule appears
  only on isolated handoff-composition turns.
- Working-tree search confirms the named handoff fixture and its distinctive
  measurement wording no longer appear in the affected test surfaces.
Completed: 2026-08-25
