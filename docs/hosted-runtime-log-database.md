# Hosted runtime log database

`apps/web` keeps hosted product and control facts in the primary Prisma
Postgres database. High-volume hosted runtime diagnostics use a separate
Postgres database so optional observability traffic, indexes, and retention do
not compete with mailbox, workspace, billing, or delivery authority.

## Ownership

The existing signed callback remains the only ingestion boundary:

```text
Cloudflare runtime
  -> POST /api/internal/hosted-runtime/log
  -> ECDSA verification + one primary anti-replay nonce insert
  -> accepted-attempt recovery claim, when present
  -> isolated runtime-log Postgres append
```

The callback stays in `apps/web`; Cloudflare receives no database credential and
there is no new service or queue. The anti-replay nonce remains in the primary
control database because `runner.accepted_attempt_failed` recovery shares this
callback. Admission performs one insert keyed by the nonce hash; primary-key
uniqueness rejects a replay, and the callback performs no expiry sweep. A
runtime-log database outage must not prevent a valid recovery claim from being
authenticated and signaled.

The isolated database is the only runtime-log owner. Production fails closed
when its URL is missing. Local development may leave it unconfigured; runtime
log writes and reads then return empty best-effort results without provisioning
another database.

## Data model

The isolated schema is intentionally small:

- `hosted_runtime_log` owns bounded redacted diagnostic rows keyed by a
  namespace-scoped SHA-256 digest of the random hosted member id.
- Transaction-scoped advisory locks are derived from that digest; there is no
  permanent subject or deletion-tombstone table.

The isolated database does not store the raw hosted member id and has no
cross-database foreign key. Attempt ids and other existing redacted operational
correlation fields retain their current contract and limits.

### Computer evaluation failure categories

`assistant.computer_tool_failed` retains its existing best-effort scheduling and
`HOSTED_COMPUTER_EVAL_FAILED` error identity. Its existing
`computerFailureCategory` first preserves `strict_mode_violation`, `timeout`,
and `browser_closed`, in that order. Otherwise `runtime-log.ts` recognizes
`navigation_network_error` from explicit Chromium network-error, interrupted
Playwright navigation, or fetch-failure headers, then `javascript_error` from
known JavaScript error-name headers. These are diagnostic signatures, not proof
of a production cause or instructions to change retries or timeout budgets.

Only the already-extracted `kernelError` and `kernelStderr` supply new category
evidence, capped at 4,000 characters each; stdout, result/page content and
mentions inside call logs do not. No diagnostic text or new identifier is logged.
For evaluation failures, group by category (missing means `unknown`) and the
existing `kernelErrorPresent`/`kernelStderrPresent` booleans: an unknown category
with either flag true is unclassified; with both false, no supported error
diagnostic was extracted. `kernelStdoutPresent` alone is not error evidence.
Historical missing categories cannot be retrospectively classified. The existing
shallow scalar parser used on append and read accepts both new category values;
no schema, reader, retention or event-count change is required.

### Device import connection ownership

`device-sync.pass_finished.deviceSyncConnectionKey` is a SHA-256 hex digest of
`["device-sync-connection-v1", memberId, hostedConnectionId]`. It is stable across
attempts for one connection and distinct across members and connections. The
pass logs null when its wake has no hosted connection identity; raw connection
and member identifiers never enter this field. Existing bounded log transport,
parsing and retention apply, with no schema migration.

Queue observations describe only the pass's connection. The import alert reader
validates this optional digest and evaluates each connection separately, then
aggregates distinct runtimes. Missing or malformed ownership does not authorize
recovery of any identified connection. An accepted checkpoint credits only passes
from its matching attempt; another connection's empty queue or progress cannot
reset a stalled connection. The Web reader may deploy first and ignores legacy
unkeyed passes until the additive runner producer is deployed.

### Device import no-op counts

`device-sync.pass_finished` includes whole-pass persistence outcome counts:
`deviceSyncImportAppliedCount`, `deviceSyncImportNoopCount`,
`deviceSyncImportFailedCount`, and `deviceSyncImportUnknownCount`.
The matching `deviceSyncCompleteSourceDayImport*Count` fields count only
imports supplied with complete-source-day authority, including imports inside
reconciliation jobs. These subset counts measure the oxygen/stress temporal
feature rereads; they are not all initial historical backfill work.

An explicit importer `applied: false` is a no-op. Explicit `true` means
persistence changed, which can include evidence-only writes rather than new
health facts. A rejected import is failed even if its job later recovers; a
resolved result without a boolean `applied` is unknown. Jobs that perform no
import contribute zero counts. Job completion, provider response record counts,
and returned canonical event counts cannot establish a persistence no-op.

Counts aggregate every retained diagnostic before the existing slowest-job
sample. The service buffer covers at least the hosted pass job limit.
Compute the classified success no-op rate as `noop / (noop + applied)`, and
report failed and unknown counts alongside it. Use the complete-source-day
fields for that subset; do not sum them into the overall counts again.
The sampled `deviceSyncJobTimingSummaries` remain timing evidence, not a
rate denominator. These additions use the existing shallow scalar log contract
and existing best-effort event; no extra callback, health payload, source id,
window date, or durable scheduling state is added. Old log rows lack the fields
and must be excluded from the measured cohort rather than treated as zeros.

### Ensure-processing summaries

`runner.processing_finished` is a best-effort summary from the Postgres
`ensure-processing` route owner in
`apps/cloudflare/src/worker/route-handlers/runtime-control.ts`. A successful warm
wake (`runtime_processing_accepted` with action `woken`) neither constructs a
summary nor schedules a standalone signed log callback. Fresh starts (action
`started`, consumed by the device-import cycling monitor), other accepted
actions, every `retry_later` result, and thrown outcomes retain their summaries.
The summary is not a poll trace, mailbox admission, runtime health proof, or
recovery signal. The independent `runner.accepted_attempt_failed` event still
requests failure recovery through this callback. Runtime log batching and
foreground latency milestones are unchanged. No schema migration or new durable
state is required.

The route owner sends retained summaries through the existing log transport in a
caught, detached promise, passed to its existing `executionCtx.waitUntil` owner;
neither the request nor its response cancellation is awaited by processing
control. Response cancellation is initiated with owned rejection handling but is
not awaited by the telemetry task either. A rejected HTTP log write emits only
`runtimeLogWriteStatus` in the existing Workers logger,
never response content. Transport failures, rejections, and scheduling failures
cannot replace the control result. Delivery remains best-effort.

Correlation uses `orchestrationAttemptFingerprint`, `commandStartedAtEpochMs`,
and the typed runtime attempt/generation columns when known. The fingerprint is
lowercase hex SHA-256 of UTF-8 `murph.runtime-processing-attempt.v1`, one NUL byte,
and the complete caller-selected orchestration attempt id. No syntax-based
exception permits a plaintext id: the private producer could use a member id.
Hashing runs only on detached telemetry; a hash failure omits the fingerprint,
never falls back to the input. This is pseudonymous correlation, not anonymity
against guessing a low-entropy input. It adds no key, secret or configuration.

Repeated commands can reuse an orchestration id, so retain command start and
runtime attempt/generation. Detached writes may arrive out of order. On a fence
change, transport and liveness observations for the superseded target are
deleted rather than carried into the later one. `wakeAttemptId` and
`wakeLeaseGeneration`, when present, belong to the last observed fence, as do
the typed columns. A new fence with an older reply lacking optional metadata
must not inherit the prior fence's observations. This summary is not a history
of every target visited during convergence.

Finite `runtimeProcessingStage` values are `consent_queue`, `state_bind`,
`state_read`, `admission`, `active_wake`, `liveness`, and `fresh_start`.
`runtimeProcessingOutcome` preserves the public result kind or `threw`;
`runtimeProcessingAction` is present only for accepted results.
`activeWakeRpcDispatchedAtEpochMs` marks invocation of the child RPC by the
caller, not child receipt. `activeWakeRpcOutcome` is `returned`, `caller_timeout`,
or `rpc_error`. `returned` is not acceptance: it can include a child-reported
timeout. `caller_timeout` uses the existing command-budget timeout classifier;
an already-expired budget can prevent dispatch altogether. These fields do not
cancel the child, suppress late accepted work, or reinterpret the final result.
`runtimeProcessingRetryAtEpochMs` preserves the actual returned retry time; it
does not show when the external scheduler will next run.
`runtimeProcessingRetryReason` preserves the existing retry taxonomy, with
`admission_denied` for authoritative denial. `runtimeLivenessOutcome` and its
optional finite reason distinguish exact-active, inactive, mismatch, and
indeterminate observations. A local exact-active pointer is not a fresh TCP
health check. No exception text is added by this event.

`wakeStage` is one of `admission`, `dispatch`, `drain`, `acknowledgement`,
`legacy_health`, or `exiting_owner`. It and the transport timestamps are
optional across revisions, closed-picked RPC metadata, not control inputs.
Updated RunnerContainer responses always include observations; no request flag
is needed. The authoritative ensure-processing response JSON is unchanged.
The existing TCP handler adds numeric receipt and acceptance timing headers, which are relayed
without logging any arbitrary headers. Receipt precedes request-body parsing;
acceptance follows the wake decision. `wakePending=true` means the entrypoint
retained a wake before callback readiness, **not** that the runtime consumer
was notified. `wakeAccepted=true` describes headers; a later drain failure can
still produce `retry_later`. The final outcome must always be read with it.

Use the existing foreground latency milestones (`runtimeWakeNotifiedAtEpochMs`,
`foregroundWaitResolvedAtEpochMs`, and import/delivery phases) for work after
notification. Coalescing can retain the earliest notification and first
orchestration context; do not assume one notification row per ensure attempt.

Deploy the Web parser/event allowlist before emitting this event from Workers.
Older Web versions reject unknown event codes; older Container/Node revisions
omit optional metadata. Control results are unchanged under those skews. If an
RPC loses the caller's deadline race, its transport observations never return
to this summary: missing fields mean **unobserved**, not “not dispatched” or
“not received.” A reset or an unbounded await can prevent a final summary
altogether. This instrumentation does not claim to distinguish SDK readiness
from platform TCP scheduling inside a request that never returns.

Example bounded SQL (epoch fields are nullable; do not coerce absence to zero):

```sql
WITH attempts AS (
  SELECT at, attempt_id, lease_generation, redacted_json AS d
  FROM hosted_runtime_log
  WHERE at >= :window_start AND at < :window_end
    AND event_code = 'runner.processing_finished'
  ORDER BY at DESC
  LIMIT 200
)
SELECT at, attempt_id, lease_generation,
  d->>'orchestrationAttemptFingerprint' AS orchestration_attempt_fingerprint,
  d->>'commandStartedAtEpochMs' AS command_started_epoch_ms,
  d->>'runtimeProcessingOutcome' AS outcome,
  d->>'runtimeProcessingAction' AS action,
  d->>'runtimeProcessingRetryReason' AS retry_reason,
  d->>'runtimeProcessingRetryAtEpochMs' AS retry_at_epoch_ms,
  d->>'runtimeProcessingRetryStage' AS retry_stage,
  d->>'runtimeProcessingStage' AS final_stage,
  d->>'activeWakeRpcOutcome' AS caller_rpc_outcome,
  d->>'activeWakeRpcDispatchedAtEpochMs' AS caller_rpc_dispatched_epoch_ms,
  d->>'wakeStage' AS transport_stage,
  d->>'wakeStatus' AS response_status,
  d->>'wakeAccepted' AS accepted_flag,
  d->>'wakePending' AS pending_flag,
  d->>'wakeSignalAborted' AS signal_aborted,
  d->>'runtimeLivenessOutcome' AS liveness,
  d->>'runtimeLivenessReason' AS liveness_reason,
  (d->>'userRunnerEnteredAtEpochMs')::bigint
    - (d->>'cloudflareRouteReceivedAtEpochMs')::bigint AS route_to_runner_ms,
  (d->>'runtimeConsentLockAcquiredAtEpochMs')::bigint
    - (d->>'userRunnerEnteredAtEpochMs')::bigint AS consent_queue_ms,
  (d->>'activeWakeFinishedAtEpochMs')::bigint
    - (d->>'activeWakeStartedAtEpochMs')::bigint AS active_rpc_ms,
  (d->>'wakeResponseAtEpochMs')::bigint
    - (d->>'wakeDispatchAtEpochMs')::bigint AS transport_to_response_ms,
  (d->>'wakeDrainFinishedAtEpochMs')::bigint
    - (d->>'wakeResponseAtEpochMs')::bigint AS drain_ms,
  (d->>'wakeHandlerAcceptedAtEpochMs')::bigint
    - (d->>'wakeHandlerReceivedAtEpochMs')::bigint AS handler_to_accept_ms
FROM attempts
ORDER BY at, orchestration_attempt_fingerprint;
```

The transport interval includes the SDK's state/readiness work and TCP fetch,
not just network time. Constructor timestamps can predate a warm request.
Compare same-owner differences first; Worker, Durable Object, Node, Temporal,
and Web epoch differences require clock-skew allowance. The SQL completion
window should include the command budget beyond the ingress window. Do not
export raw JSON or subject identifiers just to investigate a latency span.

### Provider request diagnostics

`runner.provider_egress_diagnostic` is the bounded provider-request trace for
hosted OpenAI `POST /v1/responses` traffic. The Worker builds it from the request
bytes already admitted for the image gate after the provider request starts, and
persists it as background work, so neither diagnostic parsing nor the runtime-log
write holds the provider response. Version 4 records request and input byte counts,
allowlisted shape/model kinds, cache-key presence, and keyed prefix fingerprints.
For parsed Responses input, it also extends the existing aligned
`inputNestedMetricKinds`, `inputNestedMetricCounts`, and
`inputNestedMetricBytes` arrays with fixed function-output metrics. Nonzero
action metrics use `function_output.action.command.execution`,
`function_output.action.dynamic.tool.call`,
`function_output.action.mcp.tool.call`, or `function_output.action.other`.
`function_output.repeated` means the output has a `call_id` already seen in the
request. `function_output.equivalent` means a different `call_id` carried the
exact same deterministic JSON serialization earlier. Repeated and equivalent
properties are counted independently when both apply, and zero-valued metrics
are omitted. They do not claim semantic equivalence, and no call id, serialized
output, or comparison key is persisted.
Request bodies above 6 MiB retain the request byte count and `too_large` status
but skip JSON and function-output classification.

Codex `session_id`, `thread_id`, `turn_id`, and `window_id` values are never
stored. When `HOSTED_LOG_FINGERPRINT_SECRET` is configured, the Worker records
only context-separated HMAC-SHA256 fingerprints so repeated request prefixes
can be grouped within the retention window. Without the secret,
the diagnostic records fingerprint availability only. Provider request and
response bodies, prompts, messages, tool arguments/results, arbitrary response
headers, account balances, credentials, paths, vault content, and direct member
identifiers remain excluded.

Version 4 additionally counts `additional_tools` items and their tool definitions
inside Responses Lite input. `toolCount` retains its top-level-only meaning;
`additionalToolCount` captures the embedded definitions. `effectiveToolsFingerprint`
hashes the ordered top-level and embedded tool groups, excluding item IDs.
`responseFormatFingerprint` hashes a supplied `text.format`. Both fingerprints
require the existing secret and skip payloads larger than 256 KiB.
Allowlisted `reasoningEffortKind`, `verbosityKind`, `serviceTierKind`,
`cacheModeKind`, `cacheTtlKind`, and `comparisonResponsePresent` explain compatible
settings without storing arbitrary strings or response identifiers. Missing
fields mean unspecified, not a particular effective provider default.
These additions fit the existing runtime-log parser; no migration or consumer
upgrade is needed. They describe HTTP request bodies, not opaque WebSocket frames.

#### Local HTTP and WebSocket cache replay

The pinned Codex binary does not expose `prompt_cache_options` or forward
`prompt_cache_diagnostics` through App Server. Use the isolated development
adapter to test the actual binary without changing hosted WebSocket forwarding:

```sh
node scripts/replay-prompt-cache.mjs --env-file .env --scenario document --transport websocket --policy baseline
node scripts/replay-prompt-cache.mjs --env-file .env --scenario document --transport websocket --policy key
node scripts/replay-prompt-cache.mjs --env-file .env --scenario scheduled --transport http --policy baseline
```

