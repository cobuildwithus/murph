# Get hosted-local E2E passing

Status: active
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Make the hosted-local end-to-end suite pass from the repo root command.

## Success criteria

- Reproduce the failing hosted-local E2E command and identify the root cause from logs/code.
- Land the smallest scoped fix needed for the failing hosted-local scenario(s).
- `pnpm hosted-local e2e` passes locally, unless an external prerequisite is unavailable and a narrower truthful hosted-local proof plus the blocker is recorded.
- Required repo verification for touched files passes.

## Scope

- In scope:
- Hosted-local E2E harness, scripts, app/runtime code, or focused tests directly needed to make the hosted-local suite green.
- Out of scope:
- Broad hosted-runner rewrites unrelated to the failing hosted-local evidence.
- Production deploy changes unless the failure proves a deploy/runtime contract bug.

## Constraints

- Technical constraints:
- Preserve existing hosted runtime, Cloudflare, and web trust boundaries.
- Do not expose secrets, local usernames, home paths, raw auth headers, or personal identifiers in logs, docs, commits, or test output.
- Product/process constraints:
- Coordinate with overlapping active hosted runner plans before touching their files.
- Same-turn completion should use `scripts/finish-task` unless overlapping dirty work blocks a safe scoped commit.

## Risks and mitigations

1. Risk:
   Hosted-local failures may overlap active Cloudflare runner work in the ledger.
   Mitigation:
   Use failure evidence to scope edits narrowly; stop and report if fixing requires unsafe overlap.
2. Risk:
   E2E logs may contain sensitive local paths or identifiers.
   Mitigation:
   Inspect and summarize logs without copying sensitive values into repo artifacts or handoff.

## Tasks

1. Run hosted-local E2E and capture the failing scenario.
2. Trace the failing code path through harness/app/runtime code.
3. Implement the smallest fix and focused regression coverage.
4. Run hosted-local E2E plus required scoped/repo verification.
5. Run mandatory completion audits and finish with a scoped commit if safe.

## Decisions

- Use root `pnpm hosted-local e2e` as the primary success command because the user asked for hosted local E2E tests fully passing.

## Verification

- Commands to run:
- `pnpm hosted-local e2e`
- `pnpm typecheck`
- Additional focused owner tests once touched files are known.
- Expected outcomes:
- Hosted-local E2E suite exits 0.
- Typecheck and focused tests exit 0, or any unrelated pre-existing failure is explicitly identified.
