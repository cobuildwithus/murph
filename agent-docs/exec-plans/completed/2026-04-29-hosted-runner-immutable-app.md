# Hosted Runner Immutable App Bundle

Goal (incl. success criteria):
- Prevent hosted Codex running as the runtime user from mutating the runner app bundle under `/app`.
- Success means production and smoke runner images copy `/app` as root-owned, make it non-writable, return execution to `runner`, and regression tests prove the contract.

Constraints/Assumptions:
- Minimal deploy-surface fix only. Do not add a runtime recovery state machine.
- Preserve unrelated dirty work in the shared Cloudflare container image contract test.
- Do not include local personal identifiers in files, logs, docs, or fixtures.

Key decisions:
- Use Unix file ownership/mode as the primary trust boundary: immutable control plane under `/app`, writable runtime/workspace state elsewhere.
- Keep the existing `runner` runtime user and current entrypoint/CMD.

State:
- verified; scoped commit blocked by overlapping pre-existing dirty hunks in the shared Cloudflare contract test and ledger

Done:
- Reviewed Docker runner image contract and existing characterization test.
- Updated production and smoke runner Dockerfiles so `/app` is copied as `root:root`, made non-writable, then execution returns to `USER runner`.
- Updated the Cloudflare container image contract regression to require root-owned/non-writable `/app` and `runner` as the final runtime user.
- Ran focused container image contract Vitest; it passed.
- Built the final runner image locally with the pinned platform and verified the container defaults to `runner`.
- Verified `touch /app/.codex-write-probe` fails in the built image with permission denied.
- Ran `apps/cloudflare` typecheck; it passed.
- Ran diff-aware Cloudflare verification; it passed.
- Ran `git diff --check` for the touched task files; it passed.

Now:
- Handoff.

Next:
- Land with a scoped commit only after avoiding unrelated pre-existing hunks in `apps/cloudflare/test/container-image-contract.test.ts` and the ledger.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `Dockerfile.cloudflare-hosted-runner`
- `Dockerfile.cloudflare-hosted-runner-smoke`
- `apps/cloudflare/test/container-image-contract.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
