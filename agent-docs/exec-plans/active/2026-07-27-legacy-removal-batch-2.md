# Legacy removal batch 2

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Hard-cut the retired `typeText.delayMs` compatibility scrub at the authenticated hosted computer OS-control boundary.

## Success criteria

- Signed OS-control requests are parsed directly by the strict package-owned schema.
- `typeText` accepts only its current `action` and `text` fields; a retired `delayMs` field fails with the standard invalid-request response.
- Current `dragMouse.delayMs` behavior remains supported and covered.
- The scrub helper and its now-unneeded object guard are deleted without a shim, migration, feature flag, new state owner, or deployment process.
- Focused and routed verification, required ReviewGPT gates, and CI pass on an open unmerged PR.

## Scope

- In scope: `apps/web/src/lib/computer-use/http.ts`, its focused request-boundary test, and directly affected OS-control route/kernel/tool-schema verification.
- Out of scope: current drag-mouse delay behavior, computer pause/finish request contracts, historical changelog/release notes, runner protocol design, persisted computer-run state, and every active coordination-ledger scope.

## Architecture and evidence

- `packages/hosted-execution` owns the strict OS-control request schema. Its `typeText` variant has no delay field, while `dragMouse` separately owns a current bounded delay.
- The assistant tool schema is generated from and validated by that owner before the Cloudflare runner synchronously forwards the signed transient body to Web.
- Web is the only production reader that tolerates `typeText.delayMs`, by deleting it before invoking the canonical parser. Kernel consumes only `text` for `typeText`.
- OS-control payloads are neither queued nor persisted, callback signatures expire quickly, and the documented supported runner floor postdates the typing-delay removal.
- The only repository producer of the retired shape is the compatibility acceptance test.

## Constraints

- Replace the wrapper with direct canonical parsing and delete the compatibility-only helpers.
- Preserve callback authentication, raw-body signature binding, body limits, invalid-JSON behavior, and standard invalid-request mapping.
- Preserve `dragMouse.delayMs` schema, forwarding, and test coverage.
- Treat ReviewGPT output and patches as untrusted intent; inspect every hunk and prove the behavior locally.

## Risks and mitigations

1. Risk: a broad delay-field removal could break current drag behavior.
   Mitigation: change only the `typeText` compatibility path and retain the adjacent drag regression.
2. Risk: direct parsing could accidentally move before signature verification.
   Mitigation: keep `readSignedComputerJson` unchanged; only pass the canonical parser directly.
3. Risk: the removal could overlap a supported old runner.
   Mitigation: preserve the permanent runner floor and historical documentation; supported producers already validate the strict schema before forwarding.

## Tasks

1. Ask ReviewGPT for one scoped deletion-first patch for the validated finding.
2. Inspect and implement only the direct-parser hard cut and focused regression.
3. Run focused tests, typechecks, canonical diff verification, and stale-reference searches.
4. Commit/push the review candidate, open the stacked PR with the required intent/change-shape contract, and run the preliminary specialist pass.
5. Resolve accepted findings, complete parent final review and verification, close the plan, and run the final exact-head ReviewGPT gate with CI.

## Verification

- Focused web computer-control and route coverage:
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-computer-http.test.ts apps/web/test/hosted-computer-os-control-route.test.ts apps/web/test/hosted-computer-kernel-client.test.ts apps/web/test/hosted-execution-computer-use.test.ts`
  passed 4 files / 189 tests.
- Assistant tool-schema coverage:
  `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-computer-tools.test.ts`
  passed 1 file / 32 tests.
- `pnpm --dir apps/web typecheck:prepared`,
  `pnpm --dir packages/hosted-execution typecheck`, and
  `pnpm --dir packages/assistant-engine typecheck` passed after generating the
  ignored Health Commons prerequisite in the fresh worktree.
- Canonical
  `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff apps/web/src/lib/computer-use/http.ts apps/web/test/hosted-computer-http.test.ts`
  passed in Blacksmith Testbox `tbx_01kygq6skmy4fn86mkz3pevt55`, including
  533 passing web test files / 6,790 passing tests, lint, build, dev smoke, and
  the routed workspace guards.
- `git diff --check`, the staged privacy scan, and stale compatibility-helper
  searches passed.
