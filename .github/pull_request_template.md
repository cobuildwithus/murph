## Why this PR exists

<!-- State the user or product need in one or two sentences. -->

## User goal / user-visible behavior

<!-- Describe the outcome this PR is meant to reach. -->

## Product UX

<!-- Use agent-docs/operations/product-ux.md for any user-facing change. Keep this proportional. A Patch can use Outcome / Reaches / Proof. A Feature includes the approved plan and its material exclusions. -->

- Effort: <!-- Patch, Product change, Feature, or Not applicable — reason -->
- Plan: <!-- Outcome, entry and promise, affected people, proof path, weak states, UX finish, and done-when decisions; link an approved plan when one exists -->
- Walkthroughs and evidence: <!-- What each affected person saw, read, understood, did, published, revealed, and received at the last boundary that defines the promise -->
- Result: <!-- Ready, Hold, or Not applicable -->

## Invariants

<!-- List the smallest correctness, privacy, security, and operational invariants this PR must preserve. -->

## Changelog

<!-- Use `$write-changelog` for member-visible features and improvements. Choose exactly one disposition. For `updated`, name the edition date and stable item IDs. For `not applicable`, explain concretely why no member-visible behavior changed. -->

- Changelog: <!-- updated OR not applicable -->
- Items: <!-- 2026-08-09 · stable-item-id; remove this bullet when not applicable -->
- Reason: <!-- Required only when not applicable; remove this bullet when updated -->

## ReviewGPT later-round context

<!-- Replace the placeholder below with exactly `routine` or `sensitive`. Use `sensitive` for any product-critical flow; auth, privacy, security, billing, health-safety, persisted-state, public API, runtime/deploy, ordering/retry/concurrency/idempotency, broad refactor, cross-owner, external-boundary, or other cross-cutting change. A cosmetic change or small bug fix is `routine` only when none of those conditions apply. Missing, malformed, or duplicate declarations default later ReviewGPT rounds to a full ZIP. -->

ReviewGPT context sensitivity: <!-- routine OR sensitive -->

- Classification reason: <!-- Briefly explain why this PR is routine or sensitive. -->

## Non-obvious affected surfaces

<!-- Name each non-obvious production surface and its regression proof, or write "None". -->

## Architecture and reuse

<!-- Keep this concrete and specific to the final diff. If an item is "none," explain why the existing design is sufficient. -->

- Existing systems reused: <!-- Frameworks, owners, stores, workflows, or primitives this change builds on -->
- New logic: <!-- New product, business, scheduling, validation, or failure-handling behavior -->
- New abstractions: <!-- New shared types, helpers, services, state owners, or "None; ..." with a reason -->
- Complexity intentionally avoided: <!-- Tables, queues, services, compatibility layers, or other machinery deliberately not added -->

## Hot reply path impact

<!-- The hot reply path runs from durable acceptance of a current conversation message through provider start and durable reply handoff. If this PR does not change that path, write "Not applicable" and say why. If it does, list every database call, network/provider call, or other awaited operation added or moved onto the path. Include call counts, serial/parallel ordering, timeout/retry/fallback behavior, expected or measured latency, and the proof used to compare before and after. -->

- Path status: <!-- Touched, or Not applicable — reason -->
- Database calls: <!-- Added or moved-on-path calls, or None -->
- Network/provider calls: <!-- Added or moved-on-path calls, or None -->
- Other awaited latency: <!-- Added or moved-on-path work, or None -->
- Before/after proof: <!-- Call-count test, trace, benchmark, or other focused evidence -->

## Murph initial provider input impact

<!-- Report the complete first provider-visible input assembled by Murph and Codex for representative individual and group turns. Include final instructions/messages, eager tool definitions and schemas, deferred-tool metadata, and Codex-generated tool or code-mode guidance. Do not report only authored system-prompt text. Use identical base/head fixtures and the target model tokenizer; serialize the same provider-visible fields for byte counts. If no provider-input surface changed, write "Not applicable" and name the reason instead of claiming a measured zero. -->

| Runtime | Base input tokens | Head input tokens | Delta | Percent | Base bytes | Head bytes | Byte delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Individual Murph | <!-- count, or Not applicable --> | <!-- count, or Not applicable --> | <!-- signed count, or Not applicable --> | <!-- signed percent, or Not applicable --> | <!-- count, or Not applicable --> | <!-- count, or Not applicable --> | <!-- signed count, or Not applicable --> |
| Group Murph | <!-- count, or Not applicable --> | <!-- count, or Not applicable --> | <!-- signed count, or Not applicable --> | <!-- signed percent, or Not applicable --> | <!-- count, or Not applicable --> | <!-- count, or Not applicable --> | <!-- signed count, or Not applicable --> |

- Assembled instructions: <!-- Base/head characters or tokens for individual and group, plus changed files/builders/layers; or Unchanged -->
- Tool/schema/generated guidance: <!-- Base/head tokens or bytes for individual and group, naming eager/deferred changes; or Unchanged -->
- Other provider-visible input: <!-- Base/head tokens or bytes for any changed wrapper/history/fixture content; or Unchanged -->
- Measurement method: <!-- Base/head refs, model and tokenizer/version, identical fixtures, command or capture method, included fields, and any exclusions; or Not run — no provider-input surface changed -->

## Design proof

<!-- Required for user-facing apps/web UI changes. Update /design?tab=components for reusable components or /design?tab=sections for full page sections. Choose evidence for the actual visual, state, interaction, and responsive risks. A change can need no screenshots, one screenshot, or many. -->

- Design page: <!-- /design?tab=components#... or /design?tab=sections#... -->
- Evidence: <!-- Links, images, browser walkthrough, or a clear reason why an image adds no proof -->
- Coverage: <!-- States and viewports checked, plus why this evidence is sufficient -->

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
