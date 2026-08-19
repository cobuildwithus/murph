## Why and outcome

<!-- State the need and the result in one or two short paragraphs. -->

## Product UX

<!-- Follow agent-docs/operations/product-ux.md for user-facing work. Keep this proportional. -->

- Effort: <!-- Patch, Product change, Feature, or Not applicable — reason -->
- Result: <!-- Ready, Hold, or Not applicable -->
- Walkthrough: <!-- Affected people, material exclusions, and any difference from the approved plan -->

## Evidence

<!-- List direct journey proof and focused checks. For frontend work, name the states and viewports checked. Link screenshots only when they add proof. -->

- Direct: <!-- Real path, channel output, provider-shaped scenario, trace, test, or rendered state -->
- Coverage: <!-- Why this evidence covers the changed claim -->

## Non-obvious affected surfaces

<!-- Name each non-obvious production surface and its regression proof, or write "None". -->

## Architecture and reuse

<!-- Keep this concrete and specific to the final diff. If an item is "none," explain why the existing design is sufficient. -->

- Existing systems reused: <!-- Frameworks, owners, stores, workflows, or primitives this change builds on -->
- New logic: <!-- New product, business, scheduling, validation, or failure-handling behavior -->
- New abstractions: <!-- New shared types, helpers, services, state owners, or "None; ..." with a reason -->
- Complexity intentionally avoided: <!-- Tables, queues, services, compatibility layers, or other machinery deliberately not added -->

## Hot reply path impact

<!-- The hot reply path runs from durable acceptance of a current conversation message through provider start and durable reply handoff. If this PR does not change that path, write "Not applicable" and say why. If it does, list every database call, network/provider call, or other awaited operation added or moved onto the path. Include maximum call counts, serial/parallel ordering, timeout/retry/fallback behavior, expected or measured latency, and before/after proof. -->

- Path status: <!-- Touched, or Not applicable — reason -->
- Database calls: <!-- Added or moved-on-path calls, or None -->
- Network/provider calls: <!-- Added or moved-on-path calls, or None -->
- Other awaited latency: <!-- Added or moved-on-path work, or None -->
- Before/after proof: <!-- Call-count test, trace, benchmark, or other focused evidence -->

## Murph initial provider input impact

<!-- Report the complete first provider-visible input assembled by Murph and Codex for representative individual and group turns. Include final instructions/messages, eager tool definitions and schemas, deferred-tool metadata, and generated tool or code-mode guidance. Use identical base/head fixtures and the target model tokenizer; serialize the same provider-visible fields for byte counts. If no provider-input surface changed, write "Not applicable" and name the reason instead of claiming a measured zero. -->

| Runtime | Base input tokens | Head input tokens | Delta | Percent | Base bytes | Head bytes | Byte delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Individual Murph | <!-- count, or Not applicable --> | <!-- count, or Not applicable --> | <!-- signed count, or Not applicable --> | <!-- signed percent, or Not applicable --> | <!-- count, or Not applicable --> | <!-- count, or Not applicable --> | <!-- signed count, or Not applicable --> |
| Group Murph | <!-- count, or Not applicable --> | <!-- count, or Not applicable --> | <!-- signed count, or Not applicable --> | <!-- signed percent, or Not applicable --> | <!-- count, or Not applicable --> | <!-- count, or Not applicable --> | <!-- signed count, or Not applicable --> |

- Assembled instructions: <!-- Base/head characters or tokens for individual and group, plus changed files/builders/layers; or Unchanged -->
- Tool/schema/generated guidance: <!-- Base/head tokens or bytes for individual and group, naming eager/deferred changes; or Unchanged -->
- Other provider-visible input: <!-- Base/head tokens or bytes for any changed wrapper/history/fixture content; or Unchanged -->
- Measurement method: <!-- Base/head refs, model and tokenizer/version, identical fixtures, command or capture method, included fields, and any exclusions; or Not run — no provider-input surface changed -->

## Design proof

<!-- Required for user-facing apps/web UI changes; remove for other PRs. Represent reusable components on /design?tab=components, consent surfaces on /design?tab=consent, or composed sections on /design?tab=sections. Choose evidence for the actual visual, state, interaction, and responsive risks; there is no screenshot quota. -->

- Design page: <!-- /design?tab=components#..., /design?tab=consent#..., or /design?tab=sections#... -->
- Evidence: <!-- Links, images, browser walkthrough, or a clear reason why an image adds no proof -->
- Coverage: <!-- States and viewports checked, plus why this evidence is sufficient -->

## Risks (only when relevant)

<!-- Delete this section when no special risk applies. Include only affected invariants, database fanout, or deliberately deferred work not already covered above. -->

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

## Change-shape breakdown

<!-- Classify base-to-head added/deleted lines by primary purpose. Note binary files and keep generated output separate from authored source. Raw LOC is reviewer orientation and a scope-anomaly signal, not a quality target. -->

Classification rule: <!-- Explain how paths were classified and note any binary files. -->

| Category | Added | Deleted |
| --- | ---: | ---: |
| Source | 0 | 0 |
| Tests / fixtures | 0 | 0 |
| Docs | 0 | 0 |
| Config / tooling | 0 | 0 |
| Generated / other | 0 | 0 |
| **Total** | **0** | **0** |

## Changelog

<!-- Use `$write-changelog` for member-visible features and improvements. Choose exactly one disposition. -->

- Changelog: <!-- updated OR not applicable -->
- Items: <!-- 2026-08-09 · stable-item-id; remove when not applicable -->
- Reason: <!-- Required only when not applicable; remove when updated -->
