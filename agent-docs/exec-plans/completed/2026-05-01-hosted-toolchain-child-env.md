# Hosted Toolchain Child Env Projection

## Goal

Remove parser path injection from the Cloudflare child-process boundary by making
`assistant-runtime` own the manifest-to-child-env projection while Cloudflare
keeps launcher directories and transport-specific setup.

Success criteria:

- A shared `assistant-runtime` helper projects sanitized forwarded env plus typed
  parser toolchain config into child-process env.
- Parser toolchain env wins after forwarded env so stale serialized env cannot
  shadow the runner image/toolchain manifest.
- Cloudflare child launch uses the shared projection helper and still owns
  `HOME`, temp/cache roots, TSX wiring, cwd, process groups, and transport
  details.
- Focused tests cover omitted forwarded parser paths and stale forwarded parser
  path attempts.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not widen into active hosted Linq, typing, liveness, or runner image lanes.
- Do not add Cloudflare env passthrough, runner-secret allowlists, or `WHISPER_PATH`
  forwarding.
- Do not expose secrets, local identifiers, raw provider payloads, or local
  account paths in docs, fixtures, logs, or commit text.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/environment.ts`
- `packages/assistant-runtime/src/hosted-runtime-contracts.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-environment.test.ts`
- `packages/assistant-runtime/test/package-entrypoints.test.ts`
- `apps/cloudflare/src/runner-child-launcher.ts`
- `apps/cloudflare/src/node-runner-isolated.ts`
- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/src/runner-env.ts`
- `apps/cloudflare/test/node-runner.test.ts`
- `apps/cloudflare/test/runner-child-launcher.test.ts`
- `apps/cloudflare/test/runner-env.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## State

Implemented. Focused assistant-runtime and Cloudflare runner env tests pass.
Scoped `scripts/workspace-verify.sh test:diff` pass is complete. Coverage-write
reported no missing proof gap and made no edits. Final review is pending.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
