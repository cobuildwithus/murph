# PR 319 ReviewGPT Fixes

## Goal

Address accepted ReviewGPT findings for PR 319 before merge.

## Scope

- Keep signup welcome delivery compatible across independently deployed web/runtime versions.
- Remove user-facing message test inspection APIs from public package exports.
- Document narrow automatic-send exceptions for Linq daily quota and home-thread redirects.

## Constraints

- Preserve deterministic copy variants for allowed surfaces.
- Preserve existing idempotency keys and delivery call sites.
- Avoid broad classifiers or feature-flag infrastructure.

## Verification

- Focused contracts, web onboarding, usage allowance, and assistant-runtime tests.
- `pnpm test:diff` for touched files.
- `pnpm typecheck`.

Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
