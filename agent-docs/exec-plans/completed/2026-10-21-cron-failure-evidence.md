# Preserve bounded scheduled failure evidence

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Goal and invariant

Preserve bounded original failure evidence on the existing scheduled completion
event, including maintenance consumed after provider admission. Preserve every
retry, replay, delivery, error classification, persisted run and summary decision.

## Owner and evidence

The execution catch replaces maintenance failure text with a replay-safety
explanation. Its result carries only the error code; the existing completion
event cannot distinguish provider capacity from a process or transport failure.
Existing action diagnostics measure work but do not preserve the original cause.
Synthetic injected failures will prove this gap without embedding production data.

Reuse the existing assistant failure classifier and cron completion event.
Carry only finite diagnostic enums, validated status values and booleans through
the in-memory result. Add no state owner, event, dependency, timer or I/O.

## Scope and constraints

- Internal telemetry only; no prompt, tool, model, billing or product changes.
- Keep provider-admission replay protection and foreground priority unchanged.
- Omit free text, private ids, original payloads and arbitrary context.
- Old runtime-log readers tolerate optional fields; no migration or backfill.
- Existing Standard-tier recovery work changes retry policy separately; its
  actual patch does not preserve maintenance completion failure context.

## Tasks

1. [x] Trace the original catch, execution result, completion event and hosted log.
2. [x] Obtain implementation and synthetic regression patch through ReviewGPT.
3. [x] Prove regression on the base, then tests/typecheck and parent review.
4. [x] Update the telemetry owner and finish parent candidate review.

## Verification results

- ReviewGPT implemented the projection and a bounded helper remediation.
- Six new synthetic cases fail on the original source for absent diagnostics.
- The corrected source passes 330 cron/failure tests and the composed hosted
  log redaction/parser checks; engine and runtime typechecks pass.
- Complexity guard passes with unchanged debt. Existing large cron execution
  and route-authorization functions are outside this diagnostic projection;
  no broader refactor is needed to preserve the failure boundary.
- Docs drift and whitespace checks pass. Only finite normalized cause fields
  cross the existing event; replay protection, persistence and outcomes remain.
- No provider input, prompt, UI or public changelog changes are required.

## Completion ownership

This plan records the completed implementation and local proof. The same task
owns final pushed-head ReviewGPT, required CI, merge, protected deployment and
read-only observation. Those external results are recorded in the PR and the
production-sweep memory, not retroactively inferred from these tests. Natural
maintenance failure traffic is required to confirm deployed diagnostic coverage;
silence is not recovery evidence.
Completed: 2026-10-21