The selected file supplies only `OPENAI_API_KEY`. Use a development key; these
commands make billable requests. The adapter listens on loopback with a random
capability token. It forwards only Responses requests to the fixed API endpoint,
holds at most 128 recent comparison IDs in memory, and prints JSON metadata.
No prompt, model output, document text, key, response ID, or thread ID is printed.
Fingerprints are salted per run and cannot be joined across runs.

The document fixture calls `executeClinicalDocumentExtraction` with synthetic
dated measurements, real validation and the named read-only permission profile.
The scheduled fixture uses the production system-prompt builder, dynamic-tool
definitions and native resumed thread. It does not replay the hosted scheduler,
delivery pipeline, production transcripts, or long idle periods. Neither fixture
sends member messages. Assertions verify successful model output/extraction.

Policies are `baseline` (preserve native key and implicit caching), `key` (stable
synthetic cohort key), `breakpoint` (first developer block), `stable` (both), and
`explicit` (stable key and developer-only writes). The cohort key is an experiment,
not a production global cache key: a hosted implementation must preserve the
member/workspace boundary and distinguish incompatible extraction families.

Each completed generated response becomes the next comparison baseline.
WebSocket `generate: false` warmups are logged separately and never become a
comparison baseline or enter generation cost totals. Failed responses do not
advance the baseline. A diagnostic `unavailable` is inconclusive; reported usage
still measures cache reuse. Incremental WebSocket requests can omit tools and
earlier messages retained through `previous_response_id`, so per-frame hashes
must not be interpreted as the full effective prompt.

The summary reports generated completions, input/cached/write tokens and input
cost units (ordinary input = 1, cache read = 0.1, cache write = 1.25). It excludes
output cost and is not a dollar invoice. Compare token-weighted reuse across
complete runs, and report warm-only results separately from first cold requests.

Synthetic local evidence on 2026-09-22, three document extractions per policy:

| Policy | Input tokens | Cached tokens | Cache-write tokens | Input cost units |
| --- | ---: | ---: | ---: | ---: |
| Native key, implicit | 16,833 | 0 | 16,824 | 21,039.0 |
| Stable key, implicit | 16,839 | 10,688 | 6,142 | 8,755.3 |
| Native key, developer breakpoint | 16,839 | 0 | 16,830 | 21,046.5 |
| Stable key, explicit-only | 16,839 | 9,572 | 4,786 | 9,420.7 |

Native-key comparisons reported `prompt_cache_key_changed`; breakpoint-only
did not resolve it. Stable-key warm requests reused about 95.3% of input (63.5%
including the first cold request) and reduced whole-fixture input cost about
58.4%. Stable-key diagnostics were sometimes `unavailable`, so the savings claim
uses usage counts. Explicit-only writes cost more than stable-key implicit
caching in this fixture and are not a recommended default.
Scheduled prompt continuations reused about 99.6% of input on both transports;
including the cold first turn reduced the three-turn ratio to about 66.5%.
These are local synthetic results, not a demonstrated production improvement
or a guarantee of 90% aggregate caching. Production response diagnostics and a
stable document cache key still require native Codex support or a separately
integrated runner-local adapter; this replay adapter is not wired into hosted
execution and does not alter production cache policy.

