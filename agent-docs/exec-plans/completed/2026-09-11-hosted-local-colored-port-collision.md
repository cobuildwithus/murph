# Preserve colored hosted-local port-collision recovery

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Preserve hosted-local startup's existing bounded port-collision recovery when
  a child process styles its diagnostic with terminal control sequences.

## Success criteria

- A colored child address-in-use error survives verbose output as the existing
  plain retry marker; ordinary startup failures still fail without retry.
- The outer startup owner keeps three attempts, fresh reservations, and owned cleanup.
- Focused harness/helper tests, relevant typechecks, complexity, and docs checks pass.

## Scope

- In scope: child diagnostic classification and focused regression evidence.
- Out of scope: port allocation, timeouts, retry policy, production behavior,
  provider requests, diagnostic retention/redaction, and workflow dispatches.

## Constraints

- Use Node's existing stripVTControlCharacters utility only for classification.
- The parent owns candidate review, PR admission, final review, and shipping.

## Risks and mitigations

1. Terminal styling can hide an existing collision token at a regex word boundary.
   Strip controls before the existing expressions; test each supported token.
2. A recovery fix could accidentally widen retries or obscure unrelated failures.
   Preserve the current classifier, attempt cap, cancellation, and cleanup owners.

## Tasks

1. Done: reproduced the styled-output defect in the existing child-exit readiness test.
2. Done: normalized only classifier input; added real child-buffer and outer retry proof.
3. Done: focused verification and scope/privacy inspection. Parent reviewed all
   seven scoped files and approved the candidate without blockers.
4. Approved for plan-wrapper closure, scoped commit, and draft PR handoff.

## Decisions

- The current child buffer retains ANSI, while its word-boundary expressions
  miss a bold prefix immediately before Address. The original port contender
  is not established; no checkpoint-ordering business assertion was reached.
- No new state, dependency, retry loop, production branch, or runtime protocol.
- Internal harness correction: no member-visible changelog entry required.

## Verification

- Before source correction, the focused child-exit regression failed for all
  three styled forms while the unstyled address case passed.
- `pnpm --dir packages/hosted-local-harness test test/dev-hosted-local/stack.test.ts test/dev-hosted-local/runtime.test.ts`: 103 passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.test.ts`: 23 passed.
- `pnpm --dir packages/hosted-local-harness typecheck`: passed.
- `pnpm --dir apps/web prisma:generate`, then `pnpm --dir apps/cloudflare typecheck`: passed.
- `pnpm complexity:diff`: passed; existing source debt and maximum unchanged.
- `pnpm docs:drift`, `pnpm docs:gardening`, and `git diff --check`: passed.
- Required exact-head CI and protected scenario proof remain parent-owned.
- Local evidence proves classification and retry handoff. It does not identify
  the original port contender or prove the checkpoint-ordering business journey.
Completed: 2026-09-11
