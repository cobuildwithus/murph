# Preserve group shared-data attribution

Status: active
Created: 2026-08-27
Updated: 2026-08-27

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
- A direct follow-up asking who had which shared values performs one fresh,
  exact-scope `read_shared` and answers only from the returned rows.
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

1. Send ReviewGPT the de-identified production/code evidence and request one
   scoped patch attachment.
2. Inspect the returned patch against the current prompt and tool owners;
   simplify or reject any new machinery.
3. Apply the smallest accepted production and deterministic-test changes.
4. Add and run focused scheduled-summary and attribution-follow-up real-Codex
   journeys, reviewing the actual replies.
5. Complete the Product UX walkthrough, changelog, scoped verification, commit,
   draft PR, specialist review, CI, and merge/deploy handoff.

## Decisions

- Web's joined `read_shared` member row remains the sole name-to-projection
  association. The assistant may present that association but may not use a
  name to infer who sent a message or to select/authorize another row.
- Fix the composable group-shared instruction rather than restoring a dedicated
  newsletter reducer or adding a runtime classifier.

## Verification

- Commands to run: focused prompt/unit tests; assistant-engine typecheck;
  `pnpm test:assistant:live -- --test <focused-pattern>` for each new journey;
  `git diff --check`; required exact-head GitHub checks.
- Expected outcomes: scheduled prose preserves available labels, follow-up
  performs exactly one fresh shared read and answers from same-row facts,
  missing labels are handled honestly, and no sender-identity/authority rule is
  weakened.
