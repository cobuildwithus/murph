Goal (incl. success criteria):
- Add ripgrep to the Cloudflare hosted runner base image for Codex shell use.
- Success means the base image installs `rg`, the final-image smoke proves it is discoverable and can search files as the runtime user, and deploy docs list it as part of the native tool contract.

Constraints/Assumptions:
- Preserve unrelated dirty exercise-library changes.
- Do not disturb active hosted-runner destroy-timeout or bundle-prune lanes.
- Keep the change narrow: image package, smoke proof, smoke contract tests, and deploy documentation.

Key decisions:
- Install Debian's `ripgrep` package in the stable base image with the other native CLI tools.
- Extend the existing hosted runner Docker smoke rather than adding a separate image check.

State:
- Active.

Done:
- Read hosted-runtime skill, repo workflow routing, completion, verification, security, reliability, coordination ledger, and current runner smoke/image files.
- Patched the base image to install `ripgrep` and run `rg --version` during base-image build.
- Extended the final-image Docker smoke contract to prove direct `rg` discovery/search and Codex app-server `command/exec` access to `rg --version`.
- Updated smoke tests, image-contract assertions, and deploy documentation.
- Focused Vitest passed for hosted-runner smoke contract, smoke launcher, and container image contract tests.
- `pnpm --dir apps/cloudflare verify` passed.
- `pnpm --dir apps/cloudflare runner:docker:smoke` passed; the final image reported `ripgrepCommandDiscovered=true` and `ripgrepVersion=ripgrep 13.0.0`.
- Scoped `test:diff` passed for this task's files and mapped to `apps/cloudflare verify`.
- Security/privacy audit reported no critical, high, or medium findings.
- Final completion audit reported no high, medium, or low findings.

Now:
- Close the plan and commit the scoped change.

Next:
- Handoff with verification and audit evidence.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `Dockerfile.cloudflare-hosted-runner-base`
- `apps/cloudflare/src/hosted-runner-smoke-child.ts`
- `apps/cloudflare/src/hosted-runner-smoke-contract.ts`
- `apps/cloudflare/scripts/runner-docker-smoke.ts`
- `apps/cloudflare/test/hosted-runner-smoke-contract.test.ts`
- `apps/cloudflare/test/hosted-runner-smoke.test.ts`
- `apps/cloudflare/test/container-image-contract.test.ts`
- `apps/cloudflare/DEPLOY.md`
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
