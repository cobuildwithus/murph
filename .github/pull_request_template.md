## Why and outcome

<!-- State the need and the result in one or two short paragraphs. -->

## Product UX

<!-- Follow agent-docs/operations/product-ux.md for user-facing work. Keep this proportional. -->

- Effort: <!-- Patch, Product change, Feature, or Not applicable — reason -->
- Result: <!-- Ready, Hold, or Not applicable -->
- Walkthrough: <!-- Affected people, material exclusions, and any difference from the approved plan -->

## Evidence

<!-- List direct journey proof and focused checks. Every user-facing UI change must embed at least one screenshot here. Name the states and viewports checked, and add phone and desktop screenshots when responsive behavior can differ. -->

- Direct: <!-- Real path, channel output, provider-shaped scenario, trace, test, or rendered state -->
- Coverage: <!-- Why this evidence covers the changed claim -->

## Risks (only when relevant)

<!-- Delete this section when no special risk applies. Include only affected invariants, hidden owners, architecture choices, hot-path calls, database fanout, provider-input measurements, or deferred work. -->

<!-- Add the next two lines only before a final ReviewGPT gate. Missing or invalid sensitivity defaults safely to a full review packet. -->
<!-- ReviewGPT context sensitivity: routine OR sensitive -->
<!-- Classification reason: ... -->

## Deployment concerns

<!-- Keep this section in every PR. Select exactly one disposition. For an applicable deploy boundary, complete every deployment detail and remove Reason. Otherwise remove the deployment-detail bullets and explain why deployment concerns do not apply. -->

- Deployment: <!-- applicable OR not applicable -->
- Supported skew: <!-- Required when applicable -->
- Safe order: <!-- Required when applicable -->
- Rollback floor: <!-- Required when applicable -->
- Expected exposure: <!-- Required when applicable -->
- Reversibility: <!-- Required when applicable -->
- Convergence proof: <!-- Required when applicable -->
- Post-deploy checks: <!-- Required when applicable -->
- Reason: <!-- Required only when not applicable -->

## Changelog

<!-- Use `$write-changelog` for member-visible features and improvements. Choose exactly one disposition. -->

- Changelog: <!-- updated OR not applicable -->
- Items: <!-- 2026-08-09 · stable-item-id; remove when not applicable -->
- Reason: <!-- Required only when not applicable; remove when updated -->
