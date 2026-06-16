Goal (incl. success criteria):
- Reproduce and fix the deployed Cloudflare runner live-model smoke failure where `codex exec` exits after refusing to create helper binaries under the smoke temp `CODEX_HOME`.
- Success means the smoke uses a Codex home/PATH layout accepted by current Codex, has regression coverage, and passes scoped Cloudflare verification.

Constraints/Assumptions:
- Keep the fix scoped to deploy-smoke behavior unless reproduction proves the production hosted runtime path is affected.
- Do not expose secrets, raw provider payloads, local user identifiers, or home-directory paths in committed files or logs.
- Preserve Worker-owned OpenAI credential injection; the container still receives only the injected-credential sentinel.

Key decisions:
- Keep the deploy-smoke vault/temp workspace under the system temp directory, but move the smoke `CODEX_HOME` under the runner-owned non-temp home root so Linux Codex 0.135.0 can create helper binaries.

State:
- Ready to close after scoped commit.

Done:
- Read hosted runtime triage docs, read-first docs, security/reliability docs, deploy docs, and CI failure log.
- Reproduced the Codex helper-binary refusal in a Linux Node 24.14.1 container with pinned Codex 0.135.0 and a temp-dir `CODEX_HOME`.
- Proved the warning disappears when only `CODEX_HOME` moves to a non-temp runner-owned directory.
- Patched deploy-smoke workspace creation and added focused resolver coverage.
- Coverage-write added fallback coverage for non-temp `HOME` when `HOSTED_HOME` is absent.
- Verification passed:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/container-entrypoint.test.ts`
  - `pnpm --dir apps/cloudflare verify`
- Required audits completed:
  - `security-privacy-review`: no findings.
  - `coverage-write`: added one focused assertion; focused test and typecheck passed in the pass.
  - `deep-review`: no production-breaking findings.

Now:
- Close plan and create scoped commit.

Next:
- Commit with `scripts/finish-task` if verification/audits pass.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/test/container-entrypoint.test.ts`
- CI run: `27586406774`, job `81558422027`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/container-entrypoint.test.ts`
- `pnpm --dir apps/cloudflare verify`
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
