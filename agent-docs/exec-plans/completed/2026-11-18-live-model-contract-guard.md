# Alert operators when the model provider rejects replies

Status: completed
Created: 2026-11-18
Updated: 2026-11-18

## Goal

- On 2026-11-18 the model provider rejected every GPT-6.2 request the new
  runner image built, so members on those models got no replies until a person
  noticed. No alert read foreground reply failures. Send operators one email
  when this class of failure starts. The bug itself was fixed in #5185.

## Success criteria

- A rejected foreground reply sends one operator email within one cron period.

## Scope

- In scope: a Web runtime-log alert in the existing five-minute cron, and its
  runtime-log docs.
- Out of scope: the catalog fix (#5185); the CI wire-contract test and the Sol
  and Astra release admission turns (#5186); any new CI secret or paid per-PR
  check.

## Constraints

- Product/process constraints: no production changes, no new spend or secrets
  without the owner, no real member data in tests or docs.

## Risks and mitigations

1. Risk: the 30-minute window clears an incident while no member writes, then
   reopens it on the next rejected reply.
   Mitigation: accepted; each reopening is one email, and the reminder interval
   bounds repeats while rejections continue.

## Tasks

1. Reproduce the provider rejection locally with the pinned Codex and the
   pre-fix catalog, with passing controls. Done.
2. Web provider request rejection alert. Done.
3. Docs, verification, PR. Done.

## Decisions

- Built: Web alert on `input.reply-failed` rows with `turn_failed`,
  `failureRetryable: false` and zero provider actions. Seven days of production
  rows held this shape only during the incident (7 rows, first at 17:43:58Z).
- Dropped after review: this branch's own stub digest rule, contract test and
  per-model deploy smoke. #5186 merged first with a required CI wire-contract
  step and live Sol and Astra admission turns on the release candidate, so the
  branch took main's version of every shared file and keeps only the alert.
- Not built, owner decision: deploy-time live turns for the product models
  #5186 does not probe, and a paid per-PR live check for Codex pin, catalog and
  provider-config changes.
- Final ReviewGPT round 1 reviewed the full pre-merge patch, alert included,
  and passed. The later change only removes the duplicated parts.

## Verification

- Reproduction with the production config builder against the real provider:
  the pre-fix catalog passes Luna and fails Sol and Astra with the incident's
  400; the fixed catalog passes Sol and Astra.
- Web alert unit, cron and Postgres tests pass. Web typecheck passes.
- The alert's predicate, run read-only over seven days of production rows,
  matched only the incident.
Completed: 2026-11-18
