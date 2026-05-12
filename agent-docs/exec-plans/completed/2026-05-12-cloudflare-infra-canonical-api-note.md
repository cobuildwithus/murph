# Cloudflare infrastructure canonical API guidance

Status: completed
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Add durable agent guidance in `AGENTS.md` so Cloudflare infrastructure work reads relevant Cloudflare documentation thoroughly and prefers the simplest canonical Cloudflare API or platform feature before custom infrastructure.

## Success criteria

- `AGENTS.md` contains a task-router note for Cloudflare infrastructure/platform API work.
- The note makes official-doc review and canonical Cloudflare APIs the default before bespoke coordination, storage, retry, or deployment machinery.
- Touched docs are read back and required verification is recorded.

## Scope

- In scope: `AGENTS.md`, this plan, and the coordination ledger row for the task.
- Out of scope: changes to Cloudflare runtime code, deployment scripts, or detailed platform policy docs.

## Constraints

- Technical constraints: keep `AGENTS.md` compact and route-oriented.
- Product/process constraints: preserve unrelated ledger rows and working-tree edits.

## Risks and mitigations

1. Risk: The new note duplicates detailed Cloudflare policy in the compact routing file.
   Mitigation: Keep the wording short and route future work to relevant docs instead of expanding implementation details here.

## Tasks

1. Register the task in the coordination ledger.
2. Add the Cloudflare infrastructure canonical API note to `AGENTS.md`.
3. Read back touched docs and run required verification.
4. Close the active plan through the repo finish script.

## Decisions

- Put the Cloudflare guidance in the task router because it is triggered by work type.

## Verification

- Direct readback: `AGENTS.md`, the active plan, and the coordination ledger contain the intended scoped guidance.
- `pnpm typecheck`: failed in existing Murph Age script work outside this docs change (`scripts/murph-age/r399-midus2-biomarker-increment.ts` missing `uniqueColumns` and one argument-count mismatch).
- `pnpm test`: failed in existing hosted-execution coverage (`test/hosted-execution.test.ts` expected `HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER`, received `undefined`).
Completed: 2026-05-12
