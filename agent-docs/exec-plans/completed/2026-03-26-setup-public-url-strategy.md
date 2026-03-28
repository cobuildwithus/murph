# Setup Public URL Strategy

## Goal

Add a small onboarding/setup guidance step that makes the transport split explicit:
- recommend hosted `apps/web` for WHOOP/Oura as the easy path
- recommend local tunnel mode for Linq
- avoid implying that Healthy Bob already provides a hosted Linq ingress

## Scope

- `packages/cli/src/setup-wizard.ts`
- `packages/cli/src/setup-cli.ts`
- focused `packages/cli/test/setup-cli.test.ts`
- setup-facing docs only if the new wording needs durable clarification

## Constraints

- Keep behavior/product scope unchanged; this is guidance only.
- Do not add hosted Linq routes, inbox bridge state, or new setup persistence.
- Preserve current channel provisioning, wearable readiness checks, and assistant auto-launch decisions.

## Success criteria

- Interactive onboarding surfaces one concise public-URL strategy section only when relevant.
- WHOOP/Oura guidance points to hosted `apps/web` first, tunnel as fallback.
- Linq guidance points to local+tunnel flow first.
- Post-setup CTA text aligns with the same split.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Outcome

- Added a conditional onboarding step that only appears when Linq or WHOOP/Oura require a public ingress plan and no hosted public base is configured.
- The wizard now recommends hosted `apps/web` for WHOOP/Oura and tunnel-first for Linq, while showing the exact local callback/webhook targets for tunnel mode.
- The Linq post-setup CTA now explicitly allows either the local listener or a tunnel that forwards to it.

## Verification Results

- `pnpm exec vitest run packages/cli/test/setup-cli.test.ts --no-coverage --maxWorkers 1` passed.
- `git diff --check -- packages/cli/src/setup-wizard.ts packages/cli/src/setup-cli.ts packages/cli/test/setup-cli.test.ts agent-docs/exec-plans/active/2026-03-26-setup-public-url-strategy.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm typecheck` passed earlier in the turn before this scoped patch landed.
- `pnpm test` and `pnpm test:coverage` still fail in existing unrelated `packages/cli/test/runtime.test.ts` cases outside this change.
- `pnpm --dir packages/cli typecheck` is not a reliable scoped signal in the current dirty tree because it fails on pre-existing workspace build/type drift unrelated to setup onboarding.
Status: completed
Updated: 2026-03-26
Completed: 2026-03-26
