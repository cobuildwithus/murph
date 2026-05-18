# Hosted Local Reminder E2E

Status: active
Created: 2026-05-15
Updated: 2026-05-15

## Goal

Add or tighten hosted-local end-to-end coverage for scheduled reminders so a reminder created in Murph is exercised through hosted notification delivery and the scheduled wake path.

## Success Criteria

- Hosted-local reminder coverage drives the scheduled/alarm wake path, not only a manual runner invocation.
- The scenario proves the due reminder is converted into an assistant notification and sends the expected Linq reply.
- The focused hosted-local scenario is wired into the relevant hosted E2E command/workflow surface.
- Required focused verification passes, or unrelated blockers are recorded.

## Scope

- In scope:
  - Existing hosted-local Linq scheduled reminder E2E.
  - Hosted-local E2E scenario registry/workflow docs needed to run the scenario.
- Out of scope:
  - Broad hosted runner rewrites.
  - Production Cloudflare deploy behavior changes.
  - Live Linq, OpenAI, or Cloudflare calls.

## Constraints

- Preserve hosted web as product/control owner and Cloudflare as execution owner.
- Keep logs and artifacts redacted; do not expose secrets, local paths, usernames, provider payloads, or raw message bodies.
- Coordinate with overlapping active hosted-local and hosted runner work; stop if the required fix needs broad overlap.

## Tasks

1. Inspect existing scheduled reminder scenario and hosted-local test routes.
2. Update the scenario to use the scheduled alarm wake path and assert notification lifecycle evidence.
3. Wire the reminder scenario into hosted E2E CI/docs if missing.
4. Run focused hosted-local and repo verification for touched files.
5. Complete required review/audit/commit workflow or report blockers.

## Verification

- Planned:
  - `pnpm hosted-local e2e linq-scheduled-reminder`
  - `bash scripts/workspace-verify.sh test:diff <touched paths>`
  - Additional focused tests if CI/workflow generation or route behavior changes require them.
