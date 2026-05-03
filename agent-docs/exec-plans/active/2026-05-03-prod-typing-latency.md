# Trace and reduce hosted production typing latency

Status: active
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Trace why hosted production typing indicators appear several seconds after an inbound Murph message, then either land the smallest safe latency improvement or add privacy-bounded timing evidence that can identify the next bottleneck.

## Success criteria

- The production message-to-typing path is mapped with concrete file evidence.
- Any code change avoids raw provider payloads, message text, contact identifiers, secrets, and local path leakage.
- Focused tests cover changed timing, nudge, typing, or telemetry behavior.
- Required verification and completion audits pass or any unrelated blocker is documented.

## Scope

- In scope:
  - Hosted onboarding/webhook ingress nudge ordering for active-member conversation messages.
  - Cloudflare runner nudge admission and typing-start timing where directly coupled.
  - Assistant-runtime hosted typing helpers and privacy-bounded hosted runtime logs if needed.
  - Focused tests under the touched web/Cloudflare/runtime slices.
- Out of scope:
  - Broad hosted-runner architecture rewrites.
  - Changing canonical mailbox ownership or encrypted payload storage.
  - Persisting raw message content, provider payloads, phone numbers, chat ids, emails, or secrets.

## Constraints

- Technical constraints:
  - Apps web remains the canonical mailbox/control-plane owner; Cloudflare remains execution-only.
  - Durable retries must stay pointer-only and safe if direct nudge optimization is added.
  - Logs must be metadata-only and accepted by existing hosted runtime log parsers.
- Product/process constraints:
  - Preserve unrelated active ledger rows and keep the diff narrow.
  - Same-turn completion should close this plan and create a scoped commit if files change.

## Risks and mitigations

1. Risk: Reducing perceived latency weakens durable retry behavior.
   Mitigation: Keep Workflow or sweeper recovery as the retry backstop, and test fallback paths.
2. Risk: Timing traces leak sensitive channel or contact data.
   Mitigation: Use only coarse event codes, component/phase, mailbox lane/sequence, and bounded redacted JSON.

## Tasks

1. Map current inbound message append, workflow/direct nudge, runner invocation, and typing start paths.
2. Check available production-facing logs/status surfaces for timing evidence without exposing identifiers.
3. Land a narrow latency fix or telemetry addition.
4. Run focused verification and required completion audits.
5. Close the plan and commit the scoped change.

## Decisions

- Treat the likely bottleneck as the handoff before runner execution until code or production evidence proves otherwise.
- Prefer direct nudge with pointer Workflow fallback over adding any second queue/dispatch owner, if the current active-member path can support it safely.

## Verification

- Commands to run:
  - Focused tests for touched web/Cloudflare/runtime files.
  - `pnpm typecheck` or a documented scoped substitute if unrelated checkout failures block the full lane.
- Expected outcomes:
  - Tests prove nudge/typing/logging behavior and fallback semantics.
  - TypeScript accepts the touched surfaces.
