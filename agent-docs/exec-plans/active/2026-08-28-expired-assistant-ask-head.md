# Recover queues blocked by expired Assistant Ask content

Status: active
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Let a hosted system mailbox advance when an expired current-sender Assistant
  Ask can no longer persist its required fallback because content retention
  already retired the encrypted request.

## Success criteria

- New current-sender requests retain recoverable content only while their
  system sequence remains ahead of the durable consumed watermark and never
  beyond the existing 14-day privacy deadline, allowing the ordinary expired
  fallback to persist without extending other Assistant Ask retention.
- Already-retired legacy requests reach one explicit terminal state and leave
  the runtime queue without starting Codex.
- Ordinary `expired` and `unavailable` current-sender responses still retry
  rather than silently dropping the required fallback.
- Focused Web, runtime, protocol, PostgreSQL retention, typecheck, and required
  exact-head CI checks pass.
- The production mailbox advances after Web and hosted runtime deployment.

## Scope

- In scope: Assistant Ask retention, terminal control protocol, hosted runtime
  retirement, focused regression coverage, deployment, and live recovery proof.
- Out of scope: queue redesign, retention-policy expansion, new state owners,
  or changes to connected-health import semantics.

## Constraints

- Technical constraints: preserve one canonical mailbox state owner; derive
  settlement from the existing system-lane consumed watermark; preserve the
  14-day maximum content-retention deadline; remain safe under rolling Web,
  Worker, and container version skew.
- Product/process constraints: avoid sending a misleading very-late fallback
  when its encrypted source content is already irrecoverable; keep normal
  current-sender completion behavior unchanged.

## Risks and mitigations

1. Risk: a broad terminal exception could silently drop recoverable requests.
   Mitigation: permit retirement only for the exact `content_expired` reason
   and keep regression tests for ordinary terminal reasons.
2. Risk: retaining expired requests could broaden private-data retention.
   Mitigation: mark only current-sender admission at the mailbox owner, require
   its sequence to remain ahead of the existing durable consumed watermark,
   and keep the created-at privacy cutoff authoritative.

## Tasks

1. Prove the coupled-state failure from production state and code paths.
2. Add the smallest explicit terminal state and bounded retention correction.
3. Verify every owner boundary and rolling-version behavior.
4. Merge, deploy, and prove the affected mailbox advances.

## Decisions

- Use the existing mailbox item as the sole durable owner; add no repair queue
  or reconciliation service.
- Treat retired encrypted content as distinct from ordinary request expiry
  because only the former makes the required fallback impossible to persist.

## Verification

- Commands to run: focused Vitest suites for Web control, PostgreSQL retention,
  runtime dequeueing, and protocol parsing; package typechecks; docs drift;
  required exact-head CI; bounded production mailbox and runtime-log queries.
- Expected outcomes: tests and checks pass; content remains available for
  ordinary expiry recovery but retires at the privacy deadline; the legacy
  head leaves the local queue and the production lane resumes advancing.
