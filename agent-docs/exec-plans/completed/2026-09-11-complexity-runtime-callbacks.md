# Simplify hosted callback provider-entry policy

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Reduce duplicated hosted provider-entry policy while preserving delivery authority,
fallback persistence, error precedence, and ambiguous-provider retry behavior.

## Scope and architecture

- Own only hosted-runtime/callbacks.ts and focused callback regression proof.
- Reuse the existing outbox compare-and-save fallback owner; centralize its four
  identical persist-then-retry transitions in one private helper.
- Collapse redundant Telegram missing-authority branches and repeated Linq
  attachment reservation guards. Keep decisions beside their existing owners.
- No new product behavior, state, dependency, generic framework, or provider call.
- Preserve all existing auth/freshness checks, clock inputs, error text, catch
  boundaries, provider checkpoints, and outbox compare-and-save semantics.

## Risks and mitigation

- Fallback retry must follow durable persistence, including failures and races:
  retain the existing persistence helper and await ordering at each caller.
- Telegram exemptions and denial precedence must remain exact: retain the same
  authority predicate inside one missing-authority branch.
- Ambiguous Linq outcomes must retain claim protection: preserve PUT exemption,
  HTTP status ranges, explicit provider-skip flags, and later error precedence.

## Tasks

1. Inspect current source, owner docs, and existing composed callback tests.
2. Implement the bounded duplicate collapse and inspect the complete diff.
3. Run the complete callback suite, package typecheck, and complexity guard.
4. Record evidence, archive this implementation plan with a scoped commit,
   push, and open a draft PR for parent-owned review and final gates.

## Verification

- Full hosted-runtime-callbacks.test.ts suite with one worker.
- Assistant-runtime typecheck with one package checker.
- pnpm complexity:diff and exact base/head file debt comparison.
- Privacy inspection and clean scoped Git handoff.

## Completion ownership

The parent owns candidate review, Ready, ReviewGPT, exact-head CI, and merge.
This plan closes when implementation and local proof are complete; external
completion gates remain pending in the draft handoff.

## Implementation results

- Added one private persist-then-retry helper used at all four identical
  provider-entry fallback transitions. The existing outbox CAS owner is intact.
- Removed the redundant Telegram no-authority exemption and shared Linq
  attachment POST/http/numeric guards without changing exception precedence.
- Extended the composed attachment outcome test with HTTP 299, 408, and 499.
- Full callback suite: 288 tests passed with one worker.
- Assistant-runtime typecheck: passed with one package checker.
- Complexity guard: passed against base 3fcb0ab14d8137af4d4858ad030de8ab2c904970.
  File debt 164 to 157; maximum remains 73. Telegram authority 47 to 43;
  Linq ambiguity classification 32 to 29.
- Source change: 30 added, 48 deleted lines. Tests: 21 added lines.
- Parent inspected the candidate source/test diff; final review and exact-head
  external gates remain parent-owned after the draft PR handoff.
- No new repository-actionable friction; Frog inventory inspected.
Completed: 2026-09-11
