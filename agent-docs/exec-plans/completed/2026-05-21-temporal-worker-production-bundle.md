# Temporal worker production bundle and shutdown grace

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Add production Temporal Worker workflow pre-bundling and an intentional
  graceful-shutdown policy so Render deploys/restarts stop polling and give
  long Cloudflare execution Activities time to finish before Temporal retries
  an unfinished attempt.

## Success criteria

- Production worker startup uses a checked-in build script output through
  `workflowBundle`; local/dev worker startup keeps `workflowsPath`.
- Production build/start wiring creates the workflow bundle before starting the
  built worker process.
- Worker options set an explicit `shutdownGraceTime` and bounded
  `shutdownForceTime`, with env overrides documented.
- Tests cover production bundle selection, dev `workflowsPath` selection, and
  shutdown option normalization.

## Scope

- In scope: `packages/hosted-orchestrator-temporal` worker entrypoint, package
  scripts, package tests/docs, and Render build wiring.
- Out of scope: workflow/activity behavior, Temporal task-queue semantics,
  Cloudflare execution adapter behavior, and web Temporal signal client changes.

## Constraints

- Technical constraints: use Temporal TypeScript SDK primary docs; keep workflow
  code pointer-only and do not change Activity retry/idempotency semantics.
- Product/process constraints: preserve unrelated dirty work and active Temporal
  rows; do not expose secrets, local paths, user ids, or account identifiers in
  generated files, docs, logs, or commits.

## Risks and mitigations

1. Risk: production starts without a bundle artifact and silently falls back to
   runtime bundling.
   Mitigation: fail production startup when the bundle file is missing, and
   wire the production build to create it.
2. Risk: shutdown grace exceeds the platform termination window.
   Mitigation: default grace/force stay below Render's 300 second maximum
   shutdown delay, and env overrides validate force >= grace.
3. Risk: overlap with active workflow/activity changes.
   Mitigation: limit edits to worker/build/docs/tests and avoid workflow or
   Activity behavior files.

## Tasks

1. Inspect worker/package/render wiring and existing tests.
2. Add workflow bundle build script and production worker option selection.
3. Add shutdown grace/force env parsing and tests.
4. Update package docs and Render build command.
5. Run focused package verification plus required repo checks/audits.
6. Close plan after verification; scoped commit is blocked by overlapping
   unrelated dirty hunks in shared docs/ledger files.

## Decisions

- Use `NODE_ENV === "production"` as the production bundle switch; local/dev and
  tests keep `workflowsPath`.
- Default shutdown grace to 270 seconds with a 295 second force cap so Render's
  300 second shutdown-delay window remains the outer platform bound. Operators
  can override both via env without code changes.
- Keep worker-only shutdown env parsing in the Temporal worker package rather
  than the shared hosted-execution Temporal env helper, because the shared helper
  is also consumed by web code that should not inherit worker shutdown policy.

## Verification

- Passed:
  - `pnpm --dir packages/hosted-orchestrator-temporal exec vitest run --config vitest.config.ts test/worker.test.ts --no-coverage`
  - `pnpm --dir packages/hosted-orchestrator-temporal build`
  - `pnpm --dir packages/hosted-orchestrator-temporal test:coverage`
  - `bash scripts/workspace-verify.sh test:diff ARCHITECTURE.md agent-docs/operations/verification-and-runtime.md packages/hosted-orchestrator-temporal/README.md packages/hosted-orchestrator-temporal/package.json packages/hosted-orchestrator-temporal/src/worker.ts packages/hosted-orchestrator-temporal/src/scripts/build-workflow-bundle.ts packages/hosted-orchestrator-temporal/test/worker.test.ts render.yaml`
  - `git diff --check -- ARCHITECTURE.md agent-docs/operations/verification-and-runtime.md packages/hosted-orchestrator-temporal/README.md packages/hosted-orchestrator-temporal/package.json packages/hosted-orchestrator-temporal/src/worker.ts packages/hosted-orchestrator-temporal/src/scripts/build-workflow-bundle.ts packages/hosted-orchestrator-temporal/test/worker.test.ts render.yaml`
  - `pnpm test:smoke`
- Root `pnpm typecheck` failed on unrelated dirty `apps/cloudflare` E2E test
  type drift involving `eventSource`; this task did not touch those files.
- Required audits:
  - security/privacy review: no findings.
  - simplify review: accepted redundant Render env removal and local parser
    collapse; kept worker-only parser local by design.
  - coverage-write: added env-driven production bundle selection test.
  - task-finish review: no behavior findings; noted the new bundle builder must
    be included if a future scoped commit is created.
Completed: 2026-05-21
