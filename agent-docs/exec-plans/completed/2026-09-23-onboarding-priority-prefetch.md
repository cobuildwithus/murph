# Preserve onboarding priority through prefetched invocations

Status: completed
Created: 2026-09-23
Updated: 2026-09-23

## Goal

Carry Web-owned first-day Priority expiry through production workspace prefetch
so eligible replies receive the requested tier at standard member pricing.

## Scope and constraints

Use the existing optional invocation request contract, parser and restore owner.
Preserve prefetched null and existing workspaces without another Web read.
Keep member environment overrides unable to set the expiry; no persisted state,
extra query, dependency, or change to the 24-hour tier policy.

## Evidence and decision

ReviewGPT round 1 on PR #3675 accepted finding: RuntimeInvocationPreparation
omits the expiry, while restore skips its Web read whenever request.workspace
exists. The direct-read startup test missed the production optimization.
Correction adds one optional metadata field across the existing wire boundary.
Old producers omit it and retain Standard; old consumers ignore it.

## Tasks

1. Carry the expiry through preparation, invocation parsing and restore.
2. Cover null, existing and absent-prefetch paths and absent authority.
3. Run focused tests, affected typechecks, complexity and docs guards.
4. Commit, publish refreshed evidence and rerun full ReviewGPT round 2.

## Verification

Focused proof passed: Cloudflare preparation/parser (28 tests), runtime startup
prefetch/direct-read (6 selected tests), Hosted Execution contracts (45 tests),
and engine expiry/eligibility (41 tests). Cloudflare, Assistant Runtime and
Hosted Execution typechecks passed. The producer serializes absent expiry as
an omitted optional JSON field without a conditional branch.
Existing native tests cover explicit tier reset. Exact-head CI and ReviewGPT
round 2 remain release gates after this scoped correction.
Completed: 2026-09-23
