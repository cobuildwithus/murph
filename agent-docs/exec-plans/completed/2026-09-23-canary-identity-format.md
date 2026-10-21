# Accept formatting differences in canary identity questions

Status: completed
Created: 2026-09-23
Updated: 2026-09-23

## Goal

Make the production conversation canary accept equivalent identity-question formatting while continuing to prove onboarding progression and canonical goal save/readback.

## Scope and decisions

- The existing canary runner owns comparison and privacy-safe diagnostics. Reuse its complete-word comparison for acceptance and repeated-question rejection.
- Preserve word order, Unicode letters and numbers; tolerate case, whitespace and punctuation differences only.
- Preserve exact welcome copy, reply deadlines, fixed synthetic identity, canonical observations, and production credential boundaries.
- No application reply, prompt, API, state, workflow, or dependency changes. Internal proof correction; no member changelog or product UX change.

## Evidence and risks

The protected live run failed at turn two with the existing format-only diagnostic after receiving its reply. The old literal comparison rejects that category. Overbroad normalization could hide changed wording; cover additions, omissions, negation, non-ASCII substitutions, and repeated formatted identity questions through the real runner.

## Tasks

1. Correct identity comparison and add focused journey regressions.
2. Run canary tests, relevant typecheck/lint, complexity guard, and parent diff/privacy review.
3. Submit the scoped PR, complete exact-head CI, merge through protected checks, and verify the production canary.

## Verification

Passed: focused canary runner tests (44), hosted Web typecheck, focused ESLint, diff whitespace/privacy review, and complexity guard (maximum 16, no hotspots). The Web test wrapper also passed 853 tests. Implementation and parent review are complete; exact-head CI and protected production replay are tracked in the PR. Final ReviewGPT is not routed for this low-risk proof-only comparison change; no runtime or trust boundary changes.
Completed: 2026-09-23
