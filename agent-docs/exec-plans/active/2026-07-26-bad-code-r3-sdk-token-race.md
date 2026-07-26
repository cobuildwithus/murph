# Bad-code round 3: withhold SDK tokens after disconnect

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Prevent an explicit companion connect from returning a freshly minted Junction SDK sign-in token when a concurrent disconnect has already won.

## Success criteria

- Both SDK token-mint paths revalidate the same exact established account and owner after the provider call.
- A disconnect that commits during token mint produces `SDK_SIGN_IN_RECONNECT_REQUIRED` and no token reaches the caller.
- Existing intentional reconnect, passive resume, and provider lifecycle behavior remain unchanged.
- Focused tests, canonical verification, preliminary specialist review, final ReviewGPT, and required PR checks pass.

## Scope

- In scope: the shared device-sync public ingress SDK token owner and its focused race coverage.
- Out of scope: provider token revocation APIs, disconnect state-machine redesign, companion UI, health imports, and unrelated connection flows.

## Constraints

- Reuse the existing effect-time account/owner validation from the resume path.
- Do not hold a database lock across provider network I/O or add persisted state.
- Keep provider-specific behavior in provider-owned modules and the ingress lifecycle provider-agnostic.
- Keep this change isolated in its own stacked PR and do not merge it.

## Risks and mitigations

1. Risk: post-mint validation could reject an intentional fresh connection.
   Mitigation: validate against the exact account returned by the completed ensure step and cover the normal create path.
2. Risk: the two mint paths could drift again.
   Mitigation: extract one private validation helper used by both create and resume.
3. Risk: a unit test could model only a status toggle rather than the real race owner.
   Mitigation: pause the provider mint, mutate the stored account while it is in flight, and assert the returned promise rejects.

## Tasks

1. Add a focused failing public-ingress race test for the explicit create path.
2. Ask the round-3 ReviewGPT thread for a minimal patch and compare it with the local proof.
3. Implement the smallest shared effect-time validation and run focused plus canonical verification.
4. Commit, push, open a stacked PR, and complete preliminary specialist plus final ReviewGPT/CI gates.
5. Close the plan with the final scoped commit and leave the PR unmerged.

## Decisions

- Treat the finding as plausible pending focused reproduction because the resume path already documents and tests the same disconnect race while the explicit create path returns without re-reading.
- Keep the correction in `@murphai/device-syncd` so hosted and any future shared-ingress callers inherit one lifecycle rule.

## Verification

- Pre-fix focused reproduction: `pnpm exec vitest run packages/device-syncd/test/public-ingress.test.ts --no-coverage` failed only the new create/disconnect race with `Missing expected rejection`.
- Post-fix focused proof: the same command passed all 66 public-ingress tests.
- `pnpm --dir packages/device-syncd typecheck`: passed.
- `pnpm --dir packages/device-syncd test`: passed, 44 files and 864 tests.
- Canonical `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff packages/device-syncd/src/public-ingress.ts packages/device-syncd/test/public-ingress.test.ts`: the affected device-sync typecheck and 864 tests passed in the Testbox; the wider reverse-dependency lane failed later in unrelated hosted-local harness timing/Docker tests and a vault-usecases test whose generated Health Commons artifact was absent.
- Round-3 ReviewGPT implementation artifact: inspected in full and applied deliberately; it touched only the shared public-ingress source and reused one effect-time validator across both mint paths.
- Product-experience review: `NO FINDINGS`; explicit disconnect remains final authority, the existing reconnect-required outcome is the right recovery path, and intentional reconnect plus passive resume remain intact.
- Preliminary specialist ReviewGPT, parent final review, final canonical rerun, and exact-head PR gates: pending.
