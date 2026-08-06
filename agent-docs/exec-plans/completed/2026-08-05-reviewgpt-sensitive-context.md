# Risk-aware ReviewGPT context

## Outcome

Allow later ReviewGPT rounds to use a same-thread correction packet only when
the pull request is both small and explicitly routine. Re-send the full guarded
ZIP for every large or sensitive pull request, even when a sensitive diff is
small.

## Constraints

- Reuse the completion workflow's existing sensitive and cross-cutting review
  conditions instead of guessing risk from changed file paths.
- Keep the PR body as the durable reviewer-intent contract.
- Treat a missing, malformed, or duplicate context-sensitivity declaration as
  undeclared and fail safe to a full snapshot.
- Preserve the existing size cutoffs, explicit full-review override, thread
  reuse, immutable first-reviewed head, and substantive round numbering.
- Do not add a new service, state owner, dependency, or label workflow.

## Plan

1. Add one machine-readable PR-body context-sensitivity declaration.
2. Make the packager select a full snapshot for sensitive or undeclared PRs
   before applying the existing large-PR cutoff to routine PRs.
3. Record the parsed sensitivity in round metadata and align the prompt and
   durable workflow documentation.
4. Add focused integration coverage for routine, sensitive, undeclared, large,
   and explicit-override paths.
5. Run focused checks, inspect the final diff, close this plan, push the PR, and
   require clean mergeability plus green exact-head CI.

## Verification

- Focused CLI release-script coverage test.
- Relevant shell syntax checks.
- CLI package typecheck.
- Documentation drift check.
- Exact-head PR CI.

Status: completed
Updated: 2026-08-05
Completed: 2026-08-05
