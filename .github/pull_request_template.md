## Why this PR exists

<!-- State the user or product need in one or two sentences. -->

## User goal / user-visible behavior

<!-- Describe the outcome this PR is meant to reach. -->

## User experience

<!-- Entry point, interaction and feedback states, failure/recovery, and what happens next. Write "No user-facing effect" when accurate. -->

## Invariants

<!-- List the smallest correctness, privacy, security, and operational invariants this PR must preserve. -->

## Non-obvious affected surfaces

<!-- Name each non-obvious production surface and its regression proof, or write "None". -->

## Hot reply path impact

<!-- The hot reply path runs from durable acceptance of a current conversation message through provider start and durable reply handoff. If this PR does not change that path, write "Not applicable" and say why. If it does, list every database call, network/provider call, or other awaited operation added or moved onto the path. Include call counts, serial/parallel ordering, timeout/retry/fallback behavior, expected or measured latency, and the proof used to compare before and after. -->

- Path status: <!-- Touched, or Not applicable — reason -->
- Database calls: <!-- Added or moved-on-path calls, or None -->
- Network/provider calls: <!-- Added or moved-on-path calls, or None -->
- Other awaited latency: <!-- Added or moved-on-path work, or None -->
- Before/after proof: <!-- Call-count test, trace, benchmark, or other focused evidence -->

## Design proof

<!-- Required for user-facing apps/web UI changes. Update /design?tab=components for reusable components or /design?tab=sections for full page sections. Embed hosted screenshots captured from that design-page state. -->

- Design page: <!-- /design?tab=components#... or /design?tab=sections#... -->
- Coverage: <!-- Component or section names added or updated -->
- Desktop screenshot: <!-- ![Desktop description](https://hosted-image-url) -->
- Mobile screenshot: <!-- ![Mobile description](https://hosted-image-url) -->

## Change-shape breakdown

Classification rule: <!-- Explain how paths were classified. Note any binary files. -->

| Category | Added | Deleted |
| --- | ---: | ---: |
| Source | 0 | 0 |
| Tests / fixtures | 0 | 0 |
| Docs | 0 | 0 |
| Config / tooling | 0 | 0 |
| Generated / other | 0 | 0 |
| **Total** | **0** | **0** |

## Verification

<!-- List exact commands and direct scenario evidence. -->
