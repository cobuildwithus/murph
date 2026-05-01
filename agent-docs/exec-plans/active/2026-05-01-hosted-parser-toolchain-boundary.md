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
- `packages/assistant-runtime/test/hosted-runtime-config.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-environment.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## State

Plan opened. Implementation not started.
