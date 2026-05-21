# Hosted runner CLI vault E2E

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

Add production-shaped hosted runner proof that the assistant's local Docker
container command path can exercise vault-bound CLI commands through the active
vault context, including the hard-cut vault option behavior.

## Success criteria

- The local runner Docker smoke executes real `vault-cli` commands through
  Codex App Server `command/exec` inside the container.
- The smoke covers default active-vault reads, explicit raw `--vault` boundary
  reads, measurement writes with prose commas, scheduled measurement reminders,
  and representative read/list commands that previously depended on vault
  injection.
- The smoke result contract records only metadata and booleans/counts, not vault
  contents, prompts, paths, secrets, or provider payloads.
- Focused tests, typecheck, and the Docker runner smoke pass or have an
  unrelated blocker documented.

## Scope

- In scope:
  - `apps/cloudflare` hosted runner Docker smoke child and contract.
  - The final hosted runner Docker app layer used by both production and the
    smoke bundle override.
  - Focused smoke contract/unit tests.
  - Existing container-image contract assertions for the smoke runner.
  - Verification docs that describe the new hosted runner proof.
- Out of scope:
  - The existing dirty scheduled reminder E2E change.
  - Live provider calls or live Codex model turns.
  - CLI runtime architecture changes beyond adding hosted proof.

## Constraints

- Preserve unrelated dirty work in the scheduled reminder E2E plan/test.
- Keep Docker smoke output metadata-only and redacted.
- Do not add new persisted product state outside the restored throwaway smoke
  vault.

## Tasks

1. Map the existing runner Docker smoke and assistant command execution path.
2. Add container-internal CLI command proof through Codex App Server.
3. Update focused tests and durable verification docs.
4. Run focused local tests, typecheck, and Docker smoke proof.
5. Complete required audit and scoped commit workflow.

## Verification

- Passed:
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/hosted-runner-smoke-contract.test.ts test/hosted-runner-smoke.test.ts`
  - `pnpm --dir apps/cloudflare exec tsc -p tsconfig.smoke-build.json --pretty false --noEmit`
  - `pnpm --dir apps/cloudflare runner:docker:smoke`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff <touched paths>` after updating the container-image contract.
  - ReviewGPT review with `architecture`, `simplify`, `bug-hunt`,
    `legacy-removal`, `privacy`, and `security` presets.
  - `pnpm --dir apps/cloudflare runner:docker:smoke:prepared-base` after the
    ReviewGPT fixes.

## Notes

- The proof should run in the same final-image path used by local hosted runner
  smoke, with Codex App Server exercising shell commands inside the container.
- ReviewGPT finding 1 was stale for this checkout: the base Dockerfile and
  app-level smoke bundle Docker ignore entry were present and the requested
  prepared-base smoke passed. Its simplification target was still useful, so the
  separate smoke Dockerfile was collapsed into the production app-layer
  Dockerfile via `HOSTED_RUNNER_BUNDLE_DIR`.
- ReviewGPT findings 2 and 3 were accepted: failed proof booleans now fail the
  result parser, and the parent logs only vault-id match status instead of the
  raw vault id.
Completed: 2026-05-21
