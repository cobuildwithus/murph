# Preserve structured provider failure diagnostics

## Outcome and invariant
Expose the structured provider error kind, presence, and valid HTTP status on existing failed-reply diagnostics so operators can distinguish a provider server error from transport failure. Preserve classification, retry, delivery, prompts, state, and log volume.

## Evidence and ownership
The Codex failure builder already creates these context fields. The automation failure sanitizer drops them before the existing hosted maintenance event prefixes and persists failure context. Existing classification tests distinguish structured internalServerError from text-only connection loss. No open PR diff addresses this diagnostic boundary.

## Design
Extend the current failure-context sanitizer only. Use a bounded known error-kind vocabulary with an explicit unrecognized value, a boolean presence field, and integer HTTP status 100–599. Reuse the existing prefixed event and pipeline. Add no network request, timer, state, dependency, recovery policy, or success-path log.

## Proof and workflow
- ReviewGPT authors the localized telemetry patch and synthetic regressions.
- Demonstrate the new composed regression fails on the base; verify it passes with the patch and that classification/retry fields are unchanged.
- Run affected focused tests, typecheck, complexity/privacy/docs checks; parent review.
- Scoped commit and draft PR; final ReviewGPT on the pushed candidate concurrent with required CI.
- Telemetry-only merge/deploy is authorized only after all gates; use canonical coordinated rollout and read-only natural traffic verification.

## Compatibility and product
Additive optional diagnostic fields; older producers omit them, existing generic consumers accept them. Missing evidence is distinct from false or unrecognized. No member-visible behavior or initial provider input changes. No changelog item is needed.

## Status
Implementation and parent review complete. ReviewGPT authored the production sanitizer and synthetic regressions; a focused parent assertion also exercises the existing structured-log sanitizer and request parser. The new regressions fail on the base (40 failures from missing fields), then pass with the patch. Focused engine classification/recovery/support tests pass (141); hosted maintenance tests pass (146). Package typechecks, complexity (no hotspots), raw-payload logging guard, docs drift, and gardening pass. Final pushed-head ReviewGPT, required CI, and any authorized deployment remain external completion gates; natural-traffic verification is pending.
Status: completed
Updated: 2026-10-09
Completed: 2026-10-09
