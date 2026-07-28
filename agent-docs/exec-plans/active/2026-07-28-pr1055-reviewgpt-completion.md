# Complete PR 1055 review and verification

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Finish PR #1055 as a minimal, merge-ready change that makes managed proactive
  health messages supportive by default and lets activity-based experiments
  recognize explicitly accepted activity kinds without broadening unrelated
  activity semantics.

## Success criteria

- The PR contains only the intended contracts, query, assistant prompt, and
  focused proof changes; temporary repair workflows and unrelated workflow
  drift are absent.
- Weekly Insight, Weekly Digest, and Monthly Improvement Coach retain distinct
  roles and do not grade ordinary behavioral declines as user failure.
- The monthly coach reconciles in place through its stable managed automation
  identity, including legacy weekly tags and slugs at the reconciliation
  boundary only.
- Explicit activity evidence accepts one or multiple kinds plus an optional
  minimum duration, is owned by the protocol and its immutable run snapshot,
  preserves explicit single-kind targets, and uses one shared adherence
  interpretation across server and browser projections.
- Focused tests, typechecks, generated-artifact checks, `pnpm test:diff`, and
  `pnpm verify:acceptance` pass on the final task head.
- The preliminary ReviewGPT specialist pass applies the prompt, product, and
  coverage lenses with no unresolved accepted findings.
- Final ReviewGPT reaches `ROUND_OUTCOME: PASS` and `REVIEW_COMPLETE` on the
  exact PR-specific patch, all required final-head checks are green, and the PR
  is cleanly mergeable without being merged.

## Scope

- In scope:
  - Managed Weekly Health Insight, Weekly Health Digest, and Improvement Coach
    eligibility, role separation, tone, cadence, and migration behavior.
  - Protocol activity-session evidence contracts and read-time adherence
    interpretation for accepted kinds and minimum duration.
  - Existing generated contracts and focused regression proof.
  - PR cleanup, description, CI, ReviewGPT, and exact-head merge-readiness.
- Out of scope:
  - New personalization settings, persistence owners, schedulers, services, or
    global activity-category changes.
  - Frontend/UI work, historical event rewrites, production deployment, and
    merging PR #1055.

## Constraints

- Technical constraints:
  - Keep protocol activity evidence in the protocol contract and immutable run
    snapshot, with one interpretation shared by write hydration, server reads,
    and browser reads.
  - Preserve existing singular `activityKind` data and explicit custom targets.
  - Limit legacy Zone 2 repair to old generated evidence at the compatibility
    boundary.
  - Do not introduce dependencies, persistence, or speculative abstractions.
- Product/process constraints:
  - Preserve meaningful unfavorable physiological findings while suppressing
    generic shame, surveillance, grading, or unsupported behavioral inference.
  - Treat tracking contradictions as product/data uncertainty, not user
    failure.
  - Follow the preliminary specialist, coverage, CI, and final ReviewGPT gates
    on exact pushed heads.
  - Preserve unrelated working-tree and process state.

## Risks and mitigations

1. Risk: Positive framing could suppress medically useful unfavorable signals.
   Mitigation: Keep durable biomarker, lab, symptom, and physiological findings
   eligible when decision-relevant; raise the bar only for ordinary behavioral
   grading.
2. Risk: Compatibility logic could leak Zone 2 policy into generic adherence.
   Mitigation: Make protocol metadata the current owner, keep repair narrowly
   gated to recognized legacy generated targets, and leave explicit targets
   authoritative.
3. Risk: Schedule migration could duplicate or overwrite user automations.
   Mitigation: Retain the stable managed automation id, recognize legacy
   boundary identifiers, and cover occupied-slug and in-place migration cases.
4. Risk: Prior temporary workflows or stale tests could obscure real CI state.
   Mitigation: Delete PR-specific workflows, restore unrelated workflow content
   to current main, then reproduce failures with canonical local commands.

## Tasks

1. Inspect the complete production diff, test diff, generated artifacts, and
   current GitHub Actions failures against current `origin/main`.
2. Delete temporary PR workflows, restore unrelated workflow drift, and make
   the smallest owner-bound corrections for stale monthly migration tests,
   prompt expectations, and generated artifacts.
3. Run focused unit tests, typechecks, generation checks, and canonical
   diff-aware verification.
4. Run the exact-head preliminary ReviewGPT specialist pass; triage every
   finding against simplicity and owner boundaries.
5. Complete parent final review, close this plan with the scoped final commit,
   push, and update the PR contract.
6. Run final ReviewGPT round 1 concurrently with CI, remediate accepted
   findings with correction-only rounds as needed, and prove final-head checks
   plus mergeability.

## Decisions

- Use a dedicated existing task worktree; the primary checkout contains
  unrelated work.
- Treat the three PR-specific repair workflows as temporary machinery to
  delete, not product implementation.
- Treat protocol-declared `activitySessionEvidence` and its immutable snapshot
  as the source of truth; retain the Zone 2 key lookup only for saved runs that
  predate that snapshot field.
- The coordination ledger referenced by older task instructions is absent from
  current main and was intentionally removed; this active plan is the current
  durable coordination record.

## Verification

- Completed focused proof:
  - Query adherence and browser/server experiment projections: 189 tests
    passed.
  - Managed automations, cron runtime, and onboarding guidance: 236 tests
    passed.
  - Contracts: 221 tests passed; contract generation and generated-schema
    consistency passed.
  - Health Commons: 92 tests passed; catalog generation consistency passed.
  - CLI canonical command-tree hash: 2 tests passed after refreshing the
    generated hash.
  - Contracts, query, core, vault-usecases, assistant-engine, Health Commons,
    and CLI package typechecks passed.
  - `git diff --check` and the confidential-evidence/privacy scan passed.
- Remaining commands:
  - Prepared runtime build and full CLI generated-artifact confirmation.
  - `pnpm test:diff <final changed paths>`
  - `pnpm verify:acceptance`
  - Preliminary ReviewGPT specialist review.
  - Final ReviewGPT round(s), `gh pr checks 1055`, and non-mutating merge-tree
    proof against current `origin/main`.
- Expected outcomes:
  - All local checks and required PR checks pass.
  - ReviewGPT reports zero accepted findings and `REVIEW_COMPLETE`.
  - The final PR head contains no temporary workflow or audit artifact and is
    mergeable.
