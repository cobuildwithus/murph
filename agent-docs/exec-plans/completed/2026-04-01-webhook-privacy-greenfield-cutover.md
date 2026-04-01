## Goal

Land a hard greenfield cutover for hosted webhook privacy so the receipt/disptach pipeline only supports sparse reference payloads and no longer carries legacy inline-dispatch compatibility branches.

## Why

- The earlier privacy patch minimized stored payloads but kept migration/hydration compatibility for older receipt shapes.
- The user confirmed there is no stored data to preserve right now.
- That makes a full cutover safer and simpler than maintaining dual-path logic.

## Scope

- Remove inline hosted webhook dispatch payload support from receipt types, codec, store, transitions, and hydration helpers.
- Store sparse reference payloads from dispatch-side-effect creation time instead of minimizing only after queueing/sending.
- Update focused tests that still assume inline dispatch payloads or mixed legacy support.
- Keep device webhook trace and hosted Stripe payload minimization intact unless the cutover reveals a simpler equivalent.

## Constraints

- Preserve unrelated dirty-tree edits in active hosted onboarding files.
- Do not broaden the cutover into unrelated hosted onboarding privacy work already in flight.
- Verification must include typecheck plus focused hosted-web webhook/hydration tests; repo-wide failures outside this lane may remain and must be called out clearly.

## Plan

1. Trace the hosted webhook dispatch lifecycle and identify every inline-dispatch compatibility branch.
2. Convert the dispatch-side-effect payload model to reference-only creation-time storage and simplify the store/codec/hydration helpers around that invariant.
3. Update focused tests to match the new cutover semantics and add any missing proof for hydration/replay paths.
4. Run required verification, perform a local review, close the plan, and commit only the cutover paths.
Status: completed
Updated: 2026-04-01
Completed: 2026-04-01
