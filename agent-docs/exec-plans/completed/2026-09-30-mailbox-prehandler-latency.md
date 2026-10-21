# Qualify mailbox pre-handler startup optimization

Status: completed
Created: 2026-09-30
Updated: 2026-09-30

## Goal

- Identify a defensible optimization for the time before authenticated mailbox
  handling. Ship only the missing age measurements when evidence does not yet
  justify structural extraction; do not move timers or add warmup traffic.

## Success criteria

- Attribute transport, platform routing and application startup with existing traces.
- Measure candidate startup cost and distinguish local hypotheses from proven
  production gains. A latency correction requires whole-request improvement.
- Preserve callback signatures, nonce replay protection, runtime write fences,
  access/usage admission and bounded mailbox projection.
- Pass focused tests, typecheck, applicable build checks and final independent review.

## Scope

- In scope: Worker-to-Web callback timing, deployed function packaging, Next startup,
  and measured dependency initialization on the existing mailbox boundary.
- Out of scope: new execution services, extra warmup requests, mutable admission
  caches, database ownership changes and unrelated foreground scheduling work.

## Constraints

- Web/Postgres remains the control-data owner; Cloudflare remains the signed caller.
- Reuse existing telemetry and deployment machinery before introducing new state.
- Keep private trace records and reviewer transcripts out of tracked artifacts.
- Worktree: `mailbox-prehandler-latency-20260930`.
- Branch: `perf/mailbox-prehandler-latency-20260930`.

## Risks and mitigations

1. Moving initialization into the handler can create a false improvement.
   Mitigation: compare complete request time and CPU, not one timer alone.
2. Isolating a function can reduce reuse of warm instances.
   Mitigation: inspect actual grouping and compare startup frequency as well as cost.
3. A transport refactor can accidentally duplicate authority or weaken body handling.
   Mitigation: keep existing owners and run signature/replay/admission regression tests.

## Tasks

1. Correlate existing Vercel spans, platform invocation metrics and Worker timings.
2. Consult Opus 5.5 and ReviewGPT against the current source snapshot.
3. Profile production-mode startup; challenge each candidate against measured cost.
4. Implement only the missing process/module age diagnostics; keep extraction
   experiments out of production until supported by the resulting evidence.
5. Verify, review, merge and deploy through the existing authorized workflow.

## Decisions

- Initial evidence localizes most of the examined pre-handler delay inside the
  function invocation. Existing middleware excludes this route; Fluid is enabled.
- Platform start classification and first-request-in-module are distinct from
  first use of a particular application module or database client.
- No runtime change selected until the remaining startup work is profiled.

## Verification

- Existing production traces and bounded metadata-only observability queries.
- Production Web build and fresh-process startup profiles with synthetic inputs.
- Focused callback/import tests and Web typecheck for the eventual changed seam.
- Compare end-to-end timing, retained memory and initialization CPU where available.

## Investigation outcome and first implementation

- Opus 5.5 and ReviewGPT independently reviewed the current source. Both retained
  the authentication, durable nonce, transaction fences and database ownership.
- Existing platform traces distinguish routing from invocation-before-handler
  delay, but platform hot/cold labels do not identify application module age.
- Repeated local fresh-process measurements found a median 150 ms for Next
  bootstrap plus emitted route loading versus 98 ms for emitted route loading.
- An ignored diagnostic bundle using standard Response instead of NextResponse
  loaded in a median 71 ms. This is not Vercel native-builder or production proof.
- A synthetic rejected-request comparison measured 319 ms through the local
  production Next server versus 90 ms through the diagnostic native adapter.
  It excludes authenticated database work and cannot establish a hosted gain.
- Native extraction would currently require additional packaging and a local
  development bridge. Defer that architecture until initialization is proven
  to dominate the affected production cohort.
- Add only process uptime and timing-module age at handler entry to the existing
  content-free record. Keep its emission conditions, timing boundaries,
  request count and authentication behavior unchanged. These fields distinguish
  first module use in a long-running process from young-process startup.
- Remaining optimization work: inspect these fields after deployment, select
  the smallest correction for the observed cohort, and verify whole-request
  improvement. No production latency improvement is claimed by this patch.

## Focused validation

- Mailbox timing tests: 5 passed, including entry-time capture despite subsequent
  process uptime changes and existing concurrent-request/error isolation.
- Web prepared typecheck: passed. Baseline production Web build: passed.
- No production payloads, request identifiers or reviewer transcripts committed.
Completed: 2026-09-30
