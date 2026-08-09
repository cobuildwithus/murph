# Typing prewarm observability

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Make Linq typing-start shell prewarming causally measurable against the next
  hosted ingress latency trace.
- Distinguish admission skips, an asynchronously issued container start, a
  superseded hint, and a failed hint using metadata-only bounded outcomes.
- Add no new network call, awaited logging operation, durable product state,
  or message-critical-path wait.

## Success criteria

- The existing Web-to-Cloudflare prewarm request returns its immediate bounded
  admission outcome without waiting for container startup.
- The container emits one metadata-only completion/failure record after the
  already-asynchronous prewarm operation settles.
- A fresh runtime start that consumes a prior prewarm observation carries its
  trigger source, causal hint timing, and single terminal outcome into the
  existing latency phase breakdown.
- Repeated typing hints coalesce into one bounded observation instead of one
  completion log per provider event or multiple mixed operation outcomes.
- The aggregate report selects one exact direct ingress/reply attempt and omits
  onboarding instant-start, unknown-source, backlog, ambiguous, and handoff
  traces rather than attributing them to typing.
- Focused tests prove the response still settles before the container-start
  promise, no extra request is made, and no member or provider identifier enters
  the new telemetry fields.

## Scope

- Existing Linq typing shell-prewarm Web helper and Cloudflare control client.
- Existing UserRunner admission, runner-container prewarm/readiness seam, and
  hosted ingress latency phase-breakdown schema.
- Focused Web, hosted-execution, and Cloudflare tests plus current owner docs.

## Constraints

- Keep the HTTP `202` response fast; actual container start remains
  asynchronous and authoritative readiness remains owned by the normal runtime
  start.
- Reuse existing RPCs, structured logging, and phase-breakdown persistence.
- Telemetry contains only bounded enums, safe counters, and epoch/duration
  numbers. Do not add raw user, chat, event, mailbox, or container identifiers.
- Missing or lost best-effort telemetry must never change reply behavior.

## Tasks

1. [done] Confirm the current admission, async start, readiness, and
   latency-trace propagation boundaries.
2. [done] Add immediate admission outcomes and async completion diagnostics.
3. [done] Attach consumed prewarm observations to the next fresh-start latency
   trace with no new I/O.
4. [done] Add focused behavior, privacy, and no-extra-wait verification.
5. [done] Commit, push, open a PR, and complete the required specialist,
   ReviewGPT, CI, and parent-review gates.

## Decisions

- Do not infer correlation from timestamps across Vercel and Cloudflare logs;
  carry the observation through the already-existing named container readiness
  response instead.
- Keep the observation in runner-container memory. It is diagnostic, bounded to
  the next authoritative readiness call, and may be absent after eviction.
- Do not add a telemetry table, queue, analytics binding, callback, or polling
  request.
Completed: 2026-08-09
