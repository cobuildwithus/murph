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
  reused active offer and gives the model a canonical presentation timestamp.
- A reused native offer becomes a freshly visible first-party link instead of
  being described as a newly sent message.
- The challenge skill counts a grant only when the same participant and scope
  were recorded `not_granted`, the grant occurred within 24 hours after the
  recorded presentation timestamp, and finalized terms are unchanged.
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

- Technical constraints: reuse `HostedVaultShare.grantedAt` and the existing
  offer request time; keep health-data authorization Web-owned and challenge
  participation assistant-page-owned; fail closed across deploy skew.
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

## Tasks

1. Add bounded grant and offer presentation timestamps to the existing hosted
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
- Reuse the existing offer and grant timestamps; add no schema or state owner.

## Verification

- Commands: focused Vitest projects for hosted-execution, assistant-runtime,
  assistant-engine, and hosted Web; affected package typechecks; diff checks and
  privacy scan; required ReviewGPT commands and exact-head GitHub Actions.
- Expected outcomes: fresh and reused presentation paths are truthful, only a
  recent post-baseline exact-scope grant is eligible, and every missing/old/
  mismatched path requires ordinary confirmation.
