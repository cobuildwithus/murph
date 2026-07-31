# Challenge grant recency provenance

Status: active
Created: 2026-07-31
Updated: 2026-07-31

## Goal

- Let one recent exact-scope permission action count as challenge entry without
  treating an old or unrelated grant as affirmative participation.

## Success criteria

- `read_shared` exposes the current grant timestamp for each exact requested
  scope without exposing another member identifier or a new health record.
- `offer_access` distinguishes a newly posted native permission surface from a
  reused active offer and gives the model the provider's canonical message
  creation timestamp only for the newly posted native surface.
- A reused native offer becomes a freshly visible first-party link instead of
  being described as a newly sent message.
- The challenge skill counts a grant only when the same participant and scope
  were recorded `not_granted`, the grant occurred within 24 hours after the
  newly posted native message's provider timestamp, and finalized terms are
  unchanged.
- Missing rollout evidence, an expired window, an older grant, or changed terms
  falls back to ordinary explicit challenge confirmation.
- Focused Web, hosted contract, runtime, assistant-engine, and assembled behavior
  tests pass; required ReviewGPT and exact-head CI gates finish cleanly.

## Scope

- In scope: the existing hosted group offer response, the lazy shared-data read,
  semantic `offer_access` result, challenge prompt contract, durable owner docs,
  and focused state-transition coverage.
- Out of scope: new permission tables, a challenge database owner, new provider
  effects, automatic enrollment outside the challenge skill, and frontend UI.

## Constraints

- Technical constraints: reuse `HostedVaultShare.grantedAt` and the provider's
  existing message chronology; keep health-data authorization Web-owned and
  challenge participation assistant-page-owned; fail closed across deploy
  skew.
- Product/process constraints: recent exact-scope grant is an intentionally
  accepted best-effort participation signal, not proof of challenge-bound legal
  consent; keep the remaining ambiguity explicit in the PR and review triage.

## Risks and mitigations

1. Risk: an unrelated exact-scope permission granted inside the 24-hour window
   can still be interpreted as challenge entry.
   Mitigation: require the exact participant/scope baseline and unchanged terms,
   document this as the accepted product rule, and retain ordinary confirmation
   outside the window.
2. Risk: Web and Cloudflare deploy out of order and disagree on additive response
   fields.
   Mitigation: new parsers accept missing evidence as unavailable, deploy the
   consumer before the producer, and keep older evidence ineligible.
3. Risk: generic or delayed first-party links do not prove when an exact offer
   reached a participant, and the existing join page includes cumulative group
   permission choices.
   Mitigation: keep link and reused-offer recency evidence unavailable; only a
   newly posted native message can use the one-action entry rule.
4. Risk: after provider acceptance and a failed database binding, a same-key
   retry can return the older provider message without posting another surface.
   Mitigation: require provider creation time to fall inside the current send
   attempt; bind older replays durably but keep entry recency unavailable.
5. Risk: Linq accepts whole-second message chronology while local send bounds
   retain milliseconds.
   Mitigation: compare all values at provider-second precision, preserve older
   replay fallbacks, and include same-second ambiguity in the accepted
   best-effort residual.

## Tasks

1. Add bounded grant and provider message timestamps to the existing hosted
   group contracts with fail-closed compatibility parsing.
2. Normalize reused native offers into a visible link result and update the
   challenge prompt to apply the 24-hour exact-scope rule.
3. Update current architecture/product/security guidance and focused tests.
4. Run focused verification, inspect the full diff, commit, push, and update the
   draft PR.
5. Verify the accepted preliminary specialist finding against the remediation,
   then complete the final ReviewGPT gate and exact-head CI before closing the
   plan.

## Decisions

- Product owner accepted a 24-hour exact-scope recency signal as sufficient for
  challenge entry despite residual causal ambiguity.
- Final ReviewGPT round 1 found that request-start link timestamps were not
  truthful delivery evidence and the generic join page did not isolate the
  challenge scope. Accept both findings by narrowing eligibility to newly
  posted native offers with provider chronology; add no schema or state owner.
- Final ReviewGPT round 2 found that provider chronology alone did not prove a
  message was created by the current attempt after a binding rollback. The
  required retrospective continues with one fail-closed interval comparison at
  the existing provider boundary; no replay lifecycle or new owner is added.
- Final ReviewGPT round 3 found that raw millisecond bounds rejected a fresh
  whole-second provider timestamp. Compare at provider-second precision and
  retain the existing early/late replay proof.
- Reuse the existing provider message and grant timestamps; add no schema or
  state owner.

## Verification

- Commands: focused Vitest projects for hosted-execution, assistant-runtime,
  assistant-engine, and hosted Web; affected package typechecks; diff checks and
  privacy scan; required ReviewGPT commands and exact-head GitHub Actions.
- Expected outcomes: fresh native and reused/link presentation paths are
  truthful, only a recent post-baseline grant after a newly posted native offer
  is eligible, and every missing/old/mismatched path requires ordinary
  confirmation.
