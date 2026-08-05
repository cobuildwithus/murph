# Size-aware ReviewGPT context

## Outcome

Preserve inexpensive same-thread correction packets for small PRs while making
later substantive rounds on larger PRs start a fresh full-patch audit with a
new guarded repository snapshot.

## Constraints

- Choose from the full current PR shape, not only the latest correction diff.
- Keep the existing explicit full-review reason as an override.
- Keep first-reviewed-head lineage and round numbering immutable.
- Make the cutoff and the selected mode visible in packaged metadata.
- Do not add a new service, state owner, or dependency.

## Plan

1. Add one shared shell policy for the large-PR cutoff.
2. Use it in both ReviewGPT launch configuration and standalone packaging.
3. Align the review prompt and durable workflow documentation with full-audit
   versus correction-only semantics.
4. Add focused integration coverage for both sides of the cutoff and the
   explicit override.
5. Run focused tests and typecheck, inspect the final diff, and complete the
   required PR review and CI gates.

## Verification

- Focused CLI release-script coverage test.
- Relevant shell syntax checks.
- CLI package typecheck.
- Exact-head PR CI and required ReviewGPT stages.
