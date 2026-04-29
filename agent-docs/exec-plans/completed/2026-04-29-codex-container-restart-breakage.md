# Codex Container Restart Breakage Characterization

Goal (incl. success criteria):
- Expand test scope from Codex config persistence to the Cloudflare runner container restart/warm-reuse surface.
- Success means repo tests explicitly characterize whether full-access hosted Codex can mutate shared container app files in a way later invocations may inherit.

Constraints/Assumptions:
- Test-only characterization. Do not add production safeguards unless separately requested.
- Preserve unrelated dirty work and active hosted-runtime/Cloudflare rows.
- Avoid real secrets, local usernames, or absolute local paths in tracked files.

Key decisions:
- Use the existing Cloudflare container image contract tests to inspect the actual deployed ownership/startup contract.
- Treat a writable `/app` bundle under the same runner user as evidence that container restart/warm-reuse breakage is possible in principle.

State:
- focused verification complete; scoped commit blocked by overlapping pre-existing edits in the same test file

Done:
- Located the runner container image contract and isolated-child launcher tests.
- Added a Cloudflare container image contract characterization for `/app` bundle mutability across warm container reuse.
- Confirmed the final hosted-runner Dockerfile copies `.deploy/runner-bundle/` to `/app/` as `runner:runner`.
- Confirmed the base Dockerfile's effective user is `runner` and the final Dockerfile does not override `USER`.
- Ran focused Vitest for `apps/cloudflare/test/container-image-contract.test.ts`; it passed.
- Ran `git diff --check` for the touched task files; it passed.
- Ran `bash scripts/workspace-verify.sh test:diff apps/cloudflare/test/container-image-contract.test.ts`; it failed on an existing deploy artifact stale-catalog expectation unrelated to this diff.
- Required review passes found a loose Docker `USER` assertion; replaced it with directive parsing.

Now:
- Handoff.

Next:
- If this work is landed, avoid committing unrelated pre-existing hunks already present in `apps/cloudflare/test/container-image-contract.test.ts`.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/test/container-image-contract.test.ts`
- `agent-docs/exec-plans/active/2026-04-29-codex-container-restart-breakage.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
