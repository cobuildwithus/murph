# Cloudflare Hosted E2E CI Lane

## Goal

Add one narrow CI lane that runs the highest-signal local Cloudflare hosted E2E coverage for first-contact welcome delivery without expanding the default repo acceptance gate to the full local E2E bundle.

## Why

- The current `apps/cloudflare` verify lane covers typecheck, fast Node tests, and Workers-runtime tests, but not the hosted local E2E lane.
- The first-contact welcome flow is a real hosted delivery seam worth protecting in CI.
- The full `test:e2e:local` lane is heavier than we want in the broad repo gate.

## Scope

- Add a focused Cloudflare package script for the first-contact local E2E test.
- Add a dedicated GitHub Actions workflow to run that test on relevant pull requests and manual dispatch.
- Update the verification docs to describe the new lane accurately.

## Constraints

- Keep the change isolated to CI/tooling/docs files.
- Do not touch active hosted runtime implementation files already owned by other in-progress rows.
- Keep the lane simple and truthful: one targeted E2E test, not the whole serial E2E bundle.

## Verification Plan

- `pnpm typecheck`
- Focused Cloudflare E2E command for the new lane

## Files

- `.github/workflows/cloudflare-hosted-e2e.yml`
- `apps/cloudflare/package.json`
- `agent-docs/references/testing-ci-map.md`
- `agent-docs/operations/verification-and-runtime.md`
