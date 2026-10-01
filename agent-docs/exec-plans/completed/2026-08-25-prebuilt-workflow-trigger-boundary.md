Goal (incl. success criteria):
- Fix Frog issue #2149 by making the supported local hosted-web prebuilt deployment preserve the Workflow SDK's exact queue-consumer triggers in the final Vercel Build Output function metadata.
- Success means linked or deduplicated Step and Flow routes resolve to valid final function configs containing their SDK-generated triggers, invalid evidence blocks upload, focused proof and exact-head review gates pass, and the PR lands cleanly.

Constraints/Assumptions:
- Keep managed Vercel builds and application Workflow semantics unchanged.
- Derive trigger values from the generated Workflow SDK config; do not duplicate SDK-owned topic or retry constants in production code.
- Treat generated config, symlinks, and Build Output metadata as untrusted local build evidence and fail closed before upload when the proof is missing, malformed, escaping, ambiguous, or conflicting.
- Preserve unrelated existing function triggers and support both distinct and shared final functions.
- Keep secrets, deployment credentials, network behavior, and production state out of the change.

Key decisions:
- Repair the repository-owned local `vercel build` / `vercel deploy --prebuilt` boundary instead of changing managed builds or Workflow application routes.
- Capture the exact generated SDK config just before the existing cleanup removes generated source artifacts, then remove the capture before upload.
- Resolve final function targets through the Build Output route links and merge exact triggers idempotently into each owning `.vc-config.json`.
- Validate every target before the first write and revalidate the finished artifact before starting the upload.

State:
- Completed; implementation, focused and broad local proof, scoped candidate commit, and final candidate/privacy review are complete.

Done:
- Proved the root cause at the final Build Output packaging seam: both generated Workflow routes can link to one shared function whose final metadata omits the SDK-generated queue triggers.
- Confirmed the SDK generates the exact Step and Flow `queue/v2beta` trigger definitions before cleanup.
- Recovered and applied the exact single ReviewGPT implementation artifact after validating its response marker, artifact identity, paths, privacy, scope, and clean applicability.
- Added the prebuilt deployment wrapper, SDK-config capture boundary, focused synthetic coverage, package entrypoint, and hosted-web documentation.
- Passed the focused Vitest suite: 2 files and 11 tests.
- Passed the repository TypeScript tools check.
- Passed package JSON parsing, patch parity, privacy/scope scans, and `git diff --check`.
- Passed the diff-aware verifier, including 45 repository-tools files and 695 tests; all hosted, dependency, workspace-boundary, and cycle guards; the hosted-web TypeScript check; 850 hosted-web test files and 11,609 tests; lint with zero errors; dev smoke; and the production Next build.
- Confirmed the final candidate contains exactly the six ReviewGPT-authored implementation files, uses the approved no-reply Git identity, and contains no private identifiers or unrelated tracked output.
- Created and pushed the scoped implementation candidate commit.

Now:
- Archive this plan through the required scoped completion helper.

Next:
- Open the Draft PR, start preliminary and final exact-head ReviewGPT gates concurrently with CI after lane assignment, remediate accepted findings, complete the parent final review, and merge only after stable green exact-head proof.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/README.md`
- `apps/web/package.json`
- `scripts/clean-hosted-web-workflow-artifacts.ts`
- `scripts/clean-hosted-web-workflow-artifacts.test.ts`
- `scripts/deploy-hosted-web-vercel-prebuilt.ts`
- `scripts/deploy-hosted-web-vercel-prebuilt.test.ts`
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/clean-hosted-web-workflow-artifacts.test.ts scripts/deploy-hosted-web-vercel-prebuilt.test.ts`
- `node scripts/run-typescript.mjs package -p tsconfig.tools.json --pretty false`
- `pnpm test:diff apps/web/README.md apps/web/package.json scripts/clean-hosted-web-workflow-artifacts.ts scripts/clean-hosted-web-workflow-artifacts.test.ts scripts/deploy-hosted-web-vercel-prebuilt.ts scripts/deploy-hosted-web-vercel-prebuilt.test.ts`
Status: completed
Updated: 2026-08-25
Completed: 2026-08-25
Completed: 2026-08-25
