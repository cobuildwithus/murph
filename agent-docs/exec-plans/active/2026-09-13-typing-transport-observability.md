# Restore typing handoff and diagnose stalled provider transport

Status: active
Created: 2026-09-13
Updated: 2026-09-13

## Goal

Restore typing across attachment preparation, delivery, and the next turn. Make
warm Codex transport stalls diagnosable and obtain a bounded-recovery recommendation.

## Success criteria

- Production runtime/bridge composition reuses one accepted typing session and
  releases it for the next reply; pending and aborted starts preserve authority.
- Thread-scoped transport warnings survive warm reuse as metadata only. Unscoped
  output and requests remain rejected. Timing and correlation reveal stalled phases.
- Focused tests, typechecks, parent review, final ReviewGPT and exact-head CI pass.

## Scope

- In scope: existing typing fix, stronger regression proof, bounded diagnostics,
  ReviewGPT transport advice, and the requested PR.
- Out of scope: production deployment, private member/provider probes, model or
  prompt changes, and a second retry/session/state owner.

## Constraints

- Use existing guarded provider authority, per-chat typing claim, and provider
  trace projection. Diagnostics cannot block provider start or delivery.
- No production rows, transcripts, credentials or identifiers in artifacts.

## Product UX

- Outcome: attachment typing continues through the reply and starts on the next turn.
- Reaches: eligible private and authenticated group attachment conversations.
- Proof: composed runtime/bridge/provider acceptance and cancellation/denial cases.

## Risks and mitigations

1. Thread-scoped warnings must not authenticate turn output. Emit only fixed
   metadata after matching the bound thread and observing the current turn start.
2. Lower timeouts can interrupt healthy reasoning or replay effects. Obtain
   source-grounded advice, preserve native recovery, and distinguish idle versus
   total latency bounds. No unproved timeout change belongs in the typing fix.

## Tasks

1. Request ReviewGPT advice using current source and synthetic timing examples.
2. Fix warm transport diagnostics and strengthen typing regression scenarios.
3. Verify tests, typechecks, complexity, privacy and product behavior.
4. Open the PR, run final review concurrently with CI, and close this plan.

## Decisions

- The existing abort wrapper is the typing handoff mismatch; preserve exact fetch
  identity through import context. No new persisted state or timer is needed.
- Native fallback warnings lack a turn ID and are dropped by the warm filter.
  Request-only POST telemetry cannot explain preceding WebSocket activity.
- Optional metadata remains compatible with old readers. No migration or coordinated
  deploy is required; live typing and transport proof remain post-release checks.

## Verification

- Warm-session regression failed before the diagnostic fix: zero fallback events.
  Engine runtime suite passed 47 tests; the added throwing-sink variant also passes.
- Three composed attachment scenarios exercise the real importer and Linq HTTP
  adapter through the runtime entrypoint and bridge. All three failed at handoff
  with the fix removed and pass with the guarded provider capability preserved.
- Existing runtime authority, attachment activity and event projection tests: 104 passed.
- Engine and runtime typechecks passed. Complexity debt decreases by two in the
  engine event owner; runtime and bridge debt remain unchanged.
- No real-model journey is required: these changes affect deterministic typing
  wiring and diagnostic projection, not prompts, tools, interpretation or reply prose.
- Product UX: Ready for private, authorized group, early acceptance, pending acceptance,
  next-turn restart, missing-provider and aborted-invocation scenarios.
- ReviewGPT consultation completed using GPT-6 Pro with the source snapshot.
  Recommendation: native HTTPS first, 20-second stream idle, zero stream retries,
  existing HTTP request retries retained. This is not a total reply bound; shared
  provider/operator scope, quiet reasoning, compaction and native recovery require
  qualification. Timeout policy is a follow-up to this typing/diagnostic PR.
  The diagnostic patch labels source scope separately from observed active-turn
  correlation so thread warnings do not masquerade as turn-specific proof.
  Final PR review, exact-head CI and plan closeout remain pending.
