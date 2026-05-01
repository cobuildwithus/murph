# Hosted Parser Toolchain Boundary

## Goal

Hard-cut hosted parser toolchain authority so Worker-built runtime envelopes do
not serialize native parser paths, and container-side execution always binds the
image-owned native parser toolchain before running hosted jobs.

Success criteria:

- Worker/runtime-envelope builders omit parser toolchain config unless a direct
  caller explicitly supplies one for parser contract normalization.
- The container runner rejects `parserToolchain:null` but ignores stale typed
  parser paths from the Worker and rebinds native image defaults.
- Hosted typed parser tool config accepts only non-empty absolute string paths.
- Focused runtime and Cloudflare runner tests prove the boundary.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not widen into active hosted wake, hosted Linq, Junction, or local-Codex
  lanes.
- Do not expose local identifiers, secrets, raw env values, or filesystem
  user-specific paths in committed files.
- Keep package imports through declared public entrypoints.

## Working Set

- `apps/cloudflare/src/runner-env.ts`
- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/test/runner-env.test.ts`
- `apps/cloudflare/test/node-runner.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/models.ts`
- `packages/assistant-runtime/src/hosted-runtime/parsers.ts`
- `packages/assistant-runtime/src/hosted-runtime/environment.ts`
- `packages/assistant-runtime/src/hosted-runtime/launch-spec.ts`
- `packages/assistant-runtime/test/hosted-runtime-config.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-environment.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## State

Implemented and focused verified. Worker-built Cloudflare runtime envelopes omit
parser toolchain by default, the container runner rejects `parserToolchain:null`
but rebinds stale requested parser paths to image-owned native defaults, and
assistant-runtime parser config parsing, normalization, and launch-spec direct
caller handling now require non-empty absolute string paths.

Focused checks passed:

- `pnpm --dir packages/assistant-runtime build`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-config.test.ts test/hosted-runtime-environment.test.ts --config vitest.config.ts --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/node-runner.test.ts`
- `pnpm --dir packages/assistant-runtime test:coverage`
- `pnpm --dir apps/cloudflare typecheck`
- Targeted `bash scripts/workspace-verify.sh test:diff ...` for the parser
  boundary files
- `pnpm typecheck`
- Scoped `git diff --check`

Verification note: root `pnpm typecheck` and targeted `test:diff` exited 0 in
the final run, while the shared checkout still printed an existing
workspace-boundary diagnostic for the unrelated hosted-local harness import
path.

Audits:

- Security/privacy review found no scoped findings.
- Coverage-write found no missing in-scope proof and made no edits.
- Final review found launch-spec direct-caller validation and stale plan-state
  gaps; both were addressed.

Residual risk: no live Cloudflare managed-container smoke was run in this slice;
focused tests assume `createHostedRunnerNativeParserToolchain()` matches the
deployed image paths.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
