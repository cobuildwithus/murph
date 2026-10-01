# Bound large ReviewGPT archive listings

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal and scope

Allow guarded ReviewGPT ZIP listings above Node's default subprocess buffer to
complete through the existing privacy and repomix owners. Extend the existing
registry dependency patch in source and emitted JavaScript; retain its capture
identity protections. No browser, runtime, credential policy, or dependency
version changes are part of the fix. Dependency changes require human merge.

## Cause and decisions

- The public `runReviewGpt` dry-run API fails before privacy classification with
  truncated ZIP paths. A synthetic 1,432,012-byte listing independently produces
  `ENOBUFS` at the default buffer, while the bounded 64 MiB call reads its tail.
- Add the same 64 MiB maximum to both existing listing calls in source and dist.
  Keep failure handling and complete-list privacy classification unchanged.
- Use public `pnpm patch-commit` and retain the prior patch. Inspect its generated
  lockfile peer-key normalization separately from the three patch-hash changes.
- Reuse Frog #2799 for this cause and #2685/#2755 for generated peer-key churn.
  This tooling-only outcome needs no member changelog or product UX replay.

## Verification and completion

- Actual installed public API: oversized safe archive reaches repomix with its
  late source marker; a synthetic dotenv entry after the old limit is rejected.
  Both regressions fail before the patch and pass afterward; six existing
  capture-identity tests continue to pass.
- Frozen install, dependency policy, focused TypeScript 7, docs drift, and complexity
  checks pass. Non-patch whitespace passes; the generated patch has one required
  blank context record flagged by the plain whitespace check. Complexity excludes tests and vendor patch text;
  manual inspection confirms four constant options and no new branches.
- Dependency audit remains failing: 93 advisories (7 low, 43 moderate, 42 high,
  1 critical), with no package version or integrity changes. Install-script
  approvals and exclusions remain unchanged; blocked builds were reviewed.
- Finish with a scoped commit, complete draft PR, full canonical review and exact
  required CI. Preserve the checkout and open issue for human merge handoff.
Completed: 2026-09-05
