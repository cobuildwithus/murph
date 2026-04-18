# Runtime harness cleanup

Status: completed
Created: 2026-04-18
Updated: 2026-04-18

## Goal

- Remove test/smoke-harness behavior from shipped runtime code where it weakens
  production boundaries or embeds harness controls directly in runtime modules.

## Success criteria

- Hosted web crypto/privacy helpers fail closed unless real keys are provided,
  with tests and smoke/build harnesses injecting explicit test config instead of
  relying on built-in deterministic fallback keys.
- Cloudflare hosted execution no longer keeps mutable `*ForTests` globals in
  the same runtime module as the real `runHostedExecutionJob` path.
- Shared hosted execution observability stops inferring behavior from `VITEST`
  and relies on explicit runtime overrides only.
- Verification covers the touched runtime and harness surfaces without
  broadening into unrelated hosted hard-cut or e2e stabilization work.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-web/encryption.ts`
  - `apps/web/src/lib/hosted-onboarding/{env,contact-privacy}.ts`
  - the exact test/smoke/CI harness files needed to inject explicit hosted-web
    keys for those helpers
  - `apps/cloudflare/src/node-runner.ts` plus the exact test helper seams needed
    to remove runtime `*ForTests` globals
  - `packages/hosted-execution/src/observability.ts`
  - durable repo guidance when a new anti-pattern rule is justified
- Out of scope:
  - local-dev-only preview/demo helpers in app routes unless they prove required
    by compile/runtime failures
  - broader hosted-local proxy transport redesign
  - unrelated hosted hard-cut batch work already in flight

## Constraints

- Preserve unrelated dirty-tree edits and active coordination lanes.
- Keep worker write ownership disjoint.
- Do not introduce new production env bypasses to replace removed fallbacks.
- Prefer harness-owned explicit config over runtime magic defaults.

## Tasks

1. Remove hosted web crypto/privacy test fallback keys from runtime code and
   move explicit test key injection into harnesses/tests.
2. Refactor Cloudflare node-runner test controls out of the runtime module and
   into a narrower test-owned seam.
3. Remove `VITEST`-based hosted execution log suppression from shared runtime
   observability in favor of explicit override-only behavior.
4. Run scoped verification and required audits, then commit the cleanup.

## Verification

- `pnpm --dir apps/web typecheck`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts <touched apps/web tests> --no-coverage`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts <touched cloudflare tests> --no-coverage`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm exec vitest run packages/hosted-execution/test/<touched tests> --no-coverage`
Completed: 2026-04-18
