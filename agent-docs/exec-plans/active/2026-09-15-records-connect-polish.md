# Improve provider discovery and verify Epic automatic distribution

Status: active
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

- In scope: connect-page presentation, autocomplete, static provider branding, outside-note eligibility evidence, and live import verification.
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
5. Continue sandbox and real-account import verification through canonical readback.

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
