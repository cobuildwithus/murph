# Preserve worker results at verifier exit

Status: active
Created: 2026-10-05
Updated: 2026-10-05

## Goal

The package coverage scheduler honors a completion status published while it
observes worker exit, while retaining failure for nonzero or absent results.

## Success criteria

- Deterministically reproduce the race through the actual shell owner.
- Have ReviewGPT author the smallest correction and focused regression.
- Prove successful, nonzero, and missing-status outcomes plus existing interlock
  behavior; pass scoped checks, parent review, final review, and required CI.
- Leave this independent internal functional fix for human merge.

## Scope

- In scope: worker-status observation, its existing shell harness, owner docs,
  and the required public-safe Frog entry.
- Out of scope: production apps, concurrency limits, retry/timeout changes,
  dependencies, status suppression, unrelated PRs, and production deployment.

## Risks and mitigations

1. A result recheck could accidentally accept a truly missing result.
   Mitigation: deterministic late-status, nonzero, and absent-status cases.
2. Timing-dependent tests could hide the mechanism.
   Mitigation: synchronize the exact observation interleaving with owned files
   and children rather than relying on sleeps to trigger a race.

## Tasks

1. Verify source and competing ownership; reproduce the interleaving.
2. Review the external patch and run focused and scoped verifier checks.
3. Publish a scoped PR, complete review/CI, and record the remaining human merge.

## Decisions

- The observed CI failure is consistent with this proven race, but its exact
  interleaving was not recorded. Do not claim certainty about that CI instance.
- The synthetic original returns failure with all workers successful; a status
  recheck at the observation boundary preserves success without new waits.
- Product UX and changelog: internal verification only; no member behavior.

## Verification

- Original actual-function reproduction: exit one; recheck experiment: exit zero.
- Existing isolated interlock test passes, demonstrating that an ordinary run
  alone does not exercise the race. Deterministic regression is required.
- ReviewGPT authored the exact checksum-verified one-condition correction,
  four actual-function regression cases, and the verification-owner note.
- Before correction, all four new cases fail: successful work reports failure,
  and failure controls acquire false or duplicate package labels. Afterward all
  51 tests in the existing verifier suite pass, including both interlock owners.
- Parent review confirms no new wait, retry, concurrency change or failure
  suppression; the existing result path handles status published during exit.
- Shell syntax, repo-tools typecheck, whitespace, complexity and docs checks
  pass; final ReviewGPT and exact-head CI remain pending.
