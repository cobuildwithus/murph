# Correlate typing and mailbox runtime timing

Status: completed
Created: 2026-10-11
Updated: 2026-10-11

## Goal

Distinguish Worker processing from runtime request/continuation delay, and expose
when fetched mailbox payloads become ready for import, without changing behavior.

## Success criteria

- One random UUID joins runtime and Worker logs for each typing-start request.
- A mailbox fetch's logical request has correlated Worker timing and runtime
  fetch/decode/import-readiness measurements, including failure outcomes.
- IDs are diagnostic only, strictly validated, and stripped before provider or
  Web forwarding. No message contents, chat identifiers, or credentials are logged.
- Call counts, bodies, response identity, retries, abort behavior and authority
  are unchanged; focused tests, typecheck, complexity, review and CI pass.

## Scope

- In scope: existing Cloudflare runtime fetch ports, egress and mailbox logs,
  synthetic boundary tests and the diagnostics contract.
- Out of scope: reply behavior, timeout/retry policy, alert thresholds, production
  replay, credential expansion, and independent production deployment.

## Evidence gap

Existing Worker success logs record server durations and Worker-only request IDs.
Runtime milestones record when a promise continuation resumes. Without a shared
request key, nearby events cannot prove provider latency for an exact input.
Existing mailbox staging milestones omit the container fetch/decode/readiness span.
Historical gaps cannot be reconstructed by adding future diagnostics.

## Design

- Reuse the existing UUID correlation-header pattern and structured log emitter.
- Generate typing IDs only for requests classified by the existing Linq route
  policy under the configured/default provider base; do not add egress authority.
- Mint one mailbox ID per logical port fetch. Its existing retry may produce
  multiple Worker records, so do not treat its total as one physical round trip.
- Worker logs attach the native validated attempt identity for incident joins.
- Runtime elapsed durations use the monotonic clock; epoch markers position
  phases. Cross-host epoch differences alone do not prove event-loop delay.
- Reuse existing Worker authorization/upstream and mailbox timing fields. Add no
  network calls, waits, timers, state store or persistent protocol version.

## Risks and mitigations

- Diagnostic headers leaking upstream: strip at the existing egress boundary and
  prove Web's forwarding header allowlist excludes them.
- Invalid caller IDs or private values entering logs: accept UUID-v4 shape only;
  runtime overwrites caller-supplied IDs and test malformed values.
- Instrumentation changing semantics: preserve response identity, errors, signals,
  callback bodies and call counts in executable tests.

## Tasks

1. Verify existing diagnostic coverage and correlation gaps through bounded reads.
2. Add narrowly scoped measurements and synthetic tests.
3. Validate, review the candidate, publish the PR and finish required gates.
4. Coordinate any rollout through the designated deployment owner.

## Verification

- Focused Cloudflare provider, mailbox and correlation/privacy tests.
- Cloudflare typecheck with prepared Prisma client; complexity and docs checks.
- Exact-head external review and required CI before merge.

## Implementation result

- Added runtime/Worker correlation for typing starts and logical mailbox fetches,
  keeping native authority, upstream calls, retries and response handling intact.
- All 263 focused tests across provider egress, mailbox decode composition and
  the mailbox runtime port pass. Composed tests prove response/error identity,
  cancellation, retry correlation, header stripping and synthetic privacy.
- Cloudflare typecheck, docs drift and complexity ratchet pass. Existing
  hotspots remain unchanged: provider diagnostic emitter 22, Linq policy 25,
  Web-control handler 37 and Web-control transport attempt 40. Larger refactors
  would widen this diagnostic-only patch without supporting its claim.
- Changelog and model-input journey are not applicable: internal diagnostics
  do not change member behavior, prompts, tools or provider-visible message data.
- Deployment is delegated: Worker-first activation is required before runtime
  emitters for header stripping; existing runtimes work without the new fields.
  Exact-head external review and CI remain PR completion gates, and production
  correlation can be verified only after an authorized rollout.
Completed: 2026-10-11
