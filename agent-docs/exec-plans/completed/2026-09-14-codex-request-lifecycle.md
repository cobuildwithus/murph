# Trace Codex request acknowledgement and response receipt

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

- Distinguish provider acknowledgement, response output at the relay, downstream
  forwarding, and output consumed by the active Murph turn without logging content.
- Test whether a 20-second stream idle limit interrupts healthy provider silence
  or long tool execution; retain the production 90-second setting.

## Success criteria

- Content-free correlated milestones survive the existing runtime-log projection.
- Metadata, prewarm, overlapping requests, stale turns, and diagnostic failures
  cannot fabricate acknowledgement or alter relay/reply behavior.
- Focused relay, Worker, native Codex, runtime projection tests and owner
  typechecks pass. Real-duration timeout comparisons report their limits.

## Scope

- In scope: existing relay diagnostics, active-turn receipt timing, regression
  tests, native timeout experiments, and the observability owner documentation.
- Out of scope: timeout/configuration changes, new retries, connection probes,
  transport policy changes, production mutation, or provider-content capture.

## Constraints

- Native Codex remains the response, transport, continuation, and retry owner.
- Diagnostics use bounded parsing, constant-size state and fixed milestones.
  Existing four-write cap, write fences, and relay drain ordering remain intact.
- The Worker owns relay observations; the engine owns scoped native receipts;
  assistant-runtime owns the allowlisted durable projection.

## Risks and mitigations

1. Request attribution can be ambiguous across queued or overlapping frames.
   Mark ambiguity explicitly and retain observed-boundary meaning.
2. A downstream send is not proof of native receipt.
   Emit active-turn receipt timing separately and preserve this distinction.
3. Quiet reasoning and failed generation can have identical wire histories.
   Synthetic long-response tests establish interruption mechanics, not live
   latency distributions or a universal safe threshold.

## Tasks

1. Extend bounded relay observations and active-turn receipt projection.
2. Add regression proof for attribution, privacy, bounded emission and failures.
3. Run native healthy-silence and long-tool comparisons at 20 and 90 seconds.
4. Run owner typechecks and complexity review; update owner docs and complete
   the scoped commit and applicable PR review workflow.

## Decisions

- Existing first-frame diagnostics lose acknowledgements after metadata.
- Pinned Codex includes client_metadata.turn_id; use its existing numeric
  SHA-256 turn-correlation convention without logging provider identifiers.
- No model behavior or provider-visible request fields change.

## Verification

- Focused Node/Worker relay, engine native fixture and runtime projection tests.
- Owner typechecks and pnpm complexity:diff.
- Expected: correct boundary evidence, unchanged successful replies/continuation,
  and explicit timeout tradeoffs rather than a claim that silence proves failure.

## Local evidence and decisions

- Native Codex 0.153.4, scripted localhost provider, no production or live model
  requests: a 22-second acknowledged silence completes in 22,428 ms at a 90-second
  idle limit. At 20 seconds, both healthy WebSocket and HTTPS attempts time out,
  failing after 40,320 ms. A 22-second native tool completes in 22,986 ms at 20 seconds.
- Keep the production 90-second setting. These tests establish interruption
  mechanics, not a live provider silence distribution or the historical delay's cause.
- Full-duration native comparison: 4 passed. Default short comparison: 3 passed;
  the intentionally opt-in long comparison is skipped by default.
- Native turn and existing stall regression files: 55 passed, 1 opt-in skipped.
  Node relay: 37 passed. Runtime projection: 73 passed. Worker route: 10 passed, including real parsing,
  delayed persistence, and content-free lifecycle records.
- Engine, runtime, and Worker typechecks passed. Complexity diff passed with no
  increased debt; existing large turn/lifecycle functions retain their ownership.
- Local parsing benchmark: 6,000,037-character request inspection averaged 4.65 ms;
  60,048-character provider frame inspection averaged 0.038 ms. This isolates the
  new helper on the local host, not Worker CPU or end-to-end reply latency.
- No new awaited database, provider, or network operation. At most six extra
  relay observations per request and two native receipt observations per turn;
  the existing four-write cap and best-effort persistence remain unchanged.
- Changelog: not applicable; internal diagnostics and local test fixtures only.
- Parent review: bounded parsing and state, scope fencing before native receipts,
  captured relay observations across queueing, privacy, old/new optional log
  fields, unchanged auth/accounting drains and native retry ownership inspected.

## Completion

- ReviewGPT round 1 passed on 874a779ec592a559f5942c0e34c415ec75ff4082;
  gpt-6-pro and response identity validated. The review independently ran 12
  direct-source relay/observer checks and found no qualifying bugs or complexity
  collapse. No candidate remediation was required.
- Review: https://chatgpt.com/c/6aa8ad64-e9fc-83e9-80e8-7aa0d4775370
- PR: https://github.com/cobuildwithus/murph/pull/3457
- Final parent review confirms the closing commit changes only this task record;
  runtime source remains identical to the reviewed candidate. Required CI remains
  a PR gate. No merge, deployment, production test, or timeout change is included.
Completed: 2026-09-14