Upstream source was checked at OpenAI Codex
[`559264d92e4462e887d7508c705599f33daf4f1e`](https://github.com/openai/codex/commit/559264d92e4462e887d7508c705599f33daf4f1e)
on 2026-09-22. Its
[HTTP/WebSocket request structs](https://github.com/openai/codex/blob/559264d92e4462e887d7508c705599f33daf4f1e/codex-rs/codex-api/src/common.rs#L259)
still omit `prompt_cache_options`, and
[App Server completions](https://github.com/openai/codex/blob/559264d92e4462e887d7508c705599f33daf4f1e/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1861)
still expose usage and response IDs without `prompt_cache_diagnostics`.
[Ephemeral root forks now inherit parent cache routing](https://github.com/openai/codex/blob/559264d92e4462e887d7508c705599f33daf4f1e/codex-rs/core/src/session/session.rs#L883),
while keeping their own storage/lifecycle identity. This is a potential future
native reuse mechanism, not a drop-in clinical fix: forked history differs from
Murph's fresh one-shot confined extraction contract. No Codex upgrade or fork
lifecycle is introduced by this diagnostic change.

See the [OpenAI diagnostics guide](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics)
for comparison semantics and the [caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
for cache lifetime and write pricing. Current GPT-5.6+ TTL supports `30m`; it does
not promise that an infrequent scheduled job retains a warm prefix indefinitely.

The row is observability only and remains failure-isolated from provider egress.
Venice foreground and untagged calls do not create these rows. Container egress
schedules tagged memory rows with Cloudflare `waitUntil` when available and
otherwise starts a best-effort detached callback, which can be lost if the
invocation ends. Diagnostic persistence never delays a provider response or
transport error. Non-OK and transport-error diagnostics use warning retention,
while accepted and request-only diagnostics use debug retention. Venice response
status and response-header latency are recorded only after upstream dispatch;
Murph-local platform-usage denials do not produce Venice response rows, and
transport failures omit response-header latency.

The separate assistant `provider.prompt_size` trace may record
`conversationHistoryPresent`, `conversationHistoryCount`, and
`conversationHistoryBytes`. Those fields describe only the bounded conversation
history flattened into the initial provider prompt; they do not measure
function outputs carried into later mid-turn Responses requests.

The existing `assistant.provider.plan` trace may record `reasoningEffort` only
as `low`, `medium`, `high`, `xhigh`, or `null`. The value is captured after
conversation and turn-scoped automation overrides resolve and is the normalized
value passed to the Codex provider attempt. Raw provider configuration, prompts,
messages, credentials, and paths remain excluded.

### Warm Codex transport diagnostics

The existing `codex.transport_diagnostics` provider trace includes
`codexTransportScope` (`turn`, `thread`, or `unscoped`),
`codexTransportElapsedMs` since the current provider turn request,
`codexTransportProviderRequestOrdinal`, `codexTransportWarmReused`, and the
content-free `codexTransportTurnCorrelation` shared with action and completion
timing. Together with fallback, idle-timeout and retry classifications, these
distinguish transport recovery from the encompassing model-turn duration.
Elapsed time is measured when the notification is observed, not when buffered
logs are persisted; it is not an upstream response-header measurement.

Native fallback warnings contain a thread ID without a turn ID. Reused sessions
observe only recognized transport warnings from the exact bound thread after
the current turn-start notification. They emit sanitized metadata while still
discarding raw warning text and all unscoped output, requests and completion.
The scope describes identifiers carried by the notification; the correlation
describes the active turn at observation time. A delayed thread-scoped warning
cannot be attributed conclusively to that turn or an earlier WebSocket frame. POST egress
diagnostics do not observe WebSocket frames, and absence of a warning is not
proof that no recovery occurred. `codexTransportTimeoutPhase` distinguishes
`websocket-send`, `websocket-ack`, `websocket-read`, and `http-read` when native
warning text identifies the operation; missing or unknown phases are omitted by
the runtime projection. `websocket-ack` means the deployed Codex patch received
no provider frame within 15 seconds after sending a request; later silence
remains `websocket-read` under the provider stream idle timeout. No endpoint,
raw thread or turn ID, prompt, response, or additional provider error text
enters the diagnostic record.

Native `provider-output-received` and `assistant-output-received` timing records
observe accepted, current-turn assistant/reasoning output or tool activity at
Murph's app-server consumer. At most two extra records are emitted per turn.
`codexTimingReceiptKind` is `assistant`, `reasoning`, or `tool`;
`codexTimingFirstProviderReceiptElapsedMs`,
`codexTimingFirstAssistantReceiptElapsedMs`,
`codexTimingLastProviderReceiptElapsedMs`, and `codexTimingProviderReceiptCount`
also appear on turn completion. These timings start at the local `turn/start`
write. Reused-turn scope checks run before receipt tracking.
Tool activity includes native tool execution events; the count is native events,
not provider frames. Pinned Codex discards the response ID from its internal
created event, so these records cannot prove delivery of a particular raw
`response.created` frame. A downstream send alone is not native receipt.

The additions are optional diagnostics: older readers drop new receipt stages
and ignore new fields, and newer readers accept older records. Deploy the runtime
projection before producers for complete visibility; mixed versions and rollback
can lose diagnostics without changing responses or transport behavior.

#### Stall reproduction and recovery design

The credential-free `assistant-codex-websocket-stall.test.ts` fixture was measured
with the then-pinned Codex 0.153.4 binary against a local WebSocket/SSE provider.
After a successful warm turn, the provider keeps the socket open, receives a pong, and
sends no response data. The full 90-second test measured 90,006 ms from stalled
request to the single native HTTPS fallback. A five-second native idle setting
measured 5,021 ms; an explicit close with the 90-second setting measured 116 ms.
Each case completed the answer and the next resumed turn, which stayed on HTTPS.
This proves the synthetic failure mechanism, not the cause of an earlier
production incident.

A separate credential-free local experiment runs the same pinned binary against
healthy scripted responses that acknowledge immediately, stay quiet for 22 seconds,
and then finish. It changes only the fixture's idle setting:

| Local scenario | Idle setting | Result |
| --- | --- | --- |
| Healthy 22-second response silence | 90 seconds | Completed in 22,673 ms; no fallback |
| Healthy 22-second response silence on both attempts | 20 seconds | WebSocket and HTTPS attempts timed out; failed after 40,493 ms |
| Murph tool taking 22 seconds through native Codex | 20 seconds | Completed in 22,899 ms; no fallback |

Reproduce with `MURPH_RUN_CODEX_TIMEOUT_SAFETY=1 pnpm exec vitest run --config
vitest.config.ts --no-coverage test/assistant-codex-idle-timeout-safety.test.ts`
from `packages/assistant-engine`. The default lane runs shorter versions of all
three cases. These use a local scripted provider, not production or live OpenAI.
They assert actual native timeout/fallback, successful tool execution, and the
wire-to-consumer turn correlation. The tool case offers the registered Murph
progress tool with a local-only delivery callback. It checks exactly one invocation,
at least 22 seconds of actual callback work, and completion before the provider
continues. This avoids relying on OS-dependent native shell-tool notifications;
no message or external request is sent by the callback.

The 20-second setting can interrupt healthy generation and its HTTPS replacement.
Long local tool execution occurs outside the response-stream idle wait and is
not itself interrupted by that setting. This proves a concrete unsafe case for
lowering the limit; it does not measure real provider silence frequency or prove
90 seconds is universally safe. An idle deadline bounds stream-read silence,
not total latency across HTTP setup, retries, tools, or continuing response events.

The deployed Codex patch bounds that first-frame wait natively. A WebSocket
request that receives no provider frame within 15 seconds fails with the
`websocket-ack` phase, and native fallback replays it over HTTPS while the idle
window stays 90 seconds. Any provider frame clears the bound, so acknowledged
quiet reasoning and compaction keep the idle window; ping and pong are consumed
by the transport and do not count as acknowledgement. The bound cannot recover a
post-acknowledgement stall, which still surfaces as `websocket-read` after the
idle window. The permission-sandbox lane runs `assistant-codex-websocket-stall.test.ts`
against the deployed binary to prove both cases; the ordinary lane uses the
unpatched npm helper and skips them.

The current hosted policy uses a 90-second native stream-idle timeout for
OpenAI, including its HTTPS fallback and operator requests. Streaming native
compaction shares this window: the former 30-second setting could repeatedly
abort a healthy HTTP 200 stream before replacement history arrived. A native
regression reproduces that failure with 35 seconds of compaction silence and
verifies successful compaction and preserved task state with the current window. Child
requests and streaming compaction inherit the same provider configuration.
Native Codex also uses this knob for WebSocket sends; it does not replace the
separate connection and HTTP request budgets.
Venice and custom inference also use 90 seconds. `codex.prepare` reports the
selected provider's idle timeout and request/stream retry limits. Native Codex
still owns the single WebSocket attempt and HTTPS fallback; request retries,
Murph cancellation, accepted work, and delivery ownership are unchanged.

Local subscription measurements on 2026-09-15 completed eight Terra low turns
at 90- and 20-second idle settings; the longest provider data gap was 9.377
seconds. Sol high and extra-high stress runs stayed active through local test
budgets with maximum gaps of 11.576 and 12.847 seconds, but did not finish an
answer. No 90-second silence was reproduced. These selected WebSocket samples
do not establish production latency tails, live HTTPS fallback behavior, or the
cause of the original delayed reply. Genuine provider silence over 30 seconds
can interrupt useful work; continuing events reset the idle wait, while local
tool work occurs outside it. This is not a total reply deadline.

Routine CI runs short native equivalents and checks the rendered hosted config.
Rollout needs fresh-process config adoption; mixed old/new containers retain
their respective native windows without a wire or persisted-state change.
Observe the selected timeout, native timeout phase (`websocket-ack` or
`websocket-read`), fallback frequency, and terminal failures through the
existing diagnostics.

### Web-control preflight rejection attribution

Ordinary hosted-runtime callers select branded route descriptors from the same
registry that derives the shared Cloudflare allowlist. If runtime validation
nevertheless detects a descriptor/policy mismatch, it throws the dedicated
`HOSTED_WEB_CONTROL_ROUTE_NOT_ALLOWLISTED` error before issuing a request.
Before throwing, Cloudflare writes the immediate event
`runner.web_control_preflight_rejected` through the existing durable runtime-log
port. That event contains only bounded policy metadata and deliberately omits
the route, query, payload, description, member id, and credentials. Failure to
persist telemetry never replaces the original typed error. When the rejected
call belongs to retained system-mailbox work, the existing
`mailbox.system_processed` retry warning preserves that code in the typed
`error_code` column.

Use a fixed half-open observation window to count all observed preflight
rejections without returning subject keys or raw JSON:

```sql
SELECT
  redacted_json->>'method' AS method,
  redacted_json->>'operation' AS operation,
  redacted_json->>'reason' AS reason,
  redacted_json->>'transport' AS transport,
  COUNT(*) AS event_count,
  COUNT(DISTINCT subject_key) AS distinct_subject_count,
  MIN(at) AS first_at,
  MAX(at) AS last_at
FROM hosted_runtime_log
WHERE at >= :window_start
  AND at < :window_end
  AND event_code = 'runner.web_control_preflight_rejected'
  AND error_code = 'HOSTED_WEB_CONTROL_ROUTE_NOT_ALLOWLISTED'
GROUP BY
  redacted_json->>'method',
  redacted_json->>'operation',
  redacted_json->>'reason',
  redacted_json->>'transport'
ORDER BY method, operation, reason, transport;
```

Use the existing processing outcome to attribute retained system-mailbox
retries:

```sql
SELECT
  redacted_json->>'status' AS status,
  redacted_json->>'wakeKind' AS wake_kind,
  redacted_json->>'routeAction' AS route_action,
  COUNT(*) AS event_count,
  COUNT(DISTINCT subject_key) AS distinct_subject_count,
  MIN(at) AS first_at,
  MAX(at) AS last_at
FROM hosted_runtime_log
WHERE at >= :window_start
  AND at < :window_end
  AND event_code = 'mailbox.system_processed'
  AND error_code = 'HOSTED_WEB_CONTROL_ROUTE_NOT_ALLOWLISTED'
GROUP BY
  redacted_json->>'status',
  redacted_json->>'wakeKind',
  redacted_json->>'routeAction'
ORDER BY status, wake_kind, route_action;
```

Return only those aggregates. Never return `subject_key` values or raw JSON.
The preflight log uses the existing runtime-log transport, and the error remains
on the existing retry path; both changes are observability-only.

### External route response validation (structured logs)

The actual Cloudflare external route authority port emits at most one warning
for a decoded HTTP-success response rejected by its existing parser, through
`emitHostedExecutionStructuredLog`, not the runtime-log database callback.
`responseIsObject`, `authorizedValid`, `assistantAskFallbackRequiredValid`, and
`threadIsDirectValid` are validation booleans: absent optional fields are valid;
all four are false for a non-object body. No response values, arbitrary keys,
request authority, body, URL, headers, error text, or stack are included.
`workspaceAttemptId` reuses the resolved write-fence attempt header through the
existing sanitizer; `transport` is `direct` or `proxy`. The parser's return and
exact thrown error remain unchanged, including legacy authorized-only success.
There is no added request, authority read, retry, success log, or transport-failure
log; only the failure path derives these fixed fields. For a fixed natural-traffic
window, query existing structured logs with `schema = murph.hosted-execution.log.v1`,
`component = hosted.runtime.control-plane`, `phase = runtime.starting`,
`details.operation = thread_route_authority`, and
`message = Hosted external thread route authority response validation failed.`;
group counts by transport and the four booleans, using sanitized attempt correlation
only when needed. These are observed validation failures, not an authorization or
success-rate denominator; do not generate failures or replay traffic to collect them.

### Assistant-notification validation attribution

An existing `mailbox.system_processed` warning with
`error_code = 'ASSISTANT_NOTIFICATION_INVALID_RESPONSE'` may include the
optional `redacted_json.assistantNotificationValidationFailureReason` field.
The field is a closed validation-boundary vocabulary:

- `decision_json_unparseable`: no parseable JSON decision object was present.
- `decision_schema_invalid`: a parsed JSON object failed the notification
  decision schema.
- `runtime_presentation_non_send_decision`: a runtime-owned presentation was
  paired with a decision other than `send_message`.
- `creative_response_media_invalid`: creative-response media was not exactly
  one generated voice memo.

Only those four literal values pass the existing assistant-notification
structured-redaction allowlist. Provider output, response text, prompts,
messages, payloads, route values, identifiers, paths, stacks, and free-form
errors are not copied into this field. The value is pass-local observability:
it is not written into system-mailbox state and does not alter validation,
retryability, attempt counts, wake selection, delivery, or canonical state.

This is a zero-volume-change extension. It adds no event, success-path log,
metric, database write, request, queue, timer, await, or fanout. For a retrying
validation failure, a new runner attaches the field to the already-emitted
warning; older runners and unrelated warnings remain schema-compatible because
the field is optional.

For post-deploy verification, choose one fixed observation end timestamp and
run the query below separately for the latest four-hour window, its immediately
preceding four-hour window, the rolling 24-hour window, and the rolling
seven-day window. Supply fixed `:window_start` and `:window_end` values for each
run so the windows do not move while results are compared. A `NULL` reason is
the unattributed mixed-version bucket:

```sql
SELECT
  redacted_json->>'assistantNotificationValidationFailureReason'
    AS assistant_notification_validation_failure_reason,
  redacted_json->>'status' AS status,
  redacted_json->>'wakeKind' AS wake_kind,
  redacted_json->>'routeAction' AS route_action,
  COUNT(*) AS event_count,
  COUNT(DISTINCT subject_key) AS distinct_subject_count,
  MIN((redacted_json->>'attemptCount')::bigint) AS min_attempt_count,
  MAX((redacted_json->>'attemptCount')::bigint) AS max_attempt_count,
  MIN(at) AS first_at,
  MAX(at) AS last_at
FROM hosted_runtime_log
WHERE at >= :window_start
  AND at < :window_end
  AND event_code = 'mailbox.system_processed'
  AND error_code = 'ASSISTANT_NOTIFICATION_INVALID_RESPONSE'
GROUP BY
  redacted_json->>'assistantNotificationValidationFailureReason',
  redacted_json->>'status',
  redacted_json->>'wakeKind',
  redacted_json->>'routeAction'
ORDER BY
  assistant_notification_validation_failure_reason,
  status,
  wake_kind,
  route_action;
```

Return only those aggregates. Never return `subject_key` values or raw JSON.
If natural traffic produces no recurrence, report zero events; do not generate
production traffic to exercise the telemetry.

### Temporary outbound crypto pending-join diagnostic

Question: do Worker requests canceled as hung during outbound crypto resolution
join another request's pending load? `runner-outbound/shared.ts` synchronously
emits `Hosted runner outbound crypto context joined pending load.` through the
existing structured logger (`component: runner`, `phase: wake.running`) only
immediately before awaiting a valid existing pending promise. Details contain
only `domain` (`runtime` or `ingress`) and integer `pendingAgeMs` clamped to
0..30000, derived from the entry's expiry and existing TTL. Volume is at most
one event per joining invocation, with no leader or resolved-cache-hit events.
No keys, identifiers, URLs, envelopes, payloads, raw errors, or key material are
logged; no network I/O, state, or crypto/cache behavior is added or changed.
The runtime owner decides removal after one seven-day observation window, or
earlier after sufficient incident capture. Query natural traffic in that
window: correlate this exact event with existing artifact crypto-stage logs
and platform hung outcomes through native Worker request IDs **in memory only**;
return only aggregate counts by join-event presence, domain, last observed
crypto stage, and hung outcome. Never persist or export IDs or raw records.
Correlation is not proof of causation; absence in lossy logs is inconclusive.

### Foreground checkpoint lease drift diagnostics

The existing `runner.error` / `foreground_mailbox_import_failed` row adds only
`checkpointResponseCheckpointed` and `checkpointLeaseMatchesResponse` booleans
when the local `HostedRuntimeBridgeCheckpointLeaseError` reports
`stale_workspace_version` at `after_web_checkpoint`. The second boolean compares
the already-read live lease's workspace version with `response.workspace.version`;
the first distinguishes accepted (`true`) from conflict (`false`) Web responses.
A match describes that observation only: it does not prove why the lease moved
or why a conversation reply was delayed.

`checkpoint-bridge.ts` derives the pair at the existing validation owner, without
another lease read. `workspace-runner.ts` explicitly projects both booleans from
that typed error onto the foreground failure row. It does not spread arbitrary
error properties or metadata, traverse arbitrary causes, or change the shared
safe-error diagnostics or redacted-JSON parser. Both fields are omitted for
other errors/stages, missing or non-boolean metadata, successful calls, and other
log events. The existing code, stage, message, request-version validation,
checkpoint result handling, retry behavior, and snapshot effects are unchanged.
No raw versions, attempts, generations, identities, paths, user content, provider
payloads, credentials, or additional error strings enter this projection.

## Append and deletion serialization

Every append runs in one short transaction:

1. Take the subject's transaction-scoped advisory lock.
2. Re-read the primary member row.
3. Return `loggedCount: 0` when the member is missing or suspended.
4. Insert the validated batch with one SQL statement.

The encrypted account-deletion cleanup receipt owns the exact runtime-member id
set after primary deletion commits. Its `runtime_logs_completed_at` completion
field is recorded only after the isolated delete succeeds for ordinary account
deletion; zero matching rows is idempotent success. Every ordinary immediate or
hourly cleanup attempt enters one
runtime-log database transaction:

1. Take every subject advisory lock in deterministic signed-lock-key order.
2. Delete all matching runtime-log rows.
3. Keep the existing cleanup receipt pending when the transaction fails.

This proves both races without a new lifecycle owner. The receipt stores one
nullable `runtime_logs_completed_at` timestamp so a completed isolated cleanup
is never re-gated on a later database outage:

- An append that owns the subject lock first commits before cleanup; cleanup
  then removes that row.
- Cleanup that owns the lock first completes after the primary suspension fence;
  every later or delayed append rechecks that authority and writes zero rows.
- If the isolated database is unavailable after canonical account deletion, the
  receipt retries with bounded backoff until blocking and deletion converge,
  then records the target complete independently of Cloudflare and vendors.

No isolated tombstone remains after account deletion. A warm runner or late
network drain cannot recreate diagnostics because append checks primary member
authority only after acquiring the same isolated advisory lock used by cleanup.

The authenticated production Linq canary reset is the sole retention exception.
Its dedicated account-deletion entrypoint checks the configured canary identity
and settles the runtime-log target as a no-op in the same durable cleanup receipt.
Immediate and retried vendor cleanup therefore preserve existing canary runtime
logs until their normal retention deadline. The member, mailbox payloads, and
runtime state are still removed; late appends remain fenced by missing primary
authority. Ordinary account deletion has no diagnostic-retention option, even
when called on the canary account.

Primary ingress traces also retain their logical user/mailbox correlation across
canary reset. They have no mailbox cascade after the post-promotion contract migration
`20260920180000_canary_diagnostic_retention`; ordinary account deletion explicitly
removes them, and their existing seven-day retention remains unchanged. Deploy
the guarded trace writers and let the existing post-promotion contract runner
verify the production alias and drain old Web instances before applying that
migration; canary trace retention becomes effective once both are present. Each
trace-creation statement takes a shared row lock on an unsuspended member,
serializing with the existing account-deletion suspension fence. Writers that
win commit before deletion; writers that lose cannot recreate deleted traces.
Preserving a trace
does not preserve the deleted mailbox or member facts it used to join against.

## Wearable import timing

Eligible hosted webhook imports write the buffered info event
`device-sync.import_completed`. Its privacy-limited `redacted_json` separates
the operational stages instead of treating all missing-data time as one delay:

- `eventToProviderSendBucket`: a coarse, non-reversible upstream delay bucket
  computed before persistence (`under_5_minutes`, `5_to_30_minutes`,
  `30_minutes_to_2_hours`, `2_to_24_hours`, or `over_24_hours`)
- `providerSendToWebhookMs`: verified signed webhook-envelope send to Murph
  receipt, when the provider exposes the signed time
- `webhookToImportMs`: Murph receipt to successful canonical import
- `runtimeQueueMs` and `importExecutionMs`: local queue and execution durations
- `provider`: bounded connector/executor context (`junction`, `oura`, `whoop`,
  or `strava`)
- `sourceProvider`: bounded wearable-source context. Junction-backed imports
  retain their normalized source slug, including Garmin, Fitbit, and any other
  supported Junction source; direct integrations fall back to `provider`
- `jobKind`: bounded operational job context

Clock skew does not become a negative latency; only the affected measurement is
omitted. The log deliberately excludes raw stage timestamps, event or resource
types, source-device identifiers, counts, health values, webhook bodies, and
exact event-to-import intervals. Source-provider attribution is a product-wide
provider slug, never a member, account, connection, or physical-device id. The
timing metadata on the dirty-resource carrier holds only the coarse upstream
bucket, exact signed-send-to-receipt duration, earliest Murph receipt needed
for the remaining duration, and a timing-only source slug. The timing source is
separate from the pre-existing `sourceProviderSlug`, which remains part of
resource execution identity and provider input.
Pre-existing ingestion fields still use provider occurrence for dirty-window
and clean-transition wake ownership; those fields are not copied into this
runtime event. Compact timing and job fields
can remain in the existing dirty row; oversized job payloads use the existing
encrypted dirty-payload row. Coalesced hints keep the slowest upstream bucket,
longest signed delivery, and earliest receipt, so timestamps from different
events are never paired into a synthetic duration. Source attribution survives
coalescing only when every hint agrees; a mixed-source job omits
`sourceProvider` instead of choosing one.

The timing association is pass-local and deliberately best-effort. A compact
job that remains queued or retrying beyond its admitting runtime pass can later
succeed without a `device-sync.import_completed` event. Canonical import and
retry behavior remain authoritative; this event is not an exhaustive import
ledger. Like other debug/info logs, it uses the nonblocking runtime-log buffer
and seven-day retention.

Example bounded diagnostic read:

```sql
SELECT
  at,
  redacted_json->>'provider' AS provider,
  redacted_json->>'sourceProvider' AS source_provider,
  redacted_json->>'eventToProviderSendBucket' AS upstream_delay_bucket,
  (redacted_json->>'providerSendToWebhookMs')::bigint AS upstream_delivery_ms,
  (redacted_json->>'webhookToImportMs')::bigint AS murph_import_ms
FROM hosted_runtime_log
WHERE at >= now() - interval '24 hours'
  AND event_code = 'device-sync.import_completed'
ORDER BY at DESC
LIMIT 100;
```

## Reads and retention

Status and latency dashboards read only the isolated store. If a dedicated
status read is unavailable, the Web status response omits its optional
`recentLogs` window. The orchestration projection therefore reports an unknown
log count while workspace and mailbox status remain available.

The dedicated store keeps the existing policy:

- debug/info: 7 days
- warn/error: 14 days
- ordered batches of 5,000, at most four batches per hourly cleanup

The dedicated runtime-maintenance cron runs at minute 50 of each hour. It
performs bounded runtime-signal fan-out before cleaning this isolated database
serially through the diagnostic pool. A diagnostic-database failure is logged
and contained. Callback and browser assertion
nonces belong to a separate primary-database nonce cron at minute 5; its
callback statements retain the 5,000-row statement cap and use a dedicated
400-batch catch-up ceiling.

### Runaway invocation alert

The existing five-minute `/api/internal/hosted-runtime/latency-alert/cron` also
runs the runaway invocation monitor. A subject with at least 25
`runtime.invocation_finished` rows in the trailing 60 minutes opens the shared
operational email incident. Threshold and window are named constants; recipient
and timezone configuration is shared with the latency monitor. Reminders use
the existing six-hour interval and jitter, including quiet hours like the runtime
progress monitor. A healthy evaluation clears the incident without a recovery
email. Missing local log configuration skips the monitor; read failures cannot
clear an existing incident.

Each evaluation uses one aggregate over the existing `(at, id)` time index,
including the incident owner's fresh pre-send evaluation. It returns the total
qualifying subject count and at most ten highest-count subjects. Email and
incident details contain only counts, eight-character digest prefixes, and
dominant allowlisted `processingMode`/`nextWakeReason` labels (`unknown` for
missing or unrecognized values). No raw identity lookup, payload export,
migration, or runtime control action is required.

### Bounded event inventories

For an already-authorized aggregate diagnostic that times out over a day, keep
its fixed UTC window and event filter, then query six adjacent four-hour slices
sequentially. Use one connection and a separate statement for each slice, with
the existing ten-second server and twelve-second client query bounds. Combining
all slices into one statement would retain the original statement-budget limit.
Do not increase timeouts or infer an index bottleneck from a timeout alone.

For example, the first slice of the synthetic day `[2030-01-01, 2030-01-02)` is:

```sql
SELECT
  TIMESTAMPTZ '2030-01-01T00:00:00Z' AS slice_start,
  TIMESTAMPTZ '2030-01-01T04:00:00Z' AS slice_end,
  COUNT(*) AS event_count,
  MIN(at) AS first_at,
  MAX(at) AS last_at
FROM hosted_runtime_log
WHERE at >= TIMESTAMPTZ '2030-01-01T00:00:00Z'
  AND at < TIMESTAMPTZ '2030-01-01T04:00:00Z'
  AND event_code = 'outbox.delivery_finished';
```

Advance both bounds by four hours for each subsequent statement, ending at the
original window end. Keep all other predicates and grouping keys identical.
Bound each pass to six sequential slice queries; if a slice still times out,
record its interval as unknown and use a later bounded pass for smaller slices.
Retain only aggregate results and their interval, completion status, and
observation time; never return subject keys or raw JSON.

A successful zero count is different from an unsuccessful query. Report a
complete interval inventory only when successful, nonoverlapping slices cover
the entire original window; otherwise list the missing intervals and label the
total partial. A retry replaces the result for the same interval. If smaller
slices replace an interval, require their bounds to cover it exactly and do not
count both the parent interval and its replacements.

For matching groups, sum event counts and combine `MIN`/`MAX` endpoints. Do not
sum per-slice `COUNT(DISTINCT subject_key)`: a subject can occur in several
slices. Keep distinct counts per slice unless a separately bounded whole-window
query establishes the union. Averages and percentiles are not additive either.

Interval coverage describes retained rows observed by those statements, not one
consistent database snapshot. Appends and retention can change rows between
[Read Committed statements](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED).
Record that limitation with the observation window; do not hold a long snapshot
transaction merely to combine diagnostic slices. Compare plans with
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on representative synthetic local data
before proposing an index change; local timing does not establish production
performance or the cause of a production timeout.

## Configuration

Runtime traffic:

```text
HOSTED_RUNTIME_LOG_DATABASE_URL
HOSTED_RUNTIME_LOG_DATABASE_POOL_MAX=5
```

The dedicated runtime login role must enforce the server-side query bound:

```sql
ALTER ROLE <runtime-role> SET statement_timeout = '10s';
```

The migration preflight verifies that the pooled endpoint reports a positive
`statement_timeout` no greater than ten seconds. The node-postgres pool uses a
slightly longer twelve-second client query timeout and deliberately does not
send `statement_timeout` as a startup parameter: PlanetScale's
[transaction-mode PgBouncer](https://planetscale.com/docs/postgres/connecting/pgbouncer)
rejects unallowlisted startup parameters. This follows PlanetScale's
[connection-resilience guidance](https://planetscale.com/docs/postgres/connection-resilience):
enforce the database timeout at the role and keep the client timeout slightly
longer. Do not add `statement_timeout` to PgBouncer's
`ignore_startup_parameters`, because that would accept the connection while
silently discarding the server-side bound.

Migration traffic:

```text
HOSTED_RUNTIME_LOG_DIRECT_DATABASE_URL
```

Production requires the isolated runtime-log URL. Static URL checks reject
obvious aliases before connecting.
The migration preflight then proves the real endpoint topology in two steps:
pooled and direct runtime-log endpoints must contend for the same random
transaction advisory lock, and the direct primary and runtime-log endpoints
must report different cluster-wide PostgreSQL system identifiers. Production
therefore requires a genuinely separate Postgres project or cluster; a second
schema or logical database on the primary cluster is rejected because it would
still share compute, storage, WAL, checkpoints, and connection capacity.

Local development and tests may leave the runtime-log database unconfigured,
which makes best-effort log writes and reads no-ops. To exercise the dedicated
path locally, provision a separate database, configure its URLs, and run:

```bash
pnpm --dir apps/web runtime-logs:migrate:deploy
```

The optional real-Postgres proof needs only a loopback primary test URL. It
creates a temporary second logical database, proves that the production
topology preflight rejects it as the same physical cluster, applies both
migrations, proves the deletion fences, and drops the database:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test \
MURPH_TEST_RUNTIME_LOG_POSTGRES=1 \
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/hosted-runtime-log-postgres-concurrency.test.ts
```

The production migration wrapper applies isolated migrations before primary
Prisma migrations, proves pooled/direct identity with a live advisory-lock
probe, proves physical primary isolation with cluster system identifiers, and
verifies the canonical schema owner before invoking Prisma.

## Deployment

The dedicated database and URL configuration must remain in place for every
production Web deployment. Deploy the Web build that no longer references the
primary runtime-log table, let prior functions drain, then run the post-deploy
contract migration that drops the legacy table. No synchronized Cloudflare
rollout is required because the signed callback protocol is unchanged. Verify
dedicated append rate, callback failures, retention counts, status continuity,
account deletion, and absence of the primary table after the contract lane.

## Rollback

After the contract migration drops the primary table, the rollback floor is the
first Web deployment that no longer references it. Restoring an older build
requires re-expanding the primary schema first. Keep both isolated URLs
configured, do not repoint them at the primary database, and leave the isolated
schema in place during an incident.

## Shared Vault CLI phase timing (existing usage profile)

`hosted_ai_usage.turn_profile_json.cliTiming` is optional internal telemetry in
**the existing primary usage database**, not a new runtime-log stream/table.
The legacy `murph.assistant-turn-profile.v1` / `.v2` request, token, tool call,
duration, failure and output-byte fields retain their existing meanings. Do not
sum a native tool's inclusive duration with these CLI phases.

### Ownership and transport

Normal `runMurphCliEntrypoint` / `runMurphCliAction` calls open a timing scope;
`createVaultCliShell` uses native Incur middleware's resolved registered command
path and `next()`. Both scoped and full routing use that shell. Identity comes
from the closed catalog in `runtime-state/cli-timing`, never shell parsing,
arguments or result data. Unrecognized names and pre-resolution failures use
`other`. Standalone setup/discovery paths without that middleware remain
unattributed; persistent interactive/MCP sessions are not per-RPC measurements.

`cli-entry.ts` loads `runtime-state/node/cli-timing` through native dynamic
imports at its existing asynchronous entry/action and serve-options boundaries.
This keeps the timing implementation and closed wire catalog out of the runner's
static startup closure while native module caching preserves one ALS instance
for entry, middleware, recursive batch actions and query scopes. The timing-owner
import completes before the entry/action scope opens; that import is **not**
included in `total` or relabelled as `setup`. No new loader, cached state owner or
transport await is introduced. Canonical runner assembly still enforces the
20,000-byte entry and 33,200-byte static-closure budgets.

Web's own `apps/web/tsconfig.json` paths map includes both timing public subpaths
from source. Its independent paths map must not rely on the root map or a prior
runtime-state `dist` build. The existing source resolver and Next configuration
remain the owners; no alias rewriter or compatibility shim is required.

The existing usage extractor has no subprocess phase payload, and stdout/stderr
are model-visible tool results. The small metadata seam below bridges only that
missing boundary; it is not a new persisted log or monitoring service.

The existing Codex process owns one unreferenced, loopback-only UDP endpoint and
one bounded active-attempt collection window. Its explicit shell environment
setting passes an ephemeral endpoint to naturally occurring CLI subprocesses.
The existing hosted shell allowlist admits **only this new diagnostic name**;
per-thread explicit allowlists receive the same narrow addition. Authentication,
provider variables, sandbox/network permission and tool invocations are unchanged.
Warm loaded threads may ignore resume overrides, so the endpoint lasts for the
existing process, not one thread/resume. There is no awaited bind/send/flush,
filesystem spool, retry, external request, daemon, collector service or keepalive.
One best-effort datagram is sent when a root CLI scope naturally finishes. Neither
stdout, stderr, native results nor prompts carry diagnostic text. An attempt with
no native source events does not receive a diagnostic-only event: telemetry cannot
turn an empty startup failure into provider activity. No caller flag
or `--full-output` is required. Without the endpoint, the scope is a no-op.

The complete route is:

```text
CLI entry + Incur dispatch + shared query-freshness scopes
 -> runtime-state/node/cli-timing bounded root summary (loopback datagram)
 -> existing CodexAppServerProcess active collection
 -> diagnostic-only murph/cliTiming raw event (not model input or a new log)
 -> buildAssistantCodexTurnProfileJson / extractCodexAssistantProviderUsage
 -> existing hosted usage reporting, including detached-assistant-ask forwarding
 -> hosted-execution parseAssistantUsageRecord independent optional normalization
 -> usage-record-port optional timing fit against the complete HTTP body budget
 -> existing /api/internal/hosted-execution/usage/record bounded body ingestion
 -> apps/web hosted-execution/usage.ts JSON normalization
 -> existing HostedAiUsage.turnProfileJson / hosted_ai_usage.turn_profile_json
```

No paths, IDs, argv, URLs, SQL, exception text, result values or health/provider
data are retained. The transport key and same-host monotonic ticks only guard
local collection-window admission and are stripped before the raw event/profile.
This is best-effort diagnostic attribution, not an authorization or integrity
ledger. Existing runtime/version dimensions, usage sampling and retention remain
unchanged; there is no new subject/correlation label.

### Personal Patterns post-freshness timing

`wearables patterns` now records four bounded phases after query freshness:
`query-entity-read` covers stored entity hydration and read-model construction;
`query-wearable-compose` covers stored wearable decoding, reconciliation and public
composition; `query-metric-read` covers stored metric selection and decoding;
`query-pattern-report` covers optional vocabulary reading and report calculation.
They use the existing monotonic timing pipeline, fixed names, span/drop accounting
and 8 KiB transport cap. They add no content, arguments, identifiers, cardinality
labels, network operations or persisted state. Synchronous stages remain synchronous.
Thrown values and results retain their original identity and behavior.

Deploy the Web usage normalizer and runtime/CLI timing receivers with these names
before the producer. Older validators reject an unknown phase and drop the optional
`cliTiming` object; legacy native-tool usage accounting remains independent.
Older producers remain valid for new readers. A rejected or missing report is
unknown, not zero cost. Validate exact source revisions and read-only telemetry
admission before claiming deployment. This branch does not authorize deploying
optimization changes together with instrumentation.

After confirmed deployment, observe 24–72 hours of normal traffic using the bounded
72-hour query below, adding these four literal phase names. Compare counts and
phase sums for successful/error commands separately, and inspect single-call
cohorts for attribution. Multi-call histograms do not pair phase maxima or reveal
call ordering; never assign their maxima to the same slow call. Follow #3997 for
the unresolved tail and the source transition in #3391. Retain these boundaries
when that transition lands, adapting names to their actual operations rather than
claiming SQLite hydration still occurs. No deployment or speedup is established
merely by these local tests.

### Timing semantics and completeness

All durations use `process.hrtime.bigint()`, floored to integer **microseconds**.
A command/outcome entry has `calls` and fixed phase summaries with `count`,
`sumUs`, `maxUs` and eight bucket counts. The phases are **inclusive**, not an
exclusive partition:

| Phase | Boundary / interpretation |
| --- | --- |
| `total` | Entry/action scope until completion or an observed Incur exit. Excludes Node launch and imports before the entry scope opens. |
| `setup` | Entry scope to first resolved Incur dispatch: lazy module loading, routing and vault selection done there. Later vault resolution remains in dispatch. Not pure startup. |
| `dispatch` | `await next()` in native middleware: argument/environment validation, command handler and any stream consumption performed there. Not pure handler CPU or query time. |
| `post-dispatch` | Middleware completion to action completion, including output/filtering/formatting performed there. Not pure serialization and not a guarantee of OS stream flush. |
| `teardown` | The existing entrypoint warm-Codex cleanup; recursive batch actions do not perform this cleanup. |
| `unattributed` | Action elapsed when no dispatch boundary was reached. It is not zero-cost setup or a guessed command phase. |
| `query-freshness` | Shared `ensureFreshQueryProjection` or the wearable-only fresh-row read, including nested phases/rechecks. Applies across query callers/CLI families. |
| `query-manifest` / `query-status` | Each existing canonical manifest scan / projection-status read, including rechecks. |
| `query-rebuild` / `query-wait` | Existing stale-reader rebuild / canonical write-lock acquisition. A reader rechecks after acquiring the lock; only actual rebuilding gets `query-rebuild`. |

Nested scope summaries must not be added to their inclusive parents. Concurrent
or overlapping named spans can overlap in time; repeated rechecks increase phase
`count`, not command `calls`. Remaining dispatch time is **unattributed work**:
for example stored-row reads, composition or other handler work. Rebuild
subphases below distinguish existing derivation and publication owners, not
provider/network work, query execution or output serialization.
CPU timing is intentionally omitted: process-wide CPU deltas would mix concurrent
invocations and single-flight owners, not reliably distinguish one caller's waits.

Outcomes are only `ok`, `error`, `unknown`: a normal return, a thrown exception /
observed nonzero Incur exit, or an observed thrown EPIPE whose existing bin policy
handles it separately. There are no invented timeout, cancellation or retry
classifications. Later asynchronous output failures may occur outside the scope;
normal return does not certify final pipe delivery. Handler cancellation is an
ordinary observed error unless the original owner returns normally. Hard kills
produce **no fabricated completion**; immediate `process.exit`, network-isolated
shells and late/failed datagrams may produce no report. The existing ordinary-member `murph-member-workspace` profile permits networking;
that is the built-entry transport proof's profile. Read-only and other profiles
with networking disabled remain unchanged and can therefore have no phase
transport. Do not widen a permission profile to obtain telemetry. A denied socket
in one validation host does not establish a permanent product restriction.

The receiver uses CLI-root start/end ticks against its active window, not a join
on native command item IDs. Roots begun in a prior window are rejected. A
background shell starting a **new** CLI root during a later window is counted in
that later collection window. Do not interpret CLI command outcomes as the outer
provider attempt's success, or add the native and CLI call counts together.

Structured batch recursively uses the same action boundary. Children have their
own command, phases and outcomes; the inclusive parent contributes only
`batchContainers`, never another latency sample. Unexecuted stop-on-error children
and children rejected before entering the CLI have no invented command timing.
Legacy batch output, counts, lengths, durations and failure handling are unchanged.

Bounds are source-owned: 32 distinct command/outcome entries per report/active
window; 21 fixed phase names (the original 11, six rebuild names and four Patterns names); 64 started
scoped spans per invocation (plus fixed lifecycle samples); at most 8,192 bytes
per complete UDP envelope (including the ephemeral key/ticks) and 256 received packets per window. The 8 KiB cap is below
the supported macOS 9 KiB UDP datagram limit; no host setting or permission is
changed. The sender trims before sending, and the receiver rejects envelopes
over that same cap. No per-call list is retained. Known omitted/overflowed calls increment
`droppedCalls`; capped or unfinished scoped spans increment `droppedSpans`.
Payload trimming removes whole command summaries from the end of the bounded
collection and includes their full call counts in `droppedCalls`; the retained
samples are not a random sample. No packet splitting or retry is added.
Arithmetic overflow drops the incoming command's contribution without changing
legacy accounting. Packet-budget
exhaustion sets `transportTruncated`; rejected cross-window roots increment
`outOfWindowReports`. `reportCount` counts accepted root reports, not commands.
These counters cannot quantify unreceived packets or hard-killed processes.
A missing optional object/phase is **unknown**, never a duration of zero. An empty
activated-window report is not proof every CLI invocation was observed.

The complete usage-request ceiling is separately **16,384 UTF-8 bytes**, owned by
`HOSTED_USAGE_RECORD_BODY_LIMIT_BYTES` in `hosted-execution/runtime-control` and
shared by the sender and Web route. Individually bounded datagrams can merge into
an oversized HTTP payload. `runtime-platform/usage-record-port.ts` therefore
normalizes/copies only `cliTiming` and measures the entire JSON body, including
`usage`, the legacy profile and any notice target, before transport serialization
and signing. It removes whole summaries from the end until the request fits,
adding their calls to the existing saturating `droppedCalls`. Other counters and
retained phases are unchanged; HTTP trimming does **not** set `transportTruncated`
(which describes the packet budget). A counters-only timing object can remain.

If even those counters do not fit, the optional `cliTiming` field is omitted.
Absence then means unavailable timing, not zero work, and does not distinguish
body-budget omission from older producers or missing transport. `droppedCalls`
can only quantify omissions where the timing object survives. All legacy usage,
provider-request, token, tool and notice-target fields are preserved; the queued
record is not mutated. An already-oversized legacy request remains oversized and
follows its existing rejection path rather than sacrificing accounting to fit.
No request/packet cap, retry or flush behavior changes. The corrected sender works
with the existing Web ceiling; this fix does not require coordinated deployment.

The exact histogram intervals in milliseconds are `[0,250)`, `[250,1000)`,
`[1000,2500)`, `[2500,5000)`, `[5000,10000)`, `[10000,30000)`,
`[30000,60000)`, `[60000,+infinity)`. Measured zero is in bucket 0.
For percentile rank `ceil(p * count)`, locate the first cumulative bucket covering
that rank and report its **interval**, not its midpoint as a precise percentile.
For the final bucket, the observed maximum supplies a finite upper bound on the
retained sample. Histograms merge by summing corresponding counts; never compute
per-call percentiles from per-profile averages. Truncation/loss means even those
bounds describe the retained samples, not the complete population.

### Query rebuild subphases (reader-before-producer)

`packages/query/src/projection/rebuild.ts` adds only six fixed names to the
existing `runtime-state/cli-timing` enum. The portable consumer must admit these
names before the producer runs. Schema `murph.cli-timing.v1`, monotonic integer
microseconds, eight histogram buckets, command/outcome identity, failure fields,
32-command / 64-scoped-span caps, UDP 8,192-byte and HTTP 16,384-byte ceilings,
whole-command trimming and disabled-scope no-op behavior are unchanged. No entity
counts, IDs, paths, arguments, content, result values or error text are added.
The enum length itself owns the current 21-entry per-command shape bound (including the four Patterns phases); no
transport limit is widened to accommodate the extra phases.

| New phase | Existing operation measured |
| --- | --- |
| `query-source-read` | Await the strict canonical snapshot read, including its parsing/validation; not reset or the separate manifest scan. |
| `query-wearable-dataset` | `collectWearableDataset`; wearable-only also includes the inline `createVaultReadModel` argument. Full rebuild's prior read-model assembly remains residual. |
| `query-metric-projection` | Full rebuild's global metric projection, daily sample/metric outputs and canonical metric-target extraction. Absent from wearable-only rebuilds. |
| `query-wearable-summary` | Derive/encode stored wearable summary rows. Absent when full rebuild reuses an already-fresh wearable generation. |
| `query-search-documents` | Full rebuild's search-visibility filter and canonical/sample-summary document construction. No SQLite work. Absent from wearable-only rebuilds. |
| `query-publication` | Database opening and its schema/migration setup, the existing immediate transaction (deletes, inserts, manifests and metadata), and database close. Full rebuild's result-object construction is also inside this interval. This is **not transaction-only timing**. |

Synchronous work uses finally-balanced `startCliPhase`, without an added
await/yield, helper pipeline or changed operation ordering. The existing async
strict read uses `timeCliPhase`. Publication's outer timing `finally` encloses
the unchanged open / transaction / close ownership: failed opens finish the
span; transaction failure still rolls back before close; close failure still
propagates, even after a successful commit. No canonical locking, freshness,
transaction, result or exception policy changes.

These phases are not an exhaustive partition. Full rebuild's existing canonical
lock entry, unsupported-projection reset, internal manifest scan, default entity
filter/read-model construction and wearable-freshness check are outside the six.
The reset and freshness check can themselves open/read/close SQLite databases;
that work must not be attributed to `query-publication`. Wearable-only reset is
also residual. Instrumented outer manifest/status/lock scopes retain their old
boundaries. Stored-row capture and public composition remain outside the rebuild
subphases. The explicit public `rebuildQueryProjection` path emits its subphases
but has no newly invented outer `query-rebuild`; stale query callers retain their
existing parent span. Fresh reads and reused summaries have **absent**, not zero,
rebuild samples. Do not subtract maxima/percentile intervals or mix unequal
sample populations to manufacture a residual measurement.

The unchanged eleven-phase `normalizeCommandTiming` rejects a command with more
than eleven phase entries **or any unknown phase**, and `normalizeCliTiming`
then rejects the entire optional timing object. It does not selectively preserve
old CLI histograms within that object. Mixed-version safety means the existing
usage parser independently drops `cliTiming` while preserving legacy native tool
calls, durations, failures, output characters/bytes, provider requests and token
accounting. CLI `total` histograms in the rejected object are unavailable too.
History-backed `query-rebuild-timing-compatibility.test.ts` executes the actual
pre-admission portable and usage readers for both profile versions; old producers
remain accepted by the new reader. Do not depend on mixed-version dropping for
observability: deploy and verify all consuming artifacts before producers.

**Deployment is blocked, not observation-ready.** Parent verified that the
protected private deployment workflow resolves only public `main` and exposes
no candidate source-SHA/ref input. An isolated unmerged telemetry deployment
therefore requires separately reviewed protected candidate-revision deployment
support, or separately authorized merge plus normal release. This telemetry
patch authorizes neither option, changes no workflow and claims no deployment.
After the authorized route exists, verify the deployed reader artifacts first,
then producer artifacts and naturally generated end-to-end phase admission.
Only **after verified production deployment** start the **24-hour preliminary**
window and **72-hour baseline** window. Candidate creation, staging or an older
telemetry rollout does not start those clocks.

Inspect bounded validated initial-provider, first-attempt summaries from natural
traffic, grouped by command/outcome and fixed phase. Track retained sample counts,
coverage/drop counters, sums, maxima and the existing histogram intervals. A
completed failing operation can contribute a sample; interrupted/unreceived or
hard-killed work cannot contribute a fabricated completion. The absence of a
phase does not disprove a slow/hung path. Do not inspect member content, command
arguments/results or issue synthetic production calls for this investigation.

The public rebuild tests use the existing synthetic source-health fixture and
real `rebuildQueryProjection`, `searchVaultRuntime` and
`summarizeWearableSourceHealthRuntime` entrypoints. They compare enabled/disabled
outputs and freshness, assert finite private-safe samples and finally/lock/SQLite
failure cleanup. Existing sender/receiver, terminating-process, assembled CLI and
HTTP-budget tests remain applicable: the exact timing scope/module/transport is
unchanged; only its enum and query-operation spans expand. The maximum-shape
transport tests iterate the enum and retain complete admitted phase summaries.
No real-Codex prompt, reply, routing, result channel or tool invocation changes;
this diagnostic-only addition does not require a new paid model replay to prove
its wire contract. Existing end-to-end transport evidence is not proof this
candidate has been built or deployed.

An opt-in local measurement reuses that fixture (no new benchmark harness):

```bash
MURPH_QUERY_REBUILD_PHASE_MEASURE=1 pnpm --dir packages/query test \
  test/wearable-source-health-query.test.ts -t 'synthetic rebuild phase measurement'
```

It deletes only its temporary synthetic projection, runs seven rotated
cold-projection enabled/disabled pairs per public operation after warmup, and
prints the seven raw disabled/enabled wall-time samples and matched
enabled-minus-disabled differences in microseconds, numeric medians/deltas,
fixed phase histograms and a worst-tick synthetic envelope byte size. The sink
stays in memory and the timing endpoint is
explicitly cleared/restored. Fixture Date is fixed for result parity; durations
still use the real monotonic clock. It checks the six/four executed subphases,
unchanged results, zero dropped spans and unchanged packet budget. This bounds
instrumentation cardinality/bytes and records observed local overhead, **not a
universal latency bound or production speedup**. Transport cost is covered
separately by the existing integration tests.

### Private weekly usage audit rejection

The existing caught `submit-product-feedback` classification may add one optional
`productFeedbackAuditRejection` scalar: `wrong_kind`, `changelog_linked`,
`missing_prefix`, `summary_too_long`, or `empty_report`. The canonical boolean
audit validator remains the sole acceptance owner and reports the first failing
rule in its existing short-circuit order. Its unchanged 1,800-character bound
runs after the prefix check and before the empty-report check, emitting
`summary_too_long` on rejection. The dynamic parser still accepts summaries up
to 5,000 characters; the scheduled audit bound remains 1,800.

Only the already authorized weekly audit recorder rejection attaches the fixed
non-enumerable own data property to the original `Error`. The feedback adapter's
caught-failure observer rejects proxies before descriptor reads, accepts only
own data and exact allowlisted primitive values, and never invokes getters,
coerces values or follows prototypes, context or causes. It copies no raw error
code, text, fields, summary, identifiers, dates, arguments, results, provider
context or stack. Ordinary/support feedback has no new source metadata; other
tools and native completion rows do not receive this field. Existing generic
error classification is unchanged; the proxy guarantee applies to this new
metadata observer. The existing issue reporter and record parser retain exactly
the finite addition (six classification detail keys, within the 24-key cap),
without schema, redaction or storage changes.

The Error name/message, `execution` / `handler_exception` / `unknown`
classification, terminal model RPC, prompts, tool schema, managed instructions,
idempotency, quiet completion and all effects remain unchanged. Rejection still
precedes accepted-input callbacks, candidate creation, support delivery and
persistence. No success log, extra event, retry or metric is introduced.

For a future authorized comparison, use one fixed UTC end instant as `$1` in a
UTC database session and consecutive half-open 12-hour windows. These details
live in the **primary**
`hosted_assistant_runtime_issue.details_json` table, not the runtime log
database's `redacted_json`. Query only aggregates from at most 200 classification
rows per window across all releases, grouped by window and release SHA. Only
full lowercase 40-character hexadecimal release SHAs are returned; missing or
invalid values share the `NULL` release bucket. Do not retrieve payloads or join
member data:

```sql
WITH anchor AS (
  SELECT $1::timestamptz AS end_at
), windows AS (
  SELECT 'prior12' AS period, end_at - interval '24 hours' AS start_at,
         end_at - interval '12 hours' AS end_at FROM anchor
  UNION ALL
  SELECT 'latest12', end_at - interval '12 hours', end_at FROM anchor
), sampled AS MATERIALIZED (
  SELECT w.period, i.release_sha, i.rejection
  FROM windows w
  CROSS JOIN LATERAL (
    SELECT CASE WHEN release_sha ~ '^[a-f0-9]{40}$' THEN release_sha END AS release_sha,
      CASE WHEN details_json->>'productFeedbackAuditRejection' IN
      ('wrong_kind', 'changelog_linked', 'missing_prefix', 'summary_too_long', 'empty_report')
      THEN details_json->>'productFeedbackAuditRejection' END AS rejection
    FROM hosted_assistant_runtime_issue
    WHERE environment = 'hosted'
      AND component = 'assistant.codex-dynamic-tool'
      AND operation = 'submit-product-feedback'
      AND phase = 'tool_call' AND issue_kind = 'tool_error'
      AND error_code = 'ASSISTANT_DYNAMIC_TOOL_FAILED'
      AND occurred_at >= w.start_at AND occurred_at < w.end_at
      AND details_json->>'diagnosticRole' = 'classification'
      AND details_json->>'failureStage' = 'execution'
      AND details_json->>'failureReason' = 'handler_exception'
      AND details_json->>'errorCategory' = 'unknown'
    ORDER BY occurred_at DESC, id DESC
    LIMIT 200
  ) i
)
SELECT w.period, s.release_sha, count(s.period) AS sampled_caught_failure_rows,
       count(*) FILTER (WHERE s.rejection = 'wrong_kind') AS wrong_kind,
       count(*) FILTER (WHERE s.rejection = 'changelog_linked') AS changelog_linked,
       count(*) FILTER (WHERE s.rejection = 'missing_prefix') AS missing_prefix,
       count(*) FILTER (WHERE s.rejection = 'summary_too_long') AS summary_too_long,
       count(*) FILTER (WHERE s.rejection = 'empty_report') AS empty_report,
       count(*) FILTER (WHERE s.period IS NOT NULL AND s.rejection IS NULL)
         AS absent_or_unattributed,
       sum(count(s.period)) OVER (PARTITION BY w.period) = 200 AS row_cap_hit
FROM windows w LEFT JOIN sampled s ON s.period = w.period
GROUP BY w.period, s.release_sha
ORDER BY CASE w.period WHEN 'prior12' THEN 0 ELSE 1 END, s.release_sha NULLS LAST;
```

Each release row repeats its window's cap flag; the 200-row cap is shared across
releases, not applied separately to each release. Treat a hit row cap as possible
saturation and counts as lower bounds. Missing fields remain valid on older
runners and cannot backfill historical causes. `absent_or_unattributed` includes
older-runner validation rejections and ordinary/support or other unclassified
feedback exceptions; it does not prove weekly audit membership. This table has
no `feature_key`, and absent rows must not be assigned to the optimizer. Existing
native completion rows overlap these
classification rows and are not additional failures or a separate denominator.
Best-effort capture, the eight-issue attempt cap and release coverage also limit
observability: absence, including zero sampled rows, is not zero failures.

Verify compatible reader and producer revisions, including warm runners. The
earliest new evidence is the first later natural scheduled run after approved
deployment; this patch grants no deployment authority. Do not induce traffic;
no live-model journey is required. Any new naturally attributed failure enables a
targeted correction of that exact rule, with a deterministic reproduction at
its owner. Unattributed failures do not justify inferring or changing a rule.

### Private device failure evidence

Caught device-handler failures may add three optional scalars to the existing
`ToolFailureDiagnostic` classification row: `deviceAction` is the parsed
`list_accounts | connect | reconcile | configure_no_data_outreach` action;
`deviceErrorCode` is exact membership in `DEVICE_FAILURE_CODES` in
`packages/assistant-engine/src/assistant-codex/tool-failure-diagnostics.ts` (the
11 codes already recognized by the device adapter); `deviceHttpStatus` is an
integer from 100 through 599, read from own `status`, or own `statusCode` only
when `status` is nullish. Unknown codes and absent/invalid statuses are omitted,
not suppressed failures. A status does not establish an external cause, override
a local unsupported-selection code, or authorize a retry.

Only this caught-device boundary emits the fields. Capture rejects proxies
before descriptor reads and never invokes accessors, follows prototypes, reads
contexts/causes/bodies/payloads, or retains errors, names, prose, providers,
identifiers, arguments or results. The existing issue-input, reporting and
sanitizer path retains the scalars without schema or cap changes (at most eight
classification detail keys here, within the existing 24-key cap). Old/missing
fields remain valid. RPCs, prompts, tool schemas, completion counters and
success/admission telemetry are unchanged; classification rows are not another
completed-call denominator.

For the next authorized review, query at most 200 device classification failures
in one fixed 24-hour window, grouped only by these fields and the existing
reason/category. Keep missing/unknown evidence unresolved and completion counts
separate. Propose a behavior correction only after at least two matching
action/code observations and a deterministic reproduction at the responsible
owner; telemetry alone does not establish the original cause.

### Batch read attribution and connected-app failure status

Parsed batch children for exactly `knowledge show`, `event show` and
`event payload-schema` use the existing `vault-cli knowledge` / `vault-cli event`
profile labels. Known knowledge children contribute the existing optional
`knowledgeCounts` from parsed argv operation, success and structured error code;
counters never parse stdout or data, in either compact or noncompact mode. Direct
and batch contributions merge in either order, including direct failures. Unknown
batch paths still use `other`; malformed envelopes retain the outer batch fallback.
The v2 profile, safe integer sums, child/family caps, timing and byte semantics are
unchanged. Missing-page counts describe expected rejections, not bad model behavior.

The outer connected-app execution catch may add only `connectedAppsHttpStatus`
to its existing private failure diagnostic/classification row. It is an integer
100..599 from an own data `status`, falling back to own data `statusCode` only
when status is nullish. The observer rejects proxies before descriptors and does
not invoke accessors, follow prototypes/context/causes, coerce values, or retain
codes, names, messages, arguments, payloads, identifiers or URLs. Invalid or absent
status is omitted. Ordinary, ambiguous-write and official-alert caught failures
retain their exact RPC text, error category and retry posture. No field is taken
from successful/oversized results, local preflight/admission refusals, or the
separate local disconnect-cleanup failure. This does not repair pre-existing
RPC error projection or infer transport failure from absent status.

No new event, profile label or schema is required. The unchanged issue reporter,
sanitizer and record parser accept the optional numeric detail (six keys in a
connected-app classification row, below the existing 24-key cap). Existing usage
readers already accept these labels and optional knowledge counters. Old producers
and records remain valid; this patch does not backfill historical attribution.
Deploy compatible readers first wherever they are not already present, then the
producer runtime. Verify exact reader release and Worker/runner bundle versions,
including warm containers, before comparing natural emissions across a fixed,
bounded prior/latest window. Do not induce failures or mutate production data.

Group future connected-app classification failures by the bounded status, keeping
413 separate from status-absent/unknown evidence. A 413 on an otherwise-valid
oversized request belongs to the efficiency investigation, not a presumed prompt
bug; unrelated Web status observations do not establish request correlation.
Use batch knowledge counters to identify missing-page rejections. Keep completion
rows as the existing call denominator, not extra failures, and do not add profile
counts to overlapping native CLI counts. Unresolved connection loss remains
unresolved. This rollout grants no automatic rollback or production mutation.

The connected-app port's own response-envelope schema rejection keeps its existing
`TypeError` name/message and adds one fixed, non-enumerable own data code,
`CONNECTED_APPS_RESPONSE_SCHEMA_INVALID`. Only that exact code maps to the
existing private `errorCategory: invalid_result`; `failureStage: execution` and
`failureReason: handler_exception` remain unchanged. Unclassified transport errors
remain `unknown`. No response content, schema issues, identifiers, raw code or new
field is persisted. Non-enumerability preserves the existing enumerable-only RPC
error projection and ambiguous-write no-retry recovery.

For a future authorized comparison, use fixed consecutive 12-hour windows and
aggregate only connected-app `diagnosticRole: classification` rows by request kind,
stage, reason, category and optional HTTP status (at most 200 rows per window;
report saturation as a lower bound). Distinguish `invalid_result` from
status-absent `unknown`, retaining completion rows as a separate, overlapping call
denominator. Verify producer/reader release coverage first; old `unknown` records
cannot be backfilled. This is evidence for future schema-rejection attribution,
not proof that any previously observed connected-app failure was schema-related.

### Shared-read semantic validation reason

A structurally valid group `read_shared` call (any `murph.group*` tool) that
fails the semantic refinement still yields its one model-visible `custom` issue at
`freshness`, with unchanged message, path and repair bytes, and its existing
`TOOL_INPUT_SCHEMA_REJECTION` intake row. The private validation digest, and so
that row's `details`, may add one optional `semanticRejection`:

- `shared_read_options`: participant/history rejected by
  `parseHostedGroupSharedReadOptions` (including history with freshness), or
  `group_email` combined with history, a participant or freshness.
- `shared_freshness_scope_not_requested`, `shared_freshness_scope_not_wearable`,
  `shared_freshness_invalid_date` or `shared_freshness_duplicate_pair`: the
  first failing freshness entry, in canonical evaluation order.
- `shared_freshness_count`, `shared_freshness_entry_shape` or
  `shared_freshness_entry_fields`: canonical shape checks that structural
  validation normally rejects first.
- `shared_semantic_unclassified`: the canonical reader threw unexpectedly.

`readHostedGroupSharedFreshnessRejection` in
`packages/hosted-execution/src/group-shared-freshness.ts` is the source. The
throwing parser derives from the same function, so acceptance, order and messages
are unchanged. The digest admits only exact members of
`SAFE_TOOL_CALL_SEMANTIC_REJECTIONS`. It never reads a label from input. Raw
values, structurally invalid calls, other actions and other tools get no reason.
The field is excluded from `validationFingerprint`, so fingerprints remain
comparable across releases. One fingerprint may therefore carry several reasons.
The reason identifies the first rejected decision, not every defect. It does not
explain why the model chose those values. It is a classification on the existing
intake row, not another failed-call count. Older records lack the field; treat
that as missing evidence. Within a fixed bounded window:

```sql
SELECT operation,
       CASE WHEN NOT (details_json ? 'semanticRejection') THEN 'missing_evidence'
            WHEN details_json->>'semanticRejection' IN (
                   'shared_read_options', 'shared_freshness_count',
                   'shared_freshness_entry_shape', 'shared_freshness_entry_fields',
                   'shared_freshness_scope_not_requested',
                   'shared_freshness_scope_not_wearable', 'shared_freshness_invalid_date',
                   'shared_freshness_duplicate_pair', 'shared_semantic_unclassified')
            THEN details_json->>'semanticRejection' ELSE 'unrecognized_evidence'
       END AS semantic_rejection,
       count(*) AS rejected_calls
FROM hosted_assistant_runtime_issue
WHERE occurred_at >= $1 AND occurred_at < $2
  AND component = 'assistant.tool-validation'
  AND error_code = 'TOOL_INPUT_SCHEMA_REJECTION'
  AND operation LIKE 'murph.group%'
  AND details_json->'pathIssues' @> '[{"path":"freshness","code":"custom"}]'
GROUP BY 1, 2;
```

Each row records one already-rejected call, using an existing reporter. The
sanitizer and record parser are unchanged, and this detail stays below the 24-key
cap. No schema bump, event, prompt, tool schema or behavior change is needed.
Existing readers ignore or retain the optional string, so no reader-first release is needed.

### Finite CLI failure counts (optional, same timing identity)

Each non-successful invocation from a new producer contributes at most one
`failures: [{ code, stage, count, validation? }]` observation inside its existing
command/outcome entry. For example, a synthetic `experiment session log` throw
with code `invalid_payload` and context stage `validation` produces that exact
pair with count 1. A successful invocation has no failure fields. An observed
nonzero exit without original error detail contributes `unknown / unknown`, not
an apparent success. EPIPE keeps its existing `unknown` outcome; it is not
reclassified as a product failure.

The sole portable vocabulary, validation and merge owner is
`packages/runtime-state/src/cli-timing.ts`. Codes and stages use exact finite
membership, never pattern-admitted provider strings. It admits the actionable
CLI/knowledge codes, fixed validation types and selected Node/transport codes;
other values collapse to `unknown`. Capture reads only own data properties for
`code`, `context.stage`, direct `stage`, and (when code is absent) three exact
validation type names. It does not call getters, enumerate objects, inspect
messages, arguments or result output, follow prototypes/causes, or retain original
errors or contexts. The optional schema detail below reads only bounded own
`publicIssues` data at that same original-error seam. Code-only observations are
diagnostic hints, not authorization or a claim that a reported stage is independently verified. Existing dynamic-tool
finite stage/reason/category diagnostics remain separate.

Memory read diagnostics admit exactly `memory_not_found` and
`memory_document_invalid`, both emitted by the existing CLI owner at `read`.
The assistant's existing `tool-failure-diagnostics.ts` category map classifies
these as `not_found` and `invalid_result`, respectively: a missing record is
not invalid input, and an unreadable canonical document is invalid stored state,
not proof of a caller argument defect. Other memory codes (including
`memory_persistence_invalid`), arbitrary strings, and prefix/suffix/lookalike
variants remain `unknown`. This only classifies existing errors; it does not
change output, exit status, model-visible recovery guidance, reads, writes or
retries. Messages, source paths, record ids and values never enter this vocabulary.

Knowledge source diagnostics additionally admit exactly
`knowledge_source_unreadable` (`unavailable`), `knowledge_invalid_source_path`
(`invalid_input`), and `knowledge_invalid_library_slug` (`invalid_input`). These
are existing service errors, not new validation or source behavior. Unreadable
source does not prove corruption; invalid source/library references do not
establish why the caller supplied them. No stage is inferred when absent.
Unfamiliar codes and lookalikes still normalize to `unknown`.

Research scout diagnostics admit exactly `research_scout_invalid_batch_payload`
and `research_scout_invalid_window` (private category `invalid_input`), plus
`research_exa_token_missing` (private category `unavailable`, for missing runtime
configuration). The command/parser and client already own these errors. Invalid
compact lanes, a reversed window and an empty injected environment are distinct
synthetic rejection cases; retaining their codes establishes no production
behavioral cause. Their existing errors supply no stage: timing retains `unknown`
and shell readback
omits the stage. Do not add stages to public errors, infer them from codes, change
model/RPC text or retry guidance, or expand provider-code catalogs. Unknown codes
and lookalikes remain `unknown`; no arguments, paths, tokens, payloads or error
messages enter this telemetry. The same consumer-first order below applies.

#### Optional schema-validation detail

For `VALIDATION_ERROR` only, `validation: { field, code, missing? }` is one finite
selected issue, never another failure observation. `cliTimingValidationFailure`
in the portable owner selects the first admissible issue within the first **8**
own array entries. It reads `publicIssues` on the original error, `fieldErrors`
in the assistant's existing complete **16 KiB** error envelope, or `validation`
on the timing wire. All reads use own data descriptors; getters, prototypes,
causes, iterators and arbitrary nested paths are not consulted. Only exact full
static field names are admitted:

- `automation list`: limit, status (only these two options from `packages/cli/src/commands/automation.ts`).
- `food search-labels`: query, limit.
- `knowledge show`: slug (required positional argument in `packages/cli/src/commands/knowledge.ts`).
- `measurement entry list`: metric, from, to, limit (only these top-level options from `packages/cli/src/commands/measurement.ts`; no metric array indices).
- `event list`: kind, from, to, tag, experiment, limit (the command and its shared list factory), plus the fixed Incur invocation field arguments.
- `event payload-schema`: kind, for (required public kind and optional literal `import-jsonl` surface in `packages/cli/src/commands/event.ts`).
- `knowledge upsert`: body, slug, title, pageType, status, clearLibraryLinks,
  relatedSlug, librarySlug, sourcePath, plus the fixed Incur invocation field arguments.
- `knowledge append-section`: slug, heading, body, title, position, sourcePath.
- `meal add` and `meal edit`: nutritionCalories, nutritionSource, occurredAt,
  plus the fixed Incur invocation field arguments. These options are registered
  in `packages/cli/src/commands/meal.ts`; edit inherits occurredAt from
  `record-mutation-command-helpers.ts`. No other meal fields are admitted: no
  base vault/request/environment fields, free-text/media fields, nested nutrition
  paths, arrays/indices, arbitrary option names or values.

Issue codes use the closed standard vocabulary in `CliValidationDiagnostic`;
`missing` is retained only when explicitly boolean. Absent is not false, and
neither is inferred from a message, expected/received type or value. Array paths,
indices, prefixes, substrings, lookalikes and unknown/malformed details are
omitted. No original path, message, value, argument or source object is retained.
The assistant requires positive registered-command attribution and adds only
`vaultCliValidationField`, `vaultCliValidationCode`, and optional boolean
`vaultCliValidationMissing` to existing issue metadata. Success has no diagnostic.
The producer never parses stdout or argv; command attribution and categories
otherwise remain unchanged. Synthetic probes establish information loss, **not**
the behavioral root cause of actual member argument errors.

The existing Incur error bridge observes ordinary handler throws **before** its
public error projection can discard typed fields. Dispatch and invocation
catches provide a fallback only: first observation wins, with no per-catch
increment and no cross-invocation error-object cache. Recursive batch children
retain their own scopes; the container is not an additional failure sample.
Stop-on-error and the existing rejection of nested batch before child entry are
unchanged. An unentered child has no invented diagnostic.

There are at most **8 failure variants per command/outcome**, within the existing
32-command limit. Identity is code/stage plus optional validation field/code/missing,
including absence versus explicit false. Additional distinct variants increment
optional `droppedFailures` by their observation count; retained variants still aggregate.
`sum(failures.count) + droppedFailures <= calls`. These are safe positive counts
(or a safe nonnegative drop count), not extra CLI calls. Malformed optional
failure details are removed independently, retaining valid timing and usage.
Malformed optional validation alone never removes valid code/stage/count evidence.
Unknown future codes/stages normalize to constants; identical normalized variants
coalesce. Old entries without these fields remain unchanged, including mixed
old/new merges: missing old detail is **not** backfilled with fabricated unknown
observations. Counts can therefore cover fewer than the entry's error calls.

Existing UDP/HTTP fitting still removes whole command entries and charges their
calls to `droppedCalls`; it does not reinterpret `droppedFailures` or split a
command into duplicate identities. Whole-entry omission also loses that entry's
failure details. The 8 KiB envelope, 16 KiB complete usage body, packet budget,
retention, clocks, outcomes and all legacy accounting are unchanged. There is no
new stream, collector, marker, DB field/table, retry, awaited operation or
model-visible output. Without the existing timing transport, capture is inert.

**Coverage limits:** Incur 0.5.1's `internal/command.ts` puts `Parser.parse`
for resolved command arguments/options and command-level environment validation
inside the middleware chain. Murph's `patches/incur@0.5.1.patch` at base
`4949045492c` preserves that ordering and maps both `Errors.ValidationError` and
`Errors.ParseError` to `VALIDATION_ERROR / validation`; the repository's
`incur-smoke.test.ts` also checks this recovery contract. Capture uses those
exact type names when no code is available, not the unpatched upstream
ParseError fallback. A direct ZodError maps to `invalid_payload / validation`,
matching the CLI projection. Qualify with the real-entry tests against the
installed patched dependency, not upstream source alone.
Global/configuration parsing, CLI-level environment and vars validation, and
routing can precede middleware; some failures expose only an exit or reach the invocation
fallback without a resolved path (`other`). Returned `c.error(...)` sentinels
are not throws. Stream-consumption errors are handled outside the suspended
middleware chain. Those paths may provide only an unknown observation, or no
completion at all. Later asynchronous failures, hard kills and lost datagrams
retain the existing missingness. No output parsing or additional Incur runtime
hook is introduced to fill those gaps.

**Compatible rollout:** admit this optional extension in downstream Web/hosted
usage parsers, usage-body fitting and the engine receiver/profile consumer
before updating CLI producers. They all use the portable normalizer; no second
schema tree or new bundler ownership is needed. Older timing-aware consumers
accept the same command/outcome identity and strip the new fields, preserving
calls/phases and usage accounting. Older producers remain readable unchanged.
A producer-first or consumer rollback loses detail, not billing validity. The
history-backed test uses `MURPH_CLI_FAILURE_COMPAT_BASE=4949045492c` to load both
actual pre-change owners; the older `MURPH_CLI_TIMING_COMPAT_BASE` test remains a
separate, pre-timing rollout proof.

Additional failure codes on the same `murph.cli-timing.v1` schema, including the
two memory read codes, three knowledge source codes and three research codes,
and optional validation detail also roll out **reader before writer**: first
update the portable normalizer in downstream Web/hosted usage and engine/profile consumers
and the assistant category reader, then update CLI producers. Warm older
failure-aware readers normalize unfamiliar codes to `unknown`, discard unknown
validation metadata and coalesce equal code/stage pairs while retaining command
identity, outcomes, calls, phases and report counts. New readers still accept old
reports without failure details and cannot recover classifications already collapsed by old writers. A reader
rollback loses diagnostic specificity, not valid timing or usage accounting;
no protocol bump or coordinated pause is needed. The history-backed runtime-state
test uses `MURPH_CLI_MEMORY_FAILURE_COMPAT_BASE` to load the actual pre-admission
portable reader; it must be run with the base named in the active rollout plan,
not replaced with a copy of the old parser or a current-reader round trip.
The research equivalent uses `MURPH_CLI_RESEARCH_FAILURE_COMPAT_BASE` with the
pre-admission base in its active plan. Runtime-state and profile tests load the
actual old portable and hosted readers, checking coalescing to `unknown`, mixed
old/new reports, absent evidence and unchanged counts/tokens.

The `automation list` field extension follows that same consumer-first order.
Deploy the portable reader in Web/hosted usage, engine/profile and assistant
completion consumers before CLI producers. Older readers omit its `validation`
detail but keep `VALIDATION_ERROR`, stage, counts, outcomes and phases; newer
readers cannot recover detail discarded by older producers or consumers. There
is no backward recovery or backfill. Run the actual old-reader test with
`MURPH_CLI_AUTOMATION_VALIDATION_COMPAT_BASE=5189dace0ad608208702a12ece4f95e76b619e59`.
The shared subprocess fixture checks invalid limit/status and a nearby valid
list with no provider calls or filesystem changes, plus byte-identical output
and exits with timing disabled/enabled. No prompt, schema or dynamic-tool change
is implied by these synthetic probes.

The `event list` fields and `knowledge upsert` invocation-field admission use
that same reader-first rollout, including warm engine/profile and completion
consumers. Older readers omit the new tuples and coalesce equal code/stage pairs,
retaining calls, phases, outcomes, report counts and drops; existing knowledge
option detail remains readable. New readers accept old producers unchanged and
cannot reconstruct omitted detail. The fixed invocation field is retained where
the source supplies it in `fieldErrors` or `publicIssues`; original exceptions
without it remain code/stage-only. Do not infer it from an error name or message. Set
`MURPH_CLI_EVENT_INVOCATION_VALIDATION_COMPAT_BASE` to the actual pre-extension
commit for the history-backed runtime-state test. No schema bump, migration,
backfill or new event is required. Only after approved telemetry rollout and
consumer/producer convergence, observe natural traffic; do not induce calls.

The `meal add` / `meal edit` extension follows the same reader-before-writer
order: Web/hosted usage, engine/profile and completion consumers, including warm
processes, before runner/CLI producers. Run the existing history-backed test with
`MURPH_CLI_MEAL_VALIDATION_COMPAT_BASE=214c131d913b5a31251d82fa18a52669322e3d6c`.
The old reader drops the new tuples and coalesces their code/stage counts without
losing envelopes, phases, outcomes, calls or drops; new readers accept old reports.
The real CLI probe checks distinct option failures before mutation/provider
work, output/exit parity and nearby successful saves. Unknown-option parsing
supplies arguments/custom in the public envelope; an original ParseError without
public issues remains code/stage-only in timing. Do not infer the missing tuple.
The 8 KiB envelope and all existing caps, events and counters remain unchanged.
Historical meal failures cannot be attributed or backfilled from this extension.
These probes prove diagnostic loss, not a preventable meal-behavior cause.
No automatic rollback is authorized or required by a new attribution.

The `knowledge show`, `event payload-schema` and `measurement entry list` field
extensions use that same consumer-first Web/reader, then runner/CLI-producer
rollout. Run the history-backed reader tests with
`MURPH_CLI_READ_VALIDATION_COMPAT_BASE=85d536703736f3553105e01120f5560a25b732e4`
for the first two commands and
`MURPH_CLI_MEASUREMENT_VALIDATION_COMPAT_BASE=00001e1f796f5fa17dfba94e3a38215b0a87d656`
for measurement entries. They check old-reader omission/coalescing with unchanged
envelopes, counts and drops, and new-reader acceptance of old writers with or
without failure detail.
Verify deployed Web/reader source versions and runner bundle/source versions,
including warm processes, before interpreting natural-traffic coverage. Mixed
versions and a rollback to the old reader can lose only this optional detail;
old producers cannot emit it. No coordinated pause, backfill or schema bump is
needed. Rollback does not change command behavior or legacy accounting.

The native timing parity fixture covers missing/malformed slug, missing/invalid
kind and invalid `for`, both default/explicit valid schema requests, a valid
knowledge read and an ordinary missing-page rejection. It requires identical
output/exits with timing off/on, zero provider calls and unchanged filesystem
contents. Measurement-entry cases reuse that fixture for missing metric,
malformed from, impossible-calendar-date to and excessive limit. These synthetic
cases prove the observation seam, not which mistake caused a production failure.
Absent detail cannot distinguish these alternatives; nested metric-index issues
remain deliberately unattributed. Cause remains ambiguous until natural failed
traffic carries this detail; null/absent fields are not healthy outcomes. Do not trigger production
failures to validate rollout. This diagnostics-only change needs no live-model
journey and changes no prompt, command schema, recovery, retry or provider behavior.

### Bounded failure-frequency inspection and decision threshold

Run on the **primary usage database** after compatible consumers and producers
are present. This query caps input at 10,000 usage rows over 72 hours and output
at 50 finite command/code/stage groups. It uses existing turn IDs only internally
for aggregation; no IDs or private content are returned. Sum validation variants
within each command summary before taking the maximum count per turn/code/stage
to avoid adding repeated provider-request/profile snapshots;
`observed_failures_lower_bound` is conservative, not an exact all-attempt total.
A row-cap hit requires a narrower fixed window before making coverage claims.

```sql
WITH rows AS MATERIALIZED (
  SELECT turn_id, turn_profile_json -> 'cliTiming' AS t
  FROM hosted_ai_usage
  WHERE provider = 'codex-cli'
    AND occurred_at >= (now() AT TIME ZONE 'UTC') - interval '72 hours'
    AND occurred_at < (now() AT TIME ZONE 'UTC')
  ORDER BY occurred_at DESC
  LIMIT 10000
), commands AS (
  SELECT turn_id, c
  FROM rows
  CROSS JOIN LATERAL jsonb_array_elements(t -> 'commands') c
  WHERE t ->> 'schema' = 'murph.cli-timing.v1'
    AND c ->> 'command' IN ('experiment session log', 'knowledge upsert', 'other')
    AND c ->> 'outcome' = 'error'
), per_turn AS (
  SELECT turn_id, c ->> 'command' AS command,
         f.code, f.stage, max(f.observations) AS observations
  FROM commands
  CROSS JOIN LATERAL (
    SELECT e ->> 'code' AS code, e ->> 'stage' AS stage,
           sum((e ->> 'count')::numeric) AS observations
    FROM jsonb_array_elements(c -> 'failures') e
    GROUP BY e ->> 'code', e ->> 'stage'
  ) f
  GROUP BY turn_id, c ->> 'command', f.code, f.stage
)
SELECT command, code, stage, count(*) AS independent_turns,
       sum(observations) AS observed_failures_lower_bound,
       (code <> 'unknown' AND count(*) >= 2) AS investigate,
       (SELECT count(*) = 10000 FROM rows) AS input_row_cap_hit
FROM per_turn
GROUP BY command, code, stage
ORDER BY independent_turns DESC, observed_failures_lower_bound DESC, command, code, stage
LIMIT 50;
```

Investigate an implementation change only when the **same finite command/code/
stage failure occurs in at least two independent turns**, then reproduce that
specific path synthetically. One noisy loop is one turn, however high its count.
Unknowns are a coverage signal, not evidence for a particular product fix. Check
rollout version, absent diagnostics, `droppedFailures`, `droppedCalls` and
transport completeness before treating frequencies as representative. This
telemetry does not by itself establish bad input, missing ownership, a conflict,
or a product defect; do not presume or repair experiment behavior from it.

Failure-extension regression coverage additionally includes real shell/entry
fake handlers and real Incur errors over loopback, first-observation dedup,
private/hostile properties, mixed successes/errors/stages, current usage parsing,
actual old-reader skew, usage-body fitting and Web persisted normalization. These
are synthetic local tests; no real-model journey or production destination is
needed for this extension's unchanged output contract.

#### Command-specific validation inspection (including singletons)

For `automation list`, `knowledge show`, `knowledge upsert`, `event list`,
`event payload-schema`, `measurement entry list`, `meal add` and `meal edit` with
`VALIDATION_ERROR / validation`, **any newly
attributed event warrants inspection, including one event in one turn**; the two-turn
implementation-investigation threshold above does not gate this inspection.
Attribution is not an automatic behavior or prompt change. Reproduce the exact
attributed path synthetically and prove the earliest violated behavioral invariant
before proposing one. This also applies to a single newly attributed meal failure;
its field/code does not establish why the input was selected.
For the event-list/upsert probe, `arguments / custom` identifies an Incur
invocation rejection, not a particular option or its value. A specific option
such as `limit / too_big` supports inspecting that option's existing contract;
it does not authorize changing the limit. Absent detail remains unresolved,
including historical upsert failures; do not infer their field or cause from
these synthetic probes. These are selected issue observations within CLI calls,
not additional failures to sum with action-completion diagnostics.
This extension does not classify connected-app result-size failures, missing
knowledge pages, generic shell exits, profile `other`, exercise-card failures or
turn-level provider loss. None can be equated with these input rejections.

After consumer/producer convergence, run this read-only query on the primary
usage database for a fixed natural-traffic window. Bind `:window_start_utc` and
`:window_end_utc` to UTC timestamps (use consecutive 12-hour windows for a
comparison). It returns only finite command/field/code/missing groups, keeps absent
validation visible, and uses turn IDs only internally to avoid summing repeated
profile snapshots.
A 10,000-row cap hit requires a narrower window; counts are observed lower bounds,
not complete attempt totals. Check missing reports and drop counters separately.

```sql
WITH rows AS MATERIALIZED (
  SELECT turn_id, turn_profile_json -> 'cliTiming' AS t
  FROM hosted_ai_usage
  WHERE provider = 'codex-cli'
    AND occurred_at >= :window_start_utc
    AND occurred_at < :window_end_utc
  ORDER BY occurred_at DESC
  LIMIT 10000
), commands AS (
  SELECT turn_id, c
  FROM rows
  CROSS JOIN LATERAL jsonb_array_elements(t -> 'commands') c
  WHERE t ->> 'schema' = 'murph.cli-timing.v1'
    AND c ->> 'command' IN ('automation list', 'knowledge show', 'knowledge upsert',
      'event list', 'event payload-schema', 'measurement entry list', 'meal add', 'meal edit')
    AND c ->> 'outcome' = 'error'
), per_turn AS (
  SELECT turn_id, c ->> 'command' AS command, f.field, f.issue_code, f.missing,
         max(f.observations) AS observations
  FROM commands
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN c ->> 'command' = 'automation list' AND e -> 'validation' ->> 'field' IN ('limit', 'status')
               OR c ->> 'command' = 'knowledge show' AND e -> 'validation' ->> 'field' = 'slug'
               OR c ->> 'command' = 'knowledge upsert' AND e -> 'validation' ->> 'field' IN (
                 'body', 'slug', 'title', 'pageType', 'status', 'clearLibraryLinks',
                 'relatedSlug', 'librarySlug', 'sourcePath', 'arguments')
               OR c ->> 'command' = 'event list' AND e -> 'validation' ->> 'field' IN (
                 'kind', 'from', 'to', 'tag', 'experiment', 'limit', 'arguments')
               OR c ->> 'command' = 'event payload-schema' AND e -> 'validation' ->> 'field' IN ('kind', 'for')
               OR c ->> 'command' = 'measurement entry list' AND e -> 'validation' ->> 'field' IN ('metric', 'from', 'to', 'limit')
               OR c ->> 'command' IN ('meal add', 'meal edit') AND e -> 'validation' ->> 'field' IN (
                 'nutritionCalories', 'nutritionSource', 'occurredAt', 'arguments')
             THEN e -> 'validation' ->> 'field' END AS field,
           CASE WHEN e -> 'validation' ->> 'code' IN (
             'invalid_type', 'too_big', 'too_small', 'invalid_format', 'not_multiple_of',
             'unrecognized_keys', 'invalid_union', 'invalid_key', 'invalid_element', 'invalid_value', 'custom'
           ) THEN e -> 'validation' ->> 'code' END AS issue_code,
           CASE WHEN jsonb_typeof(e -> 'validation' -> 'missing') = 'boolean'
             THEN e -> 'validation' ->> 'missing' END AS missing,
           sum((e ->> 'count')::numeric) AS observations
    FROM jsonb_array_elements(c -> 'failures') e
    WHERE e ->> 'code' = 'VALIDATION_ERROR'
      AND e ->> 'stage' = 'validation'
    GROUP BY 1, 2, 3
  ) f
  GROUP BY turn_id, c ->> 'command', f.field, f.issue_code, f.missing
)
SELECT command, field, issue_code, missing, count(*) AS independent_turns,
       sum(observations) AS observed_failures_lower_bound,
       (field IS NOT NULL AND issue_code IS NOT NULL) AS inspect,
       (SELECT count(*) = 10000 FROM rows) AS input_row_cap_hit
FROM per_turn
GROUP BY command, field, issue_code, missing
ORDER BY independent_turns DESC, command, field, issue_code, missing
LIMIT 50;
```

### Bounded latest-72h / prior-72h inspection

Run on the **primary usage database**. This example uses one stable UTC anchor,
144 hours and a 50,000-row cap. A row-cap hit invalidates claims of complete period
coverage (inspect narrower fixed windows instead). It selects a small closed
operation subset; add only literal registered names from the contract, not argv
or user-supplied labels. Arrays/numbers below come from the independently validated
`murph.cli-timing.v1` object. No identifiers or free-text fields are selected.
Coverage columns are per-period and repeated alongside phase rows; **do not sum
them across phase rows**. Repeated query phases have sample counts, not unique
command coverage. `total` is the per-command timing distribution.

```sql
WITH anchor AS (SELECT now() AT TIME ZONE 'UTC' AS end_at),
rows AS MATERIALIZED (
  SELECT CASE WHEN occurred_at >= end_at - interval '72 hours'
              THEN 'latest72' ELSE 'prior72' END AS period,
         turn_profile_json -> 'cliTiming' AS t
  FROM hosted_ai_usage CROSS JOIN anchor
  WHERE provider = 'codex-cli'
    AND occurred_at >= end_at - interval '144 hours' AND occurred_at < end_at
  ORDER BY occurred_at DESC
  LIMIT 50000
), valid AS MATERIALIZED (
  SELECT period, t FROM rows
  WHERE t ->> 'schema' = 'murph.cli-timing.v1'
), coverage AS (
  SELECT r.period, count(*) AS usage_rows,
         count(v.t) AS rows_with_timing,
         sum((v.t ->> 'reportCount')::numeric) AS accepted_root_reports,
         sum((v.t ->> 'droppedCalls')::numeric) AS dropped_calls,
         sum((v.t ->> 'droppedSpans')::numeric) AS dropped_spans,
         sum((v.t ->> 'outOfWindowReports')::numeric) AS cross_window_reports,
         bool_or((v.t ->> 'transportTruncated')::boolean) AS packet_cap_hit
  FROM rows r LEFT JOIN LATERAL (
    SELECT r.t WHERE r.t ->> 'schema' = 'murph.cli-timing.v1'
  ) v ON true
  GROUP BY r.period
), wanted(command) AS (
  VALUES ('goal list'), ('family list'), ('memory show'), ('wearables latest'), ('wearables day'),
         ('wearables activity list'), ('wearables sources list'), ('wearables patterns'), ('other')
), commands AS (
  SELECT v.period, c FROM valid v
  CROSS JOIN LATERAL jsonb_array_elements(v.t -> 'commands') c
  JOIN wanted w ON w.command = (c ->> 'command')
  WHERE c ->> 'outcome' IN ('ok', 'error', 'unknown')
), samples AS (
  SELECT period, c ->> 'command' AS command, c ->> 'outcome' AS outcome, p
  FROM commands CROSS JOIN LATERAL jsonb_array_elements(c -> 'phases') p
  WHERE p ->> 'phase' IN ('total', 'setup', 'dispatch', 'post-dispatch',
    'teardown', 'unattributed', 'query-freshness', 'query-manifest',
    'query-status', 'query-rebuild', 'query-wait', 'query-source-read',
    'query-wearable-dataset', 'query-metric-projection', 'query-wearable-summary',
    'query-search-documents', 'query-publication', 'query-entity-read',
    'query-wearable-compose', 'query-metric-read', 'query-pattern-report')
), totals AS (
  SELECT period, command, outcome, p ->> 'phase' AS phase,
         sum((p ->> 'count')::numeric) AS phase_samples,
         sum((p ->> 'sumUs')::numeric) / 1000 AS sum_ms,
         max((p ->> 'maxUs')::numeric) / 1000 AS max_ms
  FROM samples GROUP BY period, command, outcome, p ->> 'phase'
), bins AS (
  SELECT period, command, outcome, p ->> 'phase' AS phase,
         b.ordinality - 1 AS bucket,
         sum((b.value #>> '{}')::numeric) AS bucket_count
  FROM samples
  CROSS JOIN LATERAL jsonb_array_elements(p -> 'buckets')
    WITH ORDINALITY AS b(value, ordinality)
  GROUP BY period, command, outcome, p ->> 'phase', b.ordinality
)
SELECT t.*, t.sum_ms / nullif(t.phase_samples, 0) AS mean_ms,
       b.bucket, b.bucket_count,
       c.usage_rows, c.rows_with_timing, c.accepted_root_reports,
       c.dropped_calls, c.dropped_spans, c.cross_window_reports, c.packet_cap_hit,
       (SELECT count(*) = 50000 FROM rows) AS row_cap_hit
FROM totals t JOIN bins b USING (period, command, outcome, phase)
JOIN coverage c USING (period)
ORDER BY period, command, outcome, phase, bucket
LIMIT 4096;
```

To inspect coverage-only periods, including an all-legacy baseline with no timing
samples, use the same `anchor`, `rows`, `valid`, `coverage` CTEs and finish with
`SELECT * FROM coverage ORDER BY period LIMIT 2;`. A zero-count accepted report
and absent telemetry are different; neither establishes complete native-call
coverage. Do not filter exclusively to succeeded provider attempts when assessing
CLI errors or aborted-attempt missingness.

### Compatibility, rollout and proof

Deploy the updated hosted `parseAssistantUsageRecord` consumer **first**, then
publish runtime-state, query, CLI and the Codex-process producer/hosted allowlist
in the usual runtime image. No migration, deployment workflow/configuration or
release-contract bypass is needed. The allowlist edit is existing runtime shell
metadata admission, not expanded tool/network permission. Older v1/v2 profiles
remain readable. Old consumers drop the new optional key while retaining legacy
profile/token accounting. New consumers accept old producers. A new CLI with an
old launcher has no endpoint; a new launcher with an old CLI has no report. An
unknown future diagnostic schema/name or malformed optional object is dropped
independently, not a reason to reject valid legacy usage. Closed vocabulary
expansions likewise require consumer-first admission. Rollback can lose optional
coverage without changing tool execution or billing.

Focused proof lives in runtime-state `cli-timing.test.ts`, CLI
`cli-timing.test.ts`, query `query-projection-concurrency.test.ts`, and engine
`cli-timing-{transport,profile}.test.ts`. Real transport tests send valid envelopes
at exactly 8,192 bytes and at 8,193 bytes, so rejection exercises the receiver
rather than the host UDP size limit. The natural sender test requires receipt
of a trimmed report with nonempty summaries and conserved retained/dropped call
counts. Datagram loss still leaves unquantified missingness. The runtime
`hosted-runtime-codex-config.test.ts` built-entry test is an explicit opt-in:
`MURPH_RUN_HOSTED_CLI_TIMING_E2E=1`. Default source/coverage shards do not build a
CLI and skip only this artifact-dependent integration gate; deterministic fixture
parsing/failure/parity tests and existing production-surface tests remain enabled.
The parent must run the enabled gate successfully before marking the PR Ready.
Once enabled, missing artifacts, native failures, blocked reads/networking and
missing telemetry are hard failures, not reasons to skip.

The gate uses the pinned real Codex binary and a synthetic local Responses
provider, `buildHostedCodexConfigToml`, the unchanged `murph-member-workspace`
profile and production shell allowlist, with only the synthetic vault as a
workspace root. `MURPH_HOSTED_CLI_TIMING_CLI_BIN` optionally selects an absolute
path to the freshly packaged `@murphai/murph` **`dist/bin.js`**, or the fully
assembled runner's **`.bundle/bin.js`**. Without it, the
test uses the checkout's `packages/cli/dist/bin.js`; this works only when that
layout is already readable by the profile. The test checks the built entry and
package name, but does not establish artifact freshness from the path: prepare
from the current candidate immediately before the run. Both test variables are
read by the test process only, not added to production environment admission.

Prepare the actual package/closure under an already permitted temporary root,
not a broad source-checkout copy or symlinks back to unreadable workspace files.
The existing release packer retains built workspace payloads and patched bundled
dependencies; native installation resolves the host's platform dependencies.
This avoids the runner installer's intentional Linux-only platform target on
macOS. The release packer's existing manifest also requires the public plugin
build; that plugin is not installed into this CLI fixture. No staging owner or
CI build is added. From the repository root on supported Node/pnpm:

```sh
set -eu
pnpm --filter @murphai/murph... --filter @murphai/openclaw-plugin... build
export MURPH_CLI_TIMING_ARTIFACT_ROOT="$(mktemp -d /tmp/murph-cli-timing.XXXXXX)"
node scripts/pack-publishables.mjs \
  --out-dir "$MURPH_CLI_TIMING_ARTIFACT_ROOT/tarballs" \
  --pack-output "$MURPH_CLI_TIMING_ARTIFACT_ROOT/pack-output.json"
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = process.env.MURPH_CLI_TIMING_ARTIFACT_ROOT;
const install = path.join(root, 'installed');
mkdirSync(install);
writeFileSync(path.join(install, 'package.json'), '{"private":true}\n');
const manifest = JSON.parse(readFileSync(path.join(root, 'pack-output.json'), 'utf8'));
const tarballs = manifest.packages
  .filter(entry => entry.name !== '@murphai/openclaw-plugin')
  .map(entry => path.resolve(entry.tarball));
execFileSync('npm', ['install', '--prefix', install, '--omit=dev',
  '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], { stdio: 'inherit' });
NODE
export MURPH_HOSTED_CLI_TIMING_CLI_BIN="$MURPH_CLI_TIMING_ARTIFACT_ROOT/installed/node_modules/@murphai/murph/dist/bin.js"
MURPH_RUN_HOSTED_CLI_TIMING_E2E=1 \
  pnpm --dir packages/assistant-runtime exec vitest run \
  --config vitest.config.ts --no-coverage \
  test/hosted-runtime-codex-config.test.ts -t 'shared CLI timing'
```

Packing/installing uses existing local package assets and ordinary public
package dependencies, not provider credentials or production traffic. The test
itself uses local synthetic providers only. Preparation failures must be fixed
before running the gate; no registry package may substitute for the candidate's
local Murph tarballs. Remove the temporary artifact root after validation. This
is a local artifact operation, not a deploy command or release-contract bypass.

All test homes, vaults, working directories and provider keys are synthetic.
The shell sets test-only `OPENSSL_CONF=/dev/null`; initialization and both parity
children use it, without widening the production allowlist. There is no source
loader, unrestricted sandbox substitution, new filesystem grant or extra runtime
workspace root. A readable CLI artifact does not prove every installed Node or
dependency read is permitted; subsequent native failures remain explicit.

The fixture runs telemetry-disabled and enabled built children inside the **same**
hosted shell/profile, comparing their completed exit status and each stdout/stderr
stream byte-for-byte. It checks the current call's authoritative
`custom_tool_call_output` selected by the current call ID, rather than assuming
nested `tools.exec_command` emits `commandExecution` events. The fixture emits
one fixed `MURPH_CLI_TIMING_SHELL_RESULT=` line inside that native output; native
status/wall-time/Output framing need not start with JSON. Missing/duplicate or
malformed sentinel lines, shell failure and child failure all fail the proof.
This sentinel is test-only output, never production tool text or telemetry. The
disabled child has no endpoint and must contribute no report. Scoped `goal list` and full-router
`family list` must expose lifecycle phases, **not** query freshness. A separate
built `wearables latest` invocation reaches the real query owner and must expose
`query-manifest`, `query-status`, and `query-freshness` on the synthetic vault.
No query calls are added to non-query commands. A nonempty session, unchanged
session on continuation, and native `warm-reused` traces are required.

Passing this gate establishes the selected artifact -> hosted shell -> Codex raw
diagnostic transport; a source or `dist/bin.js` run does **not** establish
`.bundle/bin.js` parity. In bundled mode, a third, telemetry-disabled child runs
the installed sibling `dist/bin.js` in the same shell/profile. All three children
must complete successfully with identical per-stream bytes; only the enabled
bundled child may contribute the single report. The engine profile test composes
this with the actual extractor -> hosted normalization boundary. Separate startup cases distinguish no native event from
an actual native RPC error and retain the latter. Their receiver fixture mirrors
the one-shot production close contract: catch and finally can both finish cleanup,
but only the first can return a diagnostic. Empty startup failures remain empty;
native error evidence remains present exactly once. The profile token fixture is a valid
native notification, so request accounting is tested as well as tool accounting.
The history-dependent profile test loads the consumer source from the exact Git
base supplied in `MURPH_CLI_TIMING_COMPAT_BASE`; no copy of the old parser is kept
in the repository. Run that explicit gate from the active plan. A current-parser
roundtrip of field-stripped data is only legacy-shape proof, not mixed-version
proof. Ordinary runs without the base variable explicitly skip this additional
history-dependent case.

#### Bundled timing-owner prerequisite and artifact parity

The CLI's literal lazy import of
`@murphai/runtime-state/node/cli-timing` and query's variable native runtime import
must reach the same installed timing owner. Inlining that leaf into the CLI while
query loads the installed package creates separate `AsyncLocalStorage` instances:
lifecycle scopes can survive while `query-freshness`, `query-manifest` and
`query-status` disappear. The shared runner esbuild policy keeps **only that exact
stateful subpath** external; both bundle input guards reject accidental inlining
of its installed implementation. The leaf resolves its relative timing catalog
from the same installed package for CLI and native query callers. Other
runtime-state entrypoints remain bundleable; no process-global registry is added.
The CLI import remains lazy. Entry, static-closure and total-output guards are
unchanged and must pass on the actual assembled candidate.

Old missing query phases mean **unknown**, not zero query cost or a query-free
command. Lifecycle coverage, a successful command and zero dropped-span counters
do not prove that the old split owner observed query work; this loss occurs before
span admission. Do not reconstruct absent durations or treat pre-fix absence as a
performance baseline. The correction restores existing bounded numeric/enum
spans to the existing report and transport, without changing collectors, fields,
caps, loss/unknown semantics, native errors, cancellation or CLI results.

The runner bundle test stages a synthetic successful read through a native
variable import and copies the candidate's built **public timing exports**, not
an alternative timing implementation. Its esbuild negative control removes only
the timing external: it must retain lifecycle phases and lose all three query
phases. The corrected path calls `bundleInstalledVaultCliBinary`, then executes
`.bundle/bin.js` and both retargeted wrappers. Enabled reports must contain the
query phases and remain valid under the existing private-safe normalizer; all
successful output/exit results must match `dist/bin.js`, including telemetry off.
Relative-import bypass cases exercise both shared forbidden-input guards.
This isolates module ownership, not the real query implementation or transport;
the assembled hosted gate above owns that composed proof.

Use the repository's supported Node (at least 24.14.1), pinned pnpm 10.33.0,
installed candidate dependencies and pinned Codex binary. Build the public timing
exports before running the synthetic bundle tests; missing exports are a hard
fixture failure, not a skip or a source-loader fallback. From the repository root:

```sh
pnpm --filter @murphai/runtime-state build
pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage \
  apps/cloudflare/test/runner-bundle-cli-bundle.test.ts \
  apps/cloudflare/test/runner-bundle-entrypoint-bundle.test.ts
pnpm --dir apps/cloudflare typecheck
pnpm --dir packages/assistant-runtime typecheck
```

For the actual production artifact proof, use canonical Linux x86_64 assembly
without skip flags or budget overrides, then copy the **entire installed runner
tree**, including retained package payloads, into an already permitted temporary
root. Do not substitute a separately built CLI, incomplete file copy, new source
loader, symlink back to an unreadable checkout, or broader filesystem grant:

```sh
set -eu
pnpm --dir apps/cloudflare runner:bundle
export MURPH_CLI_TIMING_ARTIFACT_ROOT="$(mktemp -d)"
cp -R apps/cloudflare/.deploy/runner-bundle "$MURPH_CLI_TIMING_ARTIFACT_ROOT/installed"
export MURPH_HOSTED_CLI_TIMING_CLI_BIN="$MURPH_CLI_TIMING_ARTIFACT_ROOT/installed/node_modules/@murphai/murph/.bundle/bin.js"
MURPH_RUN_HOSTED_CLI_TIMING_E2E=1 \
  pnpm --dir packages/assistant-runtime exec vitest run \
  --config vitest.config.ts --no-coverage \
  test/hosted-runtime-codex-config.test.ts -t 'shared CLI timing'
```

The assembly output above is the default deploy-directory location; use the
actual assembly output when an existing deploy-directory override is active.
Preserve the installed candidate package tree during the copy and remove the
owned temporary root after validation. The real successful `wearables latest`
read must expose all three query phases through the existing hosted diagnostic
pipeline. `goal list` and `family list` must remain query-phase-free; cold and warm
session evidence, native failures and telemetry-disabled no-op checks remain
mandatory. Source query-concurrency tests and an unbundled hosted run are useful
separate evidence, never substitutes for this assembled-artifact gate.

This is a packaging-only correction using an already deployed vocabulary. The
original consumer-first rollout rule still applies to introduction of shared CLI
timing, but this correction requires no new consumer schema, database migration
or coordinated protocol transition. Rebuild the runner with its matching installed
packages and use the normal parent-owned rollout. Mixed old/new runners remain
wire-compatible; older runners may still omit query spans. Do not use the new
CLI bundle with a different or missing installed timing package.

After parent validation and deployment, measure **72 hours of normal traffic**
using the bounded aggregate inspection above. Record rollout coverage separately
from duration, missingness and existing drop/loss indicators; compare the latest
72-hour and preceding 72-hour windows only where coverage supports comparison.
Do not add identifiers to reports, replay production payloads, generate probe
traffic, or infer an optimization from newly visible spans. No production
measurements or rollout results are established by this implementation handoff.

For source-resolution and startup-loading corrections, run the focused guards
from the repository root before the existing built hosted proof:

```sh
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/next-config.test.ts
pnpm --dir apps/web typecheck:prepared
pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage \
  packages/cli/test/cli-timing.test.ts packages/cli/test/cli-entry.test.ts \
  packages/cli/test/batch.test.ts packages/cli/test/batch-protocol-error-stages.test.ts \
  packages/cli/test/assistant-codex.test.ts \
  packages/cli/test/vault-cli-import-surface-contract.test.ts
pnpm --dir packages/cli typecheck
# Canonical production assembly on Linux x86_64; no deploy and no budget override.
pnpm --dir apps/cloudflare runner:bundle
```

The Web typecheck uses the normal generated-data preparation prerequisites, not
prebuilt timing declarations as a substitute for source resolution. Import
laziness tests are not a replacement for the assembly byte budgets or bundled
parity probes. Refresh the test CLI artifact after the loading change and rerun
the enabled hosted gate above; CI still owns exact-head Linux assembly and the
existing exact-first-parent total-output comparison.

For the merged-profile HTTP budget, run the composed sender/ingestion regression
and the route's exact byte-limit checks (no built CLI or external service needed):

```sh
pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage \
  apps/cloudflare/test/usage-record-port.test.ts
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/hosted-execution-usage-route.test.ts
pnpm --dir packages/hosted-execution exec vitest run --config vitest.config.ts \
  --no-coverage test/assistant-usage.test.ts
```

The composed test uses real timing scopes/merge, sender and transport serialization,
then Web's actual bounded body reader and request parser through the existing
`#hosted-web-testing` seam. Providers, callback authentication, fetch and persistence
are synthetic; the fixture does not execute CLI handlers or make network requests.
It covers 24 distinct root summaries, maximum admitted cardinality, UTF-8/notice
headroom, counters-only and absent timing, and unchanged oversized legacy failure.
The separate route test checks both declared-length and streamed-byte enforcement
before allowance settlement. Ordinary source CI runs both owners without a new gate.

The warm `packages/runtime-state/bench/cli-timing.ts` microbenchmark rotates
baseline, disabled and enabled timing over warm blocks; it excludes transport
and actual CLI/query work and reports block means, not per-call percentiles or a
production speedup. Run it with `node --import tsx` (no tsx CLI IPC). Parent
validation must run repository tests/typechecks/builds, the actual complexity
guard and the built hosted lane on supported Node/pnpm and pinned Codex versions
before promotion. This telemetry patch does not authorize merging, deployment,
or bypassing the protected public-main release contract.

### Reply skip reasons

Assistant `input.reply-skipped` events populate the existing `safeDetails` field
on `assistant.automation_detail` with `reply_skip:<reason>`. The engine maps exact
static reasons to bounded codes such as `channel_disabled`, `self_authored`,
`already_handled`, `unattested_reaction`, `empty_input`, `intentional_no_reply`,
`provider_usage_limit`, and `incomplete_terminal_evidence`. Unknown or dynamic
reasons yield only `reply_skip:unclassified`; unrestricted event details and
provider error text are never copied into this diagnostic. These codes describe
an existing skip or deferral and do not change retry, reply, or alert decisions.

## Container CPU attribution

The container entrypoint starts two process-lifetime diagnostics before serving
requests. These events use structured container stdout and Cloudflare logs;
they are not new `hosted_runtime_log` database records or a runtime-control
protocol extension. Neither opens an inspector TCP port or writes a raw CPU profile.

- `entrypoint-cpu-watchdog` retains the existing cgroup CPU/throttling counters
  and top three per-process CPU deltas. Use it to distinguish Node, Codex and
  other allowlisted executables, including CPU outside the main Node process.
  Processes that start and exit between scans remain unattributed; cgroup totals
  still include their work.
- `entrypoint-cpu-profiler-started` confirms V8 sampling at 10,000 microseconds
  (100 Hz), with nominal ten-second windows. `entrypoint-cpu-profile` reports a
  window with at least 500 ms of Node process CPU or 100 ms maximum event-loop
  delay. A quiet container emits its latest window roughly once per minute
  while the event loop is running; this is not a cumulative minute profile.
- `entrypoint-cpu-profiler-unavailable` marks setup or rotation failure. The
  sampler disconnects its own session and stops; serving continues. A new
  container process starts a fresh sampler.

Correlate container placement and timestamp, then `pid` and `windowStartedAt`
with adjacent job/wake/checkpoint logs. Reports include `intervalMs`, actual
`nodeCpuMs` and `nodeCpuCores` (all threads in this Node process), maximum
`eventLoopMaxDelayMs`, `eventLoopUtilization`, `heapUsedBytes`, and `rssBytes`.
High event-loop utilization includes synchronous native waits; it alone does
not prove CPU consumption. Compare it with the process and cgroup CPU counters.

`topSelfFrames` counts samples executing in a frame; `topInclusiveFrames`
counts samples with a frame anywhere on the synchronous stack, deduplicating
recursion. Inclusive counts overlap and must not be summed. Both retain six
frames. `gcSamples`, `idleSamples`, `activeSamples`, and `samples` show the
sample population; GC is included in active samples. Counts are statistical
attribution, **not exact per-function CPU milliseconds**. Source labels retain
only code under the image's immutable `/app/dist-bundled`, `/app/dist`, and
`/app/node_modules` roots or Node builtins, with bounded symbol names and
line/column positions. Other sources and their names become `(redacted)`.
No prompts, arguments, member-owned file paths, raw profiles, or source text
are published. Bundle positions refer to the deployed asset, not source maps.

V8 continues sampling while main-thread JavaScript blocks. Publication and
rotation wait for that thread to yield, so a long stall extends the window;
`profileDurationMs` and `intervalMs` expose this rather than claiming a fixed
ten-second interval. Profiling stops briefly while the summary is generated
and logging runs. `profileCollectionMs` and `profileSummaryMs` expose the
synchronous diagnostic collection/summary costs as wall time. Processing retains at most 50,000 nodes, 60,000 samples and
64 frames per stack; `nodesTruncated`, `samplesTruncated`, and `truncatedStacks`
expose those limits. A permanently stuck or killed process cannot publish its
last profile. Raw V8 collection remains in memory until rotation.

This sampler identifies main-isolate JavaScript and V8 GC stacks. Native child
processes, worker threads and off-thread native work contribute CPU totals but
do not have function stacks here. Concurrent tasks are not assigned exact
per-request CPU; async ancestry is not reconstructed. Use existing query phase
spans and maintenance lifecycle events alongside these windows. A profile can
expose a rebuild or serialization hotspot without proving it caused every
concurrent task's delay.
