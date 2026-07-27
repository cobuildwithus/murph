# PR 1043 Group-Chat Recovery Completion

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

Take the existing group-chat access-recovery PR through the repository's full
completion path so a recognized member who cannot activate Murph in a group gets
the smallest privacy-safe private recovery, valid trials keep working, and the
exact final PR head is merge-ready.

## Success criteria

- The Linq and Telegram group-add paths use canonical current access decisions,
  never expose account state in a group, and never target a different member or
  stale group-shaped route.
- Unknown senders remain silent, valid trials remain admitted, and recognized
  suspended members receive only generic private account-unavailable copy.
- Retry, ambiguity, route-change, and existing-thread-container paths have
  focused regression proof without a second access-policy or delivery owner.
- The applicable local product-experience review, preliminary
  `completion-specialists` ReviewGPT pass, parent final review, canonical
  verification, and final ReviewGPT loop have no unresolved accepted findings.
- The branch is current with `main`, the exact pushed head is conflict-free, and
  required PR CI is green.

## Scope

- In scope: PR 1043's hosted Web Linq and Telegram recovery code and tests;
  direct call paths needed to verify access, route authority, provider-effect
  identity, failure handling, and user-visible recovery; exact-head PR docs and
  completion artifacts.
- Out of scope: new billing products, new group admission policy, schema or
  queue additions, frontend changes, production deployment, and unrelated
  group-chat behavior.

## Constraints

- Preserve the existing group admission planners and recognized-inbound access
  resolver as the only policy owners.
- Send account recovery only to a provider-authenticated recognized member's
  private route. Never disclose billing, trial, or suspension state in a group.
- Preserve product-critical active paid, Family-sponsored, and valid-trial
  group flows.
- Prefer deletion, ordering, or an existing owner boundary over new state,
  retries, queues, or compatibility machinery.
- Keep ReviewGPT artifacts ignored and uncommitted; use only exact pushed-head
  guarded packaging.

## Risks and mitigations

1. Risk: a broad active-member check admits a trial state that the runtime later
   rejects, recreating silent accepted work.
   Mitigation: trace every group ingress and runtime access decision and prove
   them against valid and expired trial fixtures.
2. Risk: private recovery reveals account state to the room or the wrong person.
   Mitigation: bind recovery to provider-authenticated sender identity, attest
   the private target, and fail to neutral room behavior when authority is
   missing or changes.
3. Risk: Telegram or Linq ambiguity causes duplicate private recovery.
   Mitigation: reuse the current provider-effect owner and stable event-scoped
   identity; distinguish proven pre-provider failure from ambiguous dispatch
   only where the provider boundary supports it.
4. Risk: an existing thread container is inactive for a different actor, making
   a sender-focused recovery misleading.
   Mitigation: trace the actual inactive owner and send only truthful,
   actor-scoped recovery; retain neutral room behavior when private recovery
   cannot resolve the blocker.
5. Risk: base movement or CI drift is mistaken for a PR regression.
   Mitigation: inspect failing CI logs, merge `main` through ordinary Git
   history before exact-head gates, and reproduce only the owning scenario.

## Tasks

1. [x] Inspect the full PR diff, adjacent admission/runtime call paths, prior
   review evidence, current CI failure, and latest `main`.
2. [ ] Reproduce and correct only proven edge cases; run focused proof and the
   canonical coverage-bearing verification. Focused proof is green; canonical
   verification remains.
3. [ ] Run the required local product-experience review and the one preliminary
   `completion-specialists` ReviewGPT pass; triage and resolve every finding.
   Product-experience review passed; preliminary ReviewGPT remains.
4. [ ] Run the parent final review, close this plan with the scoped commit path,
   and push the exact candidate.
5. [ ] Run the final ReviewGPT loop concurrently with CI until
   `ROUND_OUTCOME: PASS`, zero accepted findings, green required checks, and
   clean mergeability.

## Evidence

- Parent audit reproduced a weaker group-ingress access check admitting expired
  active-status trials that the runtime then rejected. Linq, Telegram, and the
  shared thread-container provisioning boundary now use the canonical
  current-time runtime AI-access decision.
- Existing Telegram routes now recheck the exact container before append.
  Provider-confirmed private Telegram rejection and nonretryable Linq private
  rejection fall back to account-neutral room guidance; ambiguous outcomes keep
  their existing replay-safe or at-most-once treatment.
- Linq private recovery accepts committed or pending private authority, requires
  the sender's own Murph line for new groups, rechecks the stored route, and
  re-attests directness immediately before send.
- Focused Web proof passed across Linq admission, Telegram admission, visible
  access, visible-secondary fallback, route wiring, and Telegram delivery.
  Web typecheck and scoped lint passed.
- The required local product-experience review returned `PASS` after the Linq
  wrong-number fallback was made actionable and channel-specific.

## Verification plan

- Focused hosted Web Vitest coverage for Linq group recovery, Telegram visible
  access, and Telegram access-notice delivery.
- `pnpm test:diff` over the touched hosted Web source and tests, or
  `pnpm verify:acceptance` when diff coverage is not truthful after base updates.
- Direct source-to-provider journey proof for new-group and existing-container
  recovery, valid trial, unknown/suspended sender, stale route, and ambiguous
  delivery.
- Exact failing hosted-local E2E scenario when CI evidence connects it to the
  PR; otherwise document the unrelated failure proof and rely on rerun CI.
- Preliminary specialist and final PR ReviewGPT packets on clean exact pushed
  heads, plus final required GitHub CI and mergeability checks.
