# linq-instant-start-launch-markets

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Expand the existing direct-iMessage instant-start prefix gate from the full
  North American Numbering Plan to a conservative set of low-risk launch
  markets without changing trial economics, group behavior, or runtime
  ownership.

## Success criteria

- The default prefix policy covers the approved launch markets through the
  existing environment owner.
- Unsupported prefixes, SMS/RCS, group chats, and all other existing
  ineligible paths continue to use the signup-link or ignored behavior.
- No country service, fraud ledger, alternate allowance, or second admission
  system is introduced.
- Focused tests, canonical verification, product review, CI, and ReviewGPT pass
  on the exact pushed head.
- The follow-up PR is merged and its worktree is retired.

## Scope

- In scope: the default instant-start E.164 prefixes, environment example,
  focused configuration coverage, and the durable security contract.
- Out of scope: carrier or nationality attestation, dynamic risk scoring,
  changes to first-contact classification, trial value, group-join admission,
  or outbound SMS verification.

## Constraints

- Keep one configurable prefix list as the policy owner.
- Treat calling codes as coarse abuse friction, not proof of identity,
  residency, nationality, carrier type, or low fraud.
- Preserve the existing provider-authenticated, inbound-only, direct-iMessage,
  same-line, model-source-allow requirements and all fallbacks.

## Risks and mitigations

1. Risk: a broad calling code could cover territories outside the named launch
   market.
   Mitigation: keep the documented coarse-prefix limitation, including the full
   NANP behavior of `+1`, and retain all non-geographic admission checks.
2. Risk: a copied production environment override could keep the old narrower
   policy after deployment.
   Mitigation: inspect environment-variable presence without downloading
   secrets and call out any required configuration update in the deployment
   handoff.

## Tasks

1. Define the conservative default prefix set in the existing environment
   owner and mirror it in the environment example.
2. Update focused tests and the durable security contract.
3. Run focused and canonical verification, product review, preliminary
   completion specialists, and parent final review.
4. Commit, push, open the PR, run final ReviewGPT with CI, resolve findings,
   merge, and retire the worktree.

## Decisions

- Use an explicit reviewed launch-market list rather than an income lookup or
  runtime fraud dependency.
- Keep the existing environment override so operators can narrow or expand the
  policy without code changes.

## Verification

- Commands to run: focused hosted-onboarding Vitest, `pnpm test:diff` for all
  touched files, `pnpm verify:acceptance`, exact-head GitHub checks,
  preliminary and final ReviewGPT.
- Expected outcomes: representative international defaults are admitted by the
  existing prefix owner, explicit overrides still replace the default, invalid
  prefixes fail closed, and all required gates pass.
