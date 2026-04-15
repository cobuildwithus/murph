# Land Pro security patch for device-syncd OAuth callback sanitization

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Land the downloaded Pro security patch intent on the current repo state so the public `device-syncd` OAuth callback no longer leaks raw internal account ids through redirect/query or fallback HTML and scrubs stale callback params on both success and error redirects.

## Success criteria

- `packages/device-syncd/src/http.ts` clears stale callback params before writing success or error callback state.
- Success redirects and fallback HTML omit raw internal account ids.
- Regression tests cover the success redirect, fallback HTML, and error redirect scrub behavior on the current test layout.
- Required repo verification for `packages/device-syncd` passes, or any unrelated blocker is documented with evidence.

## Scope

- In scope:
  - Adapt the downloaded patch intent to the current `device-syncd` HTTP callback implementation.
  - Update existing `device-syncd` tests instead of overwriting current test files.
  - Run the required verification, audit passes, and scoped commit flow.
- Out of scope:
  - Other Pro audit residual concerns unrelated to the downloaded patch.
  - Broader device-sync replay or webhook-verification changes.

## Constraints

- Technical constraints:
  - Preserve current route structure and current test harnesses.
  - Do not overwrite unrelated dirty worktree changes.
- Product/process constraints:
  - Keep the change scoped to the downloaded artifact intent.
  - Follow repo completion workflow, including required audits and scoped commit.

## Risks and mitigations

1. Risk: The Pro patch targets an older snapshot and conflicts with current test layout.
   Mitigation: Port the behavioral intent into existing tests and confirm coverage against current code paths.
2. Risk: Callback behavior changes on a public OAuth surface could break existing redirect expectations.
   Mitigation: Add direct redirect/HTML regression coverage and run the package verification lane.

## Tasks

1. Register the active scope in the coordination ledger.
2. Port the callback scrub/sanitization changes into `packages/device-syncd/src/http.ts`.
3. Update current `device-syncd` tests to cover the new behavior.
4. Run required verification and direct scenario proof.
5. Run required audit passes, address findings, and finish with a scoped commit.

## Decisions

- Use a dedicated plan because the patch touches a public OAuth callback surface.
- Treat the downloaded patch as behavioral intent only because it attempts to add a test file that already exists in the current repo.
- Keep the implementation scoped to `device-syncd` callback sanitization; do not expand into the residual Pro audit concerns.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test:diff packages/device-syncd/src/http.ts packages/device-syncd/test/http.test.ts packages/device-syncd/test/http-redirects.test.ts`
- Commands run:
  - `pnpm typecheck` ✅
  - `pnpm test:diff packages/device-syncd/src/http.ts packages/device-syncd/test/http.test.ts packages/device-syncd/test/http-redirects.test.ts` ✅
  - `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts -t "device sync http handler redirects successful callbacks and renders callback failures without returnTo|device sync http handler routes control and public requests without socket leakage|device sync http handler redirects OAuth callback errors back to the original returnTo|callback error redirects scrub stale callback params from returnTo" --no-coverage` ✅
- Expected outcomes:
  - Typecheck passes.
  - Diff-aware tests cover `device-syncd` and pass with the new callback sanitization behavior.
- Evidence:
  - Success redirects now preserve the destination while clearing stale callback params and omitting `deviceSyncAccountId`.
  - Callback success HTML still renders the provider label but no longer includes the raw internal account id.
  - Error redirects scrub stale success/account params before writing the machine-readable error state.
Completed: 2026-04-09
