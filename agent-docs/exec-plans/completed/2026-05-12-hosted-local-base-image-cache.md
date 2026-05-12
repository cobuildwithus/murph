# Hosted-local base image cache

Status: completed
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Make hosted-local E2E skip native runner base-image rebuilds by default when the local prepared image is current.

## Success criteria

- `pnpm hosted-local e2e <scenario>` prepares the Docker base image only when the tagged local image is missing or stale.
- A force-refresh escape hatch exists for local debugging.
- Existing fail-closed behavior remains when a caller explicitly skips base prep but the image is missing.
- Focused tests cover cache hit, cache miss, and force-refresh behavior.

## Scope

- In scope:
  - Hosted-local E2E harness base-image preparation logic.
  - Existing Cloudflare dev-worker image constants when needed to avoid duplicate tags.
  - Focused harness/unit tests and minimal docs.
- Out of scope:
  - Runner bundle caching.
  - Hosted runtime behavior changes.
  - Production deploy workflow changes.

## Constraints

- Keep the implementation simple and composable; prefer one shared image tag/source of truth over new state files.
- Do not expose local paths, account usernames, secrets, raw auth headers, or direct personal identifiers in docs, logs, commits, or examples.
- Preserve unrelated dirty hosted-runner and Murph Age worktree edits.

## Risks and mitigations

1. Risk:
   A stale native base image could hide Dockerfile changes.
   Mitigation:
   Use a deterministic source fingerprint label and rebuild when it differs.
2. Risk:
   Cache validation could add brittle Docker parsing.
   Mitigation:
   Use `docker image inspect --format` for one label only and treat missing/mismatched output as rebuild.

## Tasks

1. Add cache validation and force-refresh input to hosted-local E2E base prep.
2. Reuse the Cloudflare dev-worker base-image tag source of truth.
3. Add focused tests for default skip/build decisions.
4. Run focused verification and required completion checks.

## Decisions

- Default behavior should be cache-aware, not controlled by an opt-in skip flag.
- A missing or mismatched fingerprint should rebuild automatically.

## Verification

- Commands to run:
  - focused hosted-local harness tests
  - `pnpm typecheck` or scoped equivalent required by the verification doc
- Results:
  - PASS: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-base-image.test.ts apps/cloudflare/test/dev-worker.test.ts apps/cloudflare/test/container-image-contract.test.ts apps/cloudflare/test/run-hosted-local-e2e-runner.test.ts`
  - PASS: initial `pnpm typecheck`
  - BLOCKED after unrelated concurrent hosted-runner edits: final `pnpm typecheck` fails in `apps/cloudflare/test/user-runner-alarm.test.ts` on `active_generation`.
  - BLOCKED by same active hosted-runner area: scoped `bash scripts/workspace-verify.sh test:diff ...` reaches `apps/cloudflare verify` and fails in `apps/cloudflare/test/runner-container-runtime-callback.test.ts` on `renewActivityTimeout`.
Completed: 2026-05-12
