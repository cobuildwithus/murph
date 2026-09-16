# Improve provider discovery and verify Epic automatic distribution

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Goal

- Make hospital discovery recognizable and responsive, and use verified Epic registration metadata to maximize automatic patient access.

## Success criteria

- Search updates while typing without stale results, duplicate authorization, or focus loss.
- Provider rows show locally served official logos where obtainable, with an accessible fallback.
- Desktop and phone presentation, keyboard operation, loading, empty, and retry states are verified.
- Epic default admission matches its USCDI-v3 registration metadata, with focused tests and typecheck passing.

## Scope

- In scope: connect-page presentation, autocomplete, static provider branding, outside-note eligibility evidence, and a separate live-verification handoff.
- Out of scope: changes to OAuth authority, consent, hospital endpoints, or canonical import ownership.

## Constraints

- Reuse the current provider-search and connection APIs. Keep searches bounded and ignore superseded responses.
- Serve branding locally; do not disclose hospital searches to third-party logo services at runtime.
- Preserve patient consent, PKCE, current authority checks, and frozen retrieval plans.
- Keep private browser/account evidence out of repository artifacts.

## Risks and mitigations

1. Older autocomplete responses could replace a newer query. Invalidate requests on every input change and disable obsolete choices immediately.
2. Provider logos may be absent or ambiguous. Match official provider identifiers and retain a neutral initial fallback rather than inventing a mark.
3. Public API catalog classification differs from registration eligibility. Record the portal's explicit USCDI-v3 metadata and retain the published appendix evidence.

## Tasks

1. Inspect official branding sources and registration metadata.
2. Implement bounded autocomplete and compact branded provider rows using the existing design system.
3. Update the production-component study and focused interaction tests.
4. Verify rendering, accessibility, typecheck, scoped lint, and policy regressions; review and ship a scoped PR.
5. Carry sandbox and real-account verification forward in the separate active Epic import verification plan.

## Decisions

- Product UX: product change. A member finds their hospital by name or location, recognizes it, and deliberately opens its patient portal.
- Affected journeys: pointer and keyboard search; phone and desktop; quick query changes; missing logo; empty, slow, or failed search; failed authorization start.
- Physical scene: a member at home, checking their records on a phone or laptop, needs a calm and recognizable provider choice.
- Use the existing warm paper palette, restrained sage actions, compact rows, and a clear search field. No new visual assets need generation.
- Portal metadata explicitly permits outside clinical notes under USCDI v3 and excludes advance directives; public catalog IsUSCDI alone is insufficient.

## Verification

- Focused clinical-records page and policy tests, web typecheck, scoped ESLint, complexity diff, and docs checks.
- Render real production components in the design study at phone and desktop widths; replay autocomplete races and selection on the actual component.
- Live import proof remains a separate outcome from a passing UI study or merged PR.

## Progress and evidence

- All 1,245 real directory providers have a locally served official mark; the sandbox and unknown providers retain initials. Every manifest path resolves and matches its content hash.
- The production search component uses debouncing, cancellation, generation checks, stable focus, and native result buttons. Keyboard arrows, phone/desktop layout, and image loading passed real-browser proof at 390 and 1280 pixels.
- 241 clinical-records tests passed; 10 database tests were skipped in this run. Web typecheck and scoped source lint passed. Complexity debt remains zero, with no changed function above 20.
- Portal metadata verifies 44 automatically distributed APIs and 25 retrieval queries. Outside-record clinical notes are eligible; advance directives remain excluded.
- Live production-client authorization did not succeed. Registration activation and real canonical import readback remain a separate launch requirement, not a result established by the UI tests.
- Draft PR: https://github.com/cobuildwithus/murph/pull/3497. Final review, exact-head CI, and a current branch preview are pending.

- The hosted preview is ready and returns the actual provider-search study. CI found four consent-flow assertions still expecting the previous heading; those assertions now match the new heading, and all 10 composed consent tests pass.
- Final review packaging exceeded the child output buffer with expected exclusion warnings. The wrapper now summarizes those warnings, preserves other diagnostics and exit status, and keeps all artifact/privacy guards.

## Completion review

- ReviewGPT round 1 passed on `155e6d97208f1e33950d305e7ae97f8ff3251627`, with no qualifying findings. GPT-6 Pro selection and response-model metadata agree; the exact response hash matches capture metadata, the complete artifact/target identity was checked, and capture exceeded the 180-second minimum (approximately seven minutes).
- The parent reviewed request cancellation, consent and single-use intent recovery, local branding provenance, default API admission, and packaging error propagation. The reviewer did not rerun tests or inspect excluded binary logos; local tests and rendered browser evidence cover those boundaries.
- The deployed study returns HTTP 200. Browser readback confirms the actual component, loaded same-origin logos, and no horizontal overflow. All 10 composed consent tests and review package format guards pass; the corrected full archive builds successfully and Web typecheck passes.
- This closes implementation and review of provider discovery and eligibility. Final exact-head CI and merge remain release gates. The broader live-import outcome remains open in `agent-docs/exec-plans/active/2026-09-16-epic-import-live-verification.md`; no successful real authorization or imported lab result is claimed.
Completed: 2026-09-15
