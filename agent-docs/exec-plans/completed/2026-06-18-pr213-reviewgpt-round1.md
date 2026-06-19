# PR 213 ReviewGPT Round 1 Fixes

Status: completed
Created: 2026-06-18
Updated: 2026-06-17

## Goal

- Resolve verified ReviewGPT round-1 findings for PR 213 with the smallest maintainable changes.

## Success Criteria

- Message outbox records stay rollback-safe for existing v1 readers.
- Unsupported reaction tooling is not advertised to Codex until a real adapter supports reactions.
- `finish_without_reply` applies only to the delivery context it selected.
- Focused tests, typecheck, completion audits, commit/push, and the next ReviewGPT round complete.

## Scope

- In scope: assistant outbox persistence, Codex dynamic-tool registration/prompt guidance, final-action delivery-context handling, the CLI JSON-RPC dynamic-tool contract, and focused tests.
- Out of scope: implementing provider-native reaction support or broad outbox representation refactors.

## Constraints

- Preserve simple existing seams; avoid a migration service or speculative adapter abstraction.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

## Risks And Mitigations

1. Risk: rollback/mixed-version outbox readers can lose pending messages.
   Mitigation: serialize message intents as legacy v1 while keeping current readers v1/v2-capable.
2. Risk: no-reply or reaction side effects can bind to the wrong steered message.
   Mitigation: scope side-effect patches by delivery context ordinal and test the steer cases.

## Tasks

1. Patch source behavior at the existing boundaries.
2. Add focused regression tests for the accepted findings.
3. Run required verification and completion audits.
4. Commit, push, and start ReviewGPT round 2.

## Decisions

- Rejected broad provider reaction implementation until a real channel adapter can support it.
- Rejected a broad outbox internal-type rewrite for this pass; the rollback bug is fixed at the persistence serializer boundary.

## Verification

- Commands to run: focused assistant/operator tests, `pnpm typecheck`, `pnpm test:diff` or package coverage, completion audits, and ReviewGPT round 2.
- Expected outcomes: all required checks pass and ReviewGPT reaches no accepted findings or returns only rejected/out-of-scope findings.
- Results before close:
  - Focused assistant-engine regression suite passed: 108 files, 1379 tests passed, 3 skipped.
  - Focused CLI Codex suite passed: 110 files, 997 tests passed.
  - Scoped `scripts/workspace-verify.sh test:diff ...` passed across affected package typechecks/tests and Cloudflare fast verification.
  - Security/privacy review found no medium-or-higher findings.
  - Coverage/deep-review pass added scoped reaction proof and found no remaining medium-or-higher issue in the changed paths.
Completed: 2026-06-17
