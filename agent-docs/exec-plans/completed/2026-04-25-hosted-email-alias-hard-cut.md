# Hard-cut hosted email aliases to 128-bit route keys

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Hard-cut hosted reply aliases to the greenfield 128-bit route-key format.
- New aliases must derive a 32-hex stable lookup key and mint only current `u2` route tokens; old 64-bit `u-...` route tokens and 16-hex lookup-prefix fallback must stop resolving.

## Success criteria

- `deriveStableHostedEmailKey` returns a 32-hex key.
- `createHostedEmailRouteToken` mints only `u2-<25 base36>-<25 base36>` tokens for 32-hex alias keys and refuses short keys.
- `parseHostedEmailRouteToken` accepts only valid current tokens and rejects former `u-<16hex>-<32hex>` route tokens.
- Hosted web route lookup remains exact-key only; 16-hex inputs do not prefix-search upgraded 32-hex rows.
- Focused Cloudflare and hosted-web routing tests pass, with repo-wide or scoped verification blockers recorded if they are unrelated to this slice.
- Required security/privacy, coverage, and final-review passes complete before commit.
- Create a scoped commit and push it, per the user's explicit instruction.

## Scope

- In scope:
  - `apps/cloudflare/src/hosted-email/route-crypto.ts`
  - `apps/cloudflare/test/hosted-email-route-helpers.test.ts`
  - `apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts`
  - `apps/web/test/hosted-onboarding-member-store.test.ts`
  - This execution plan and the coordination ledger rows needed to avoid stale overlapping work.
- Out of scope:
  - Hosted email sender-auth changes, raw email persistence, Cloudflare wake/nudge behavior, route-registration surfaces, and Health Commons research/content work.
  - Any legacy alias migration path; the repo is greenfield for this behavior.

## Constraints

- Technical constraints:
  - Reply aliases must fit under the email local-part budget when formatted as `<localPart>+<token>`.
  - The route token signature comparison must remain constant-time for valid-length current signatures.
  - Do not log or fixture raw addresses, message contents, secrets, or local paths.
- Product/process constraints:
  - Preserve unrelated dirty-tree edits and active ledger rows.
  - User explicitly requested a hard cut, commit, and push.

## Risks and mitigations

1. Risk: Accidentally preserving a legacy parser or web prefix fallback keeps the 64-bit collision surface alive.
   Mitigation: Delete the legacy branch and add explicit rejection tests for former `u-...` tokens and 16-hex lookup inputs.
2. Risk: 128-bit hex route tokens exceed practical reply-alias length budgets.
   Mitigation: Keep fixed-width base36 encoding for the 128-bit alias key and signature, producing a 64-character local part with the current configured local part.
3. Risk: Concurrent hosted-email work overlaps this trust-boundary seam.
   Mitigation: Register the hard-cut row, remove the stale planless route-token row, and keep edits limited to the crypto and exact lookup surfaces.

## Tasks

1. Remove legacy route-token minting/parsing and keep current token signing on the `u2:<aliasKey>` payload.
2. Remove hosted-web prefix fallback for 16-hex reply-alias lookup keys.
3. Update focused tests for current token shape, short-key rejection, former-token rejection, exact lookup, and no prefix fallback.
4. Run focused tests, diff checks, typecheck/scoped verification where possible, and required audits.
5. Close the plan with a scoped commit and push the branch.

## Decisions

- Use a greenfield hard cut with no compatibility parser and no lookup-prefix bridge, per user instruction.
- Keep fixed-width base36 route-token segments so 128-bit alias keys fit in the reply alias local part.
- Treat the stale `hosted-email-route-token-hardening` ledger row as superseded by this hard-cut plan because its active plan file is absent and its intended seam is fully covered here.

## Verification

- Commands run:
  - `pnpm exec vitest run apps/cloudflare/test/hosted-email-route-helpers.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage`
    - Passed: 1 file, 11 tests.
  - `pnpm exec vitest run apps/web/test/hosted-onboarding-member-store.test.ts --config apps/web/vitest.config.ts --no-coverage`
    - Passed: 1 file, 38 tests.
  - `git diff --check -- apps/cloudflare/src/hosted-email/route-crypto.ts apps/cloudflare/test/hosted-email-route-helpers.test.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts apps/web/test/hosted-onboarding-member-store.test.ts agent-docs/exec-plans/active/2026-04-25-hosted-email-alias-hard-cut.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
    - Passed.
  - `pnpm typecheck`
    - Failed before this alias slice in `apps/web` `health-commons:generate`: `protocol_variant:evening-screen-curfew/digital-sunset` research-landscape source `source_artifact:doi-10.55489/njcm.151020244192` lacks a matching evidence-appraisal edge.
  - `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/hosted-email/route-crypto.ts apps/cloudflare/test/hosted-email-route-helpers.test.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts apps/web/test/hosted-onboarding-member-store.test.ts`
    - Failed before this alias slice during `apps/cloudflare verify` on the same unrelated Health Commons generation invariant.
- Expected outcomes:
  - Focused Vitest and diff checks pass.
  - Existing unrelated blockers, if still present, are recorded with the failing target and why this hard-cut diff did not cause them.
Completed: 2026-04-25
