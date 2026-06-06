Goal (incl. success criteria):
- Fix assistant CLI bootstrap so dev/runtime agents see executable arg/option signatures for normal vault CLI commands without broad `--help` discovery.
- Success: prebuilt assistant CLI contract is generated from schema-bearing `--llms-full`, detailed families include all non-global arg/option signatures/enums, low-frequency families remain bare names, runtime fallback remains compact, and regression tests cover the behavior.
- Deployment success: Cloudflare managed-container deploy smoke fails closed if the deployed runner cannot read the assistant CLI surface contract or if the hot onboarding/device command schemas are missing.

Constraints/Assumptions:
- Preserve unrelated dirty work and active ledger rows.
- Do not edit the active onboarding skill prompt row unless code evidence requires it.
- Keep runtime bootstrap lightweight; avoid calling full manifest generation during live assistant turns.

Key decisions:
- Use `vault-cli --llms-full --format json` only for build-time prebuilt contract generation.
- Keep live runtime fallback on compact `vault-cli --llms --format json`.
- Render all non-global option signatures for detailed families and keep the existing low-frequency name-only family boundary.
- Reuse the Cloudflare runner smoke path as the deploy guard instead of adding a separate deploy system.
- Expose the assistant CLI surface reader to Cloudflare through `@murphai/assistant-runtime/hosted-assistant-bootstrap`, not a direct Cloudflare import from assistant-engine.

State:
- In progress.

Done:
- Traced compact manifest and confirmed it omits schemas for `memory upsert` and `goal save`.
- Implemented full-manifest prebuilt generation and detailed signature rendering.
- Focused assistant-engine bootstrap test passed.
- Package build passed and generated a 37,282-char prebuilt contract with `memory upsert`, `goal save`, and `supplement save` signatures while preserving name-only `document import`.
- Added managed-container and Docker runner smoke proofs for assistant CLI surface hot-path schemas.
- Focused Cloudflare smoke/parser tests passed, Cloudflare typecheck passed, and standalone smoke build passed after assistant-engine build.
- Task-finish review found two issues; fixed hot-path proof counting to validate snippets on the matching command line and changed the deploy workflow to run managed-container smoke for gradual rollouts too.

Now:
- Run remaining required verification and completion audits.

Next:
- Commit via `scripts/finish-task` if verification/audits pass.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether the currently running dev agent needs restart to pick up source changes.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/cli-surface-bootstrap.ts`
- `packages/assistant-engine/src/assistant/cli-surface-manifest.ts`
- `packages/assistant-engine/src/assistant/generate-cli-surface-contract.ts`
- `packages/assistant-engine/src/index.ts`
- `packages/assistant-engine/test/assistant-cli-surface-bootstrap.test.ts`
- `packages/assistant-runtime/src/hosted-assistant-bootstrap.ts`
- `packages/assistant-runtime/package.json`
- `packages/assistant-runtime/test/package-entrypoints.test.ts`
- `apps/cloudflare/src/hosted-runner-smoke-contract.ts`
- `apps/cloudflare/src/hosted-runner-smoke-child.ts`
- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/scripts/smoke-hosted-deploy.shared.ts`
- `apps/cloudflare/tsconfig.smoke-build.json`
- `apps/cloudflare/DEPLOY.md`
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `agent-docs/references/testing-ci-map.md`
- `agent-docs/exec-plans/active/2026-06-06-assistant-cli-save-schema-bootstrap.md`
Status: completed
Updated: 2026-06-06
Completed: 2026-06-06
