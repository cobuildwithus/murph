# Hosted Runner Test Green

Goal (incl. success criteria):
- Get the failures found after the immutable `/app` change green without widening into unrelated product work.
- Success means the Docker runner smoke and the currently failing assistant-runtime hosted workspace entrypoint tests pass, while the `/app` write-denial regression remains intact.

Constraints/Assumptions:
- Use subagents for parallel root-cause review as requested.
- Preserve unrelated dirty work and active ledger rows.
- Keep fixes minimal and tied to failing tests/package shape.
- Do not expose personal identifiers in committed files or logs.

Key decisions:
- Treat Docker smoke and assistant-runtime failures as separate tracks until proven coupled.
- Keep `/app` root-owned and non-writable.

State:
- in_progress

Done:
- Spawned review-only subagents for Docker smoke package-shape failure and assistant-runtime provider-config failures.
- Confirmed `/app` write probe still fails with permission denied in the rebuilt image.

Now:
- Patch the smallest root causes.

Next:
- Rerun focused failing tests, Docker smoke, Cloudflare E2E, and root test if feasible.

Open questions (UNCONFIRMED if needed):
- Whether Docker smoke package-shape failure is pre-existing or caused by current dirty package export changes.

Working set (files/ids/commands):
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/cli/package.json` or runner-bundle assembly/package-shape files if Docker smoke root cause requires it
- `Dockerfile.cloudflare-hosted-runner`
- `Dockerfile.cloudflare-hosted-runner-smoke`
- `apps/cloudflare/test/container-image-contract.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
