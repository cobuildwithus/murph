# Open the existing privacy policy from Records

Status: active
Created: 2026-10-18
Updated: 2026-10-18

## Outcome and scope

Patch: a member expands Manage under a Records source and opens the existing public privacy policy. Correct the href from `/privacy` to `/legal/privacy`. Reuse the current Next Link and policy owner; add no route, state, request, dependency, redirect or import behavior.

## Evidence and protected behavior

The old destination returns 404; the existing legal destination returns 200. The new real RecordsPageClient regression fails on the original source and passes after the correction. Provider authorization, consent, imports, disconnect and data controls keep their existing owners and behavior.

## Tasks and verification

- Completed: scoped link correction; 28 Records client tests, 10 changelog rendering tests, and two browser journeys at 390/1280 pixels pass. Both browser journeys follow the real link and see the policy heading.
- Completed: Web typecheck and complexity guard pass; no changed hotspot exceeds 20. Parent inspected the entire patch and public-safe changelog.
- Pending: reviewer-openable branch proof, final ReviewGPT on pushed candidate concurrent with required CI, ordinary merge and managed Web deployment.
- Pending: verify serving revision and public policy navigation, then observe the owned deployment for four hours using the existing native heartbeat. The separate startup telemetry observation retains its original deadline.

## Decisions

This is an independent public-navigation correction. It does not change device/provider imports or claim to resolve runtime allocation failures. Production source is one href change, qualifying for the task's tiny direct-fix exception. Final ReviewGPT remains explicitly required by the task. No deployment compatibility boundary changes; managed Web admission is the deployment path.
