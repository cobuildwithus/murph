# app-verify-speedup

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Reduce `pnpm test:apps` wall clock by removing duplicate hosted-web verification work that does not add distinct proof.

## Success criteria

- `apps/web verify` no longer pays for a standalone TypeScript check immediately before `next build` repeats its own TypeScript validation.
- `apps/web verify` overlaps any remaining safe setup work locally instead of keeping it serial by default.
- The hosted-web smoke helper avoids obvious duplicate requests.
- Verification docs match the new app-lane behavior.
- `pnpm test:apps` still passes after the change.

## Scope

- In scope:
  - `apps/web/scripts/verify-fast.sh`
  - `apps/web/scripts/dev-smoke.ts`
  - `agent-docs/operations/verification-and-runtime.md`
  - benchmark and verify `pnpm test:apps`
- Out of scope:
  - weakening the production-build or dev-smoke proof surfaces
  - broader Next.js build optimization or test-bucket redesign

## Constraints

- Preserve unrelated in-flight worktree edits.
- Keep the lane limited to repo-internal verification tooling plus the durable verification doc.
- Do not remove proof that the hosted web app can both boot in dev and build in production.

## Risks and mitigations

1. Risk: Removing the standalone `tsc` pass could let a web-only type error slip if `next build` does not cover the same surface.
   Mitigation: Keep `next build` in the verify lane and re-run `pnpm test:apps`.
2. Risk: Moving lint into the parallel block could hide failures behind slower steps.
   Mitigation: Keep the existing background-job failure handling and remeasure the lane to confirm the tradeoff is worth it.

## Tasks

1. Patch the hosted-web verify wrapper to remove the duplicate standalone typecheck and overlap lint with the existing local parallel section.
2. Drop the redundant extra `GET /` from the hosted-web dev smoke helper.
3. Update the durable verification doc to describe the new verify sequencing.
4. Re-run `pnpm test:apps` and compare timing to the prior baseline.
5. Commit the scoped tooling/docs changes if verification passes.

## Decisions

- Keep `next build` and `pnpm dev:smoke`; they prove different hosted-web runtime modes.
- Treat the standalone pre-build TypeScript pass as the clearest duplicate because `next build` already performs its own TS validation.

## Verification

- Required commands:
  - `bash -n apps/web/scripts/verify-fast.sh`
  - `pnpm test:apps`
- Supporting measurement:
  - `/usr/bin/time -p pnpm --dir apps/web verify`
Completed: 2026-04-09
