# Compact neutral mobile patterns and supporting evidence

## Outcome
Mobile cards prioritize measured changes. Neutral comparisons stay available behind a compact disclosure; factors with only neutral results use a condensed header. Coverage bars open a touch-accessible drawer, and association drawers identify the actual days supporting each average.

## Scope and invariants
Reuse the existing Personal Patterns report, native disclosure behavior, coverage meter, and shared drawer content. Preserve desktop hover, sorting, result calculations, neutral detail access, and omission of insufficient mobile comparisons. No new persisted state or dependencies.

## Product UX
- Outcome: Reduce neutral-result clutter while making supporting evidence available on touch devices.
- Reaches: Mixed and neutral-only mobile cards, coverage controls, single and composite result drawers; desktop remains usable.
- Proof: Synthetic production-component browser checks at 320/390 and desktop sizes, touch and keyboard disclosure, drawer dismissal/focus, sample counts, no horizontal overflow, screenshots, focused Web tests and typecheck.

## Result
Ready. Neutral-only cards collapse to a compact header; mixed-card footers reveal aligned comparison controls on touch or keyboard input. Coverage uses the existing drawer on phones and the existing tooltip on desktop. Each mobile comparison average shows its own sample size; composite sleep samples remain separate.

## Verification
- Focused Web and changelog tests: 48 passed.
- Web typecheck passed.
- Existing Patterns browser scenario passed in Chromium and WebKit with touch enabled, including coverage drawers, disclosure keyboard/touch behavior, neutral details, focus restoration, single and composite sample sizes, 320/390 mobile geometry, 640/1440 desktop hover, and no overflow.
- Inspected synthetic screenshots of compact neutral cards, collapsed and expanded mixed cards, coverage, and single/composite drawers. Opened selected screenshots in Preview.
- Docs drift, diff checks, and complexity guard passed; debt remained zero, maximum complexity remained 20.
- No report math, persistence, backend, or dependency changes. Local candidate saved for product review; no new deployment in this iteration.

Status: completed
Updated: 2026-09-06
Completed: 2026-09-06
