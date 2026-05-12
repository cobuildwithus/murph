# Preserve configured Linq base URL prefixes

Status: completed
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Make the hosted runner Linq egress intercept honor the full configured
  `LINQ_API_BASE_URL`, including path prefixes, before injecting Worker-owned
  Linq credentials.

## Success criteria

- Linq requests are intercepted only when the request origin matches the
  configured base URL origin.
- Allowed Linq endpoint validation runs on the path suffix after the configured
  base URL pathname prefix.
- Path-prefixed local or fixture Linq base URLs work for the existing allowed
  endpoints without broadening the upstream allowlist.

## Scope

- In scope: `apps/cloudflare/src/runner-egress-intercept.ts` and focused
  `apps/cloudflare/test/runner-egress-intercept.test.ts` coverage.
- Out of scope: provider read-fence policy changes, hosted-local harness
  rewrites, and changes to Linq runtime request construction.

## Constraints

- Preserve unrelated active hosted-runner work and dirty local edits.
- Do not expose real provider tokens, local identifiers, or request payloads in
  logs, docs, tests, or handoff.
- Keep Linq credential injection Worker-owned and restricted to explicitly
  allowed endpoint suffixes.

## Risks and mitigations

1. Risk: prefix handling could accidentally allow similarly named paths.
   Mitigation: require the request path to start with the configured prefix and
   validate only exact allowed suffix shapes beginning with `/`.

## Tasks

1. Register this plan and matching coordination-ledger row.
2. Derive Linq base URL origin and pathname prefix from `LINQ_API_BASE_URL`.
3. Add focused regression coverage for a custom Linq path prefix.
4. Run focused Cloudflare verification and required local review steps.
5. Close the plan through the repo completion path if a safe scoped commit is
   possible.

## Decisions

- Keep default Linq behavior at `https://api.linqapp.com/api/partner/v3` so
  existing production URLs continue to validate as suffixes.

## Verification

- Passed: `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-egress-intercept.test.ts --no-coverage`.
- Passed after latest overlapping test edits: `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-egress-intercept.test.ts --no-coverage`.
- Passed: `pnpm typecheck`.
- Passed after latest overlapping edits: `pnpm typecheck`.
- Earlier scoped pass: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-egress-intercept.ts apps/cloudflare/test/runner-egress-intercept.test.ts`.
- Latest scoped `test:diff` rerun failed in `apps/cloudflare/test/runner-platform.test.ts` because `platform.effectsPort.sendTelegram` and `sendLinqChatAction` are undefined under overlapping runtime-platform changes outside this task's files.
- Note: the first scoped `test:diff` attempt failed in `apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts` while contracts artifacts were being rebuilt; root typecheck then passed the contracts build, and a later scoped `test:diff` rerun passed before further overlapping runtime-platform edits landed.
- Commit status: scoped commit blocked by overlapping dirty work in
  `apps/cloudflare/src/runner-egress-intercept.ts`,
  `apps/cloudflare/test/runner-egress-intercept.test.ts`, the active
  coordination ledger, and other active Cloudflare/runtime files.
Completed: 2026-05-12
