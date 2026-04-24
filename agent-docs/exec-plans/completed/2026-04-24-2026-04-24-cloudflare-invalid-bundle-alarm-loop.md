# Fix Cloudflare invalid hosted bundle alarm loop

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Stop the Cloudflare hosted runner from committing invalid hosted bundle archives and from repeatedly alarming on a deterministic invalid authoritative bundle ref.
- Preserve the web-owned cursor/run authority while making Cloudflare cleanup/recovery treat non-retryable invalid archives differently from retryable R2/delete failures.

## Success criteria

- Runner output bundles are archive-validated before any new snapshot ref can become authoritative.
- Existing invalid authoritative bundle refs do not keep retriggering the same bundle cleanup warning and immediate alarm loop.
- Focused Cloudflare tests cover invalid output rejection and invalid authoritative-ref replay behavior.
- No deploy is performed.

## Scope

- In scope:
  - `apps/cloudflare/src/user-runner/runner-bundle-sync.ts`
  - `apps/cloudflare/src/bundle-gc.ts`
  - `apps/cloudflare/src/hosted-bundle-validation.ts`
  - `apps/cloudflare/src/user-runner/runner-run-processor.ts`
  - `apps/cloudflare/src/user-runner/run-finalization.ts`
  - directly coupled `apps/cloudflare/test/**`
  - shared hosted bundle archive validation in `packages/runtime-state/src/hosted-bundle.ts`
- Out of scope:
  - assistant provider request logging, Azure observability, and provider telemetry files
  - hosted web control-plane schema changes unless inspection proves they are required

## Constraints

- Technical constraints:
  - Cloudflare must not become the canonical cursor owner; cursor and run recovery remain web-owned.
  - Do not delete previous bundle/artifact data when the current authoritative bundle cannot be parsed.
  - Preserve retry behavior for genuinely retryable storage/delete failures.
- Product/process constraints:
  - Preserve unrelated working-tree edits and active ledger rows.
  - Do not deploy.

## Risks and mitigations

1. Risk: Treating all cleanup failures as terminal could leak storage or hide transient R2 outages.
   Mitigation: classify only invalid hosted bundle archive bytes as non-retryable; leave missing/delete/storage failures retryable.
2. Risk: Fixing the loop by clearing authoritative snapshot refs could erase recoverable user data.
   Mitigation: do not clear cursor snapshot refs from Cloudflare; stop the loop while preserving data for manual recovery.

## Tasks

1. Trace current invalid-bundle commit, cleanup, and alarm scheduling behavior.
2. Add bundle archive validation before runner output writes.
3. Make authoritative cleanup reconciliation mark deterministic invalid current archives as handled without deleting the previous bundle.
4. Add focused regression tests.
5. Run focused tests, typecheck, required audit passes, and report results.

## Decisions

- Keep Cloudflare execution-only: no direct cursor repair or deploy-time intervention in this fix.
- Invalid runner-produced output fails before R2 writes; already-authoritative invalid input is quarantined so the web-owned ledger can stop retrying deterministic corrupt state.
- Authoritative cleanup reconciliation treats invalid current archives as handled while preserving previous bundle/artifact data; missing/decrypt/storage failures still stay retryable.

## Verification

- Passed:
  - `pnpm exec vitest run apps/cloudflare/test/runner-bundle-helpers.test.ts apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir packages/runtime-state typecheck`
  - `pnpm --dir packages/runtime-state test:coverage`
  - `git diff --check -- ...`
  - `pnpm --dir apps/cloudflare verify`
  - `pnpm test:smoke`
Completed: 2026-04-24
