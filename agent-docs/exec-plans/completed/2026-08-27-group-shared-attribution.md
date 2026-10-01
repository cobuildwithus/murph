# Preserve group shared-data attribution

Status: completed
Created: 2026-08-27
Updated: 2026-08-27
Completed: 2026-08-27

## Goal

- Restore truthful participant attribution in scheduled group health summaries
  and attribution follow-ups without adding another data, mapping, or newsletter
  owner.

## Success criteria

- The assistant treats a returned `displayName` as the presentation label for
  projections in that same `read_shared` member row while preserving the
  existing rule that names cannot establish sender identity or authority.
- A scheduled group summary does not turn labeled participant-specific values
  into a mapping that Murph later claims is unavailable.
- A direct question about current values performs one fresh, exact-scope
  `read_shared` and answers only from the returned rows.
- A later read never remaps different unlabeled historical figures; without a
  prior explicit association, Murph states that narrow limitation and may
  separately label the fresh result as current.
- Missing or ambiguous labels produce a truthful limitation instead of guessed
  cross-row matching or a request for members to reconfirm tool-known data.
- Deterministic prompt tests, focused real-Codex journeys, package typecheck,
  ReviewGPT, and exact-head CI are green.
- The final production change introduces no persisted state, mapper, service,
  compatibility layer, or newsletter-specific runtime path.

## Scope

- In scope: the resident group-shared presentation/freshness instruction, its
  deterministic tests, focused scheduled and interactive real-Codex journeys,
  the newsletter product contract, and a concise member-visible changelog item.
- Out of scope: changing group grants, projection storage, data collection,
  sender authentication, automation scheduling, delivery ownership, or
  recreating the retired dedicated newsletter subsystem.

## Constraints

- Technical constraints: keep `read_shared` as the only shared-fact owner;
  preserve same-row association rather than reconstructing identity from names,
  order, or values; do not broaden tool availability or call counts outside an
  explicit attribution/current-visibility request.
- Product/process constraints: use synthetic private-free fixtures; treat this
  as a Product UX Patch; inspect actual model replies; use a separate worktree,
  scoped commit, draft PR, preliminary specialist ReviewGPT pass, and green
  required CI before merge.

## Risks and mitigations

1. Risk: wording could weaken the existing sender-identity safety rule.
   Mitigation: explicitly separate presentation of a same-row label from
   authentication, selection, consent, or authority, and assert both required
   and forbidden guidance deterministically.
2. Risk: a broad newsletter-specific prompt could recreate split ownership.
   Mitigation: place one composable row-association rule in the existing shared
   data instruction and keep editorial behavior in the existing skill.
3. Risk: a stochastic test could pass while Murph skips the required refresh.
   Mitigation: assert the exact dynamic-tool call count and arguments in the
   focused real-Codex follow-up journey.

## Tasks

1. [x] Send ReviewGPT the de-identified production/code evidence and request one
   scoped patch attachment.
2. [x] Inspect the returned patch against the current prompt and tool owners;
   simplify or reject any new machinery.
3. [x] Apply the smallest accepted production and deterministic-test changes.
4. [x] Add and run focused scheduled-summary and attribution-follow-up real-Codex
   journeys, reviewing the actual replies.
5. [x] Complete the Product UX walkthrough, changelog, scoped verification, commit,
   draft PR, specialist review, CI, and merge/deploy handoff.

## Decisions

- Web's joined `read_shared` member row remains the sole name-to-projection
  association. The assistant may present that association but may not use a
  name to infer who sent a message or to select/authorize another row.
- Fix the composable group-shared instruction rather than restoring a dedicated
  newsletter reducer or adding a runtime classifier.

## Verification

- Focused prompt proof passed 2/2; assistant-engine and Web typechecks passed;
  the changelog test passed 9/9; the opt-in real-Codex file compiled with all
  paid journeys skipped outside the live gate; `git diff --check` passed.
- Before specialist remediation, the scheduled and explicit-current synthetic
  journeys each passed on the target model with one exact-scope shared read and
  correct same-row labels. On the corrected head, both the default subscription
  and the one permitted alternate home returned
  `ASSISTANT_CODEX_USAGE_LIMIT` before provider entry, so corrected-head live
  UX remains a truthful Hold rather than failed product evidence.
- Preliminary ReviewGPT identified a historical/current snapshot ambiguity and
  missing negative live branches. Both findings were accepted: the prompt now
  forbids retroactive remapping, and focused journeys cover historical figures,
  ambiguous labels, and requested anonymity. The repository workflow does not
  rerun a substantive preliminary pass; the parent inspected and verified the
  remediation.
- Complete first provider input remains unchanged for individual Murph at
  29,166 tokens / 133,774 bytes. Group Murph changes from 25,762 tokens /
  118,441 bytes to 26,035 / 119,884: +273 tokens (+1.0597%) and +1,443 bytes
  (+1.2183%), all in assembled developer instructions.
- Required GitHub merge gates passed on the reviewed candidate, including the
  production runner-bundle budget. The current `main` and candidate produced a
  clean `git merge-tree --write-tree` result; the final plan-only commit retains
  the unchanged reviewed product patch and receives its own exact-head checks.
Completed: 2026-08-27
