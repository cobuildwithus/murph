# Size-aware ReviewGPT context

## Outcome

Preserve inexpensive same-thread correction packets for small PRs while making
later substantive rounds on larger PRs re-send a new guarded repository
snapshot and run a fresh full-patch audit in the existing conversation.

## Constraints

- Choose from the full current PR shape, not only the latest correction diff.
- Keep the existing explicit full-review reason as an override.
- Keep first-reviewed-head lineage and round numbering immutable.
- Make the cutoff and the selected mode visible in packaged metadata.
- Do not add a new service, state owner, or dependency.

## Plan

1. Add one packager-owned shell policy for the large-PR cutoff.
2. Make the later-round prompt obey the packaged scope instead of selecting it
   independently.
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

## Review findings

- Accepted: a later full-audit conversation must treat a missing or unusable
  prior-finding summary as invalid so an unresolved accepted finding cannot
  disappear with the earlier thread.
- Accepted: eliminate split prompt/package selection. The packager owns one
  head-bound PR-shape decision, fails closed if the head changes while it is
  packaging, and writes the mode that the same-thread follow-up prompt obeys.
