# Tool failure diagnostics

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Outcome and boundaries

Delivered a telemetry-only patch at the existing automation and command issue
owners. No prompts, schemas, RPC content, success decisions, retries, scheduling,
product writes, dependencies or persistence changes. Efficiency-owned surfaces
and unrelated diagnostics remain unchanged. No production access or commit.

## Execution

1. Traced parser/dispatch, automation handlers, event CLI envelopes, the existing
   eight-issue consumer, sanitation, serialization and hosted export.
2. Added local finite automation branch details and a bounded event CLI category.
   Serialization failure retains its original RPC reply, separate from size failure.
3. Added synthetic production-function tests with fake ports and extended the
   existing escaped/oversized inspection test without weakening assertions.
4. Updated the assistant-engine README issue owner with aggregate SQL, denominator,
   lossy coverage, missing-versus-unknown evidence and natural-traffic verification.

## Validation and handoff

- Passed: 116 dependency-free production-function smoke assertions, plus 67
  composed sanitation/serialization and baseline-equivalence smoke assertions.
  Automation execution bodies were extracted unchanged for these checks; they
  do not replace repository parser/dispatch tests or required typechecking.
- Passed: changed TypeScript syntax/transpilation, excluded-surface comparison,
  whitespace/privacy inspection and pristine-source patch application checks.
- Pending: repository Vitest (new diagnostics test, automation inspection, hosted
  domain tools, durable follow-ups, onboarding, and product small seams),
  assistant-engine typecheck, `logs:guard`, `docs:drift` and `docs:gardening`.
  The archive lacks installed dependencies/lockfile, registry access is unavailable,
  and the required compiler/repo-tools are unavailable. No gate success is claimed.
- Plan closure was recorded directly because the repository closure helper could
  not load repo-tools. The local applying agent owns the pending integration gates;
  no live assistant journey or production failure injection is needed.
