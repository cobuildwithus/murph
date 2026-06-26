# 2026-06-25 iMessage Line Flag Evidence

Status: point-in-time investigation note  
Updated: 2026-06-26  
Scope: hosted Linq/iMessage activity leading up to and after the reported line flag

## Privacy Boundary

This file intentionally omits legal names, local filesystem paths, phone
numbers, raw user IDs, chat IDs, message IDs, provider request IDs, message
bodies, raw credentials, and raw provider payloads.

Where the underlying evidence contained a direct identifier, this note uses a
role-based label such as `dominant account/line` or `flagged line` instead.

## Reported Event

- A provider-side contact confirmed that the line was flagged by Apple at
  approximately 40 minutes before a 3:34 PM message on 2026-06-25.
- Assuming the operator's local timezone was Eastern time, the estimated flag
  time is approximately 2026-06-25 18:54 UTC.
- An alternate Pacific-time interpretation was checked at approximately
  2026-06-25 22:54 UTC. It did not show a comparable Linq provider-egress
  burst in Cloudflare logs.

## Sources Inspected

- Provided partner PDF: `iMessage Best Practices Guide Technical 041426.pdf`.
- Repo deliverability policy: `agent-docs/operations/imessage-deliverability.md`.
- Hosted Linq webhook and transport code:
  - `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
  - `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`
  - `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
  - `apps/web/src/lib/hosted-onboarding/linq-client.ts`
- Runtime typing/channel code:
  - `packages/assistant-engine/src/assistant/channels/runtime.ts`
  - `packages/assistant-engine/src/assistant/channel-typing.ts`
  - `packages/assistant-engine/src/assistant/local-service.ts`
  - `packages/assistant-runtime/src/hosted-runtime/channel-activity.ts`
  - `packages/operator-config/src/linq-runtime.ts`
- Cloudflare provider-egress logs for worker `murph-hosted`.
- Read-only Postgres tables:
  - `hosted_runtime_log`
  - `hosted_ingress_latency_trace`
  - `hosted_linq_daily_state`
  - `hosted_mailbox_item`
- Related OpenAI egress handoff:
  - `docs/incidents/2026-06-25-hosted-openai-egress-401.md`

## Best-Practice Baseline

The partner PDF and repo deliverability policy both treat these as high-risk
patterns for Apple line health:

- More than roughly 50 net-new conversations per day per line.
- Burst sending.
- Repeated or templated-looking messages with weak recipient reply behavior.
- One-way outbound patterns that do not earn replies within the first three
  outbound messages.
- Shortened/link-first copy.
- Continuing automated sending after a line is suspected or known flagged.
- Continuing retries through a flagged or unhealthy line.

The repo policy specifically says to stop all automated sending when a line is
suspected or known flagged.

## High-Level Conclusion

The evidence does not support the initial hypothesis of a Linq/iMessage `401`
storm. A separate OpenAI/Codex `401` storm did occur earlier in the incident
window and produced scoped assistant reply failures, but the provider-facing
Linq evidence does not show Linq `401` responses. The evidence does support a
deliverability-risk incident caused by high Linq provider activity, especially
typing-indicator churn and outbound message volume, concentrated around the
estimated flag time.

The most suspicious provider-visible behavior was:

- 58 successful Linq typing starts in the 4-minute window from 18:52 to 18:56
  UTC.
- 7 successful Linq message sends and 7 successful message deletes in that same
  4-minute window.
- 408 Linq typing operations in the broader 17:30 to 19:30 UTC incident window.
- 80 Linq message sends in that broader 17:30 to 19:30 UTC incident window.
- 104 successful Linq deliveries logged in DB outbox summaries for 2026-06-25
  UTC, with one dominant account/line responsible for 86 of them.
- 97 additional retryable Linq delivery attempts for the dominant account/line
  that failed before provider send because secure vault-file approval was
  unavailable.
- Successful Linq deliveries continued after the estimated flag time.

## Timeline

All timestamps are UTC unless otherwise noted.

| Time | Evidence |
| --- | --- |
| 2026-06-25 00:00-18:53 | DB outbox summaries recorded 90 successful Linq deliveries before the estimated flag time, plus 69 retryable Linq attempts. |
| 2026-06-25 16:17-16:58 | Scoped runtime logs recorded 142 `ASSISTANT_CODEX_FAILED` reply failures and 142 Codex resume-failure diagnostics. This was OpenAI/Codex-side, not Linq-side. |
| 2026-06-25 17:30-19:30 | Cloudflare logged 306 successful Linq typing starts, 102 successful typing/message stops/deletes, 80 successful Linq message sends, 53 successful message deletes, 4 attachment fetches, 4 message-delete 404s, 2 malformed typing 400s, 2 voice memo sends, 1 chat creation, and 1 reaction send. |
| 2026-06-25 18:38 | Scoped runtime logs recorded an OpenAI `responses_compact` provider-egress diagnostic for `gpt-5.5`. |
| 2026-06-25 18:30-19:15 | Cloudflare logged 143 successful typing starts, 17 successful typing stops, 26 successful message sends, 34 successful message deletes, and 3 attachment fetches. |
| 2026-06-25 18:52-18:56 | Cloudflare logged 58 successful typing starts, 3 successful typing stops, 7 successful message sends, and 7 successful message deletes. This is the tightest spike around the estimated flag time. |
| Approximately 2026-06-25 18:54 | Estimated Apple flag time if the 3:34 PM provider confirmation was Eastern time and "40 minutes ago" was exact. |
| 2026-06-25 18:54 | Scoped runtime logs recorded another OpenAI `responses_compact` provider-egress diagnostic for `gpt-5.5`. This is not a Linq diagnostic. |
| 2026-06-25 18:54-23:37 | DB outbox summaries recorded 14 successful Linq sends and 28 retryable Linq attempts after the estimated flag time. |
| 2026-06-25 22:30-23:15 | Alternate Pacific-time interpretation was checked. Cloudflare did not show a comparable Linq provider-egress burst in this window. |

## Cloudflare Provider-Egress Evidence

Cloudflare structured provider-egress logs for `murph-hosted` expose method,
provider kind, redacted provider path, HTTP status, and success/failure status.

Full-day Linq provider-egress counts for 2026-06-25 UTC:

| Method/status | Count | Interpretation |
| --- | ---: | --- |
| `POST 204` | 2,999 | Mostly successful Linq typing starts. |
| `DELETE 204` | 1,008 | Successful typing stops and message deletes. |
| `POST 202` | 662 | Successful Linq message/reaction/voice memo sends. Most were chat message sends. |
| `DELETE 404` | 13 | Failed deletes against already-missing or invalid message resources. |
| `POST 400` | 11 | Bad Linq requests. Two were malformed typing-target requests in the incident window. |
| `GET 200` | 9 | Successful attachment fetches. |
| `POST 200` | 2 | Successful attachment or auxiliary calls. |
| `POST 201` | 1 | Successful chat creation. |

Full-day Linq `401` count:

- No aggregation rows were returned for `details.responseStatus = 401`.
- This was checked across the full UTC day, not just the incident window.
- This weakens the `401 storm` hypothesis.

OpenAI/Codex `401` evidence, 16:00-21:00 UTC:

| Provider/method/status | Count | Interpretation |
| --- | ---: | --- |
| OpenAI `GET 401` | 600 | Worker refused/failed OpenAI egress authorization. |
| OpenAI `POST 401` | 565 | Worker refused/failed OpenAI egress authorization. |
| OpenAI total `401` | 1,165 | Confirms a real OpenAI/Codex-side `401` storm. |

Interpretation:

- The `401` storm was real, but it was not a Linq/iMessage auth storm.
- This matches the scoped DB evidence where `ASSISTANT_CODEX_FAILED` reply
  failures occurred before the estimated Apple flag time.
- The related handoff file has the deeper OpenAI egress failure analysis.

Broad incident window, 17:30-19:30 UTC:

| Provider path class | Method/status | Count |
| --- | --- | ---: |
| Chat typing | `POST 204` | 306 |
| Chat typing | `DELETE 204` | 102 |
| Chat messages | `POST 202` | 80 |
| Message delete | `DELETE 204` | 53 |
| Attachment fetch | `GET 200` | 4 |
| Message delete | `DELETE 404` | 4 |
| Malformed typing target | `POST 400` | 2 |
| Voice memo | `POST 202` | 2 |
| Chat creation | `POST 201` | 1 |
| Reaction | `POST 202` | 1 |

Focused flag window, 18:52-18:56 UTC:

| Provider action | Count |
| --- | ---: |
| Successful typing starts | 58 |
| Successful typing stops | 3 |
| Successful chat message sends | 7 |
| Successful message deletes | 7 |

Interpretation:

- The tight 18:52-18:56 UTC spike aligns closely with the estimated Apple flag
  time.
- The provider saw a high typing-to-message ratio and dense automated-looking
  activity.
- The provider did not see a Linq auth failure storm.

## Database Evidence

### Runtime Failure Evidence

For the dominant account/line, scoped `hosted_runtime_log` evidence from
16:00-21:00 UTC included:

| Event shape | Count | Window |
| --- | ---: | --- |
| `assistant.automation_detail`, info/no error | 5,995 | 16:03:10-20:58:11 |
| `assistant.pass_finished` | 239 | 16:03-20:58 |
| `mailbox.imported` | 462 | 16:03-20:58 |
| `mailbox.appended` | 60 | 16:03-20:58 |
| `outbox.delivery_finished`, info | 36 | 16:03-20:54 |
| `outbox.delivery_finished`, warn | 24 | 16:03-20:50 |
| `assistant.automation_detail` with `ASSISTANT_CODEX_FAILED` | 142 | 16:17:02-16:58:52 |
| `runner.provider_egress_diagnostic` | 2 | 18:38:34 and 18:54:56 |

The two scoped `runner.provider_egress_diagnostic` rows were OpenAI
`responses_compact` requests for model `gpt-5.5`. They were not Linq egress
diagnostics.

`checkpoint.snapshot_failed` scoped rows in the same 16:00-21:00 UTC window:

- 3 `authorization_error` rows from 16:14:06-18:13:37.
- 7 `checkpoint_error` rows from 18:29:33-20:57:56.
- 1 `runtime_error` row at 19:36:32.

### Outbox Delivery Summaries

For 2026-06-25 UTC, DB outbox summaries showed:

| Segment | Linq delivery logs | Successful Linq deliveries | Retryable Linq attempts |
| --- | ---: | ---: | ---: |
| Before estimated flag time | 157 | 90 | 69 |
| After estimated flag time | 42 | 14 | 28 |
| Full day | 199 | 104 | 97 |

Dominant account/line contribution for 2026-06-25 UTC:

| Metric | Count |
| --- | ---: |
| Linq delivery logs | 181 |
| Successful Linq deliveries | 86 |
| Retryable Linq attempts | 97 |
| First Linq delivery log | 00:03:58 UTC |
| Last Linq delivery log | 23:37:12 UTC |

The 97 retryable attempts had the delivery error summary
`ASSISTANT_VAULT_FILE_APPROVAL_UNAVAILABLE`. They were not successful provider
sends, but they are evidence of repeated delivery churn for the same
account/line.

### Ingress Latency Traces

Between 17:30 and 19:30 UTC:

- The dominant account/line had 27 ingress traces.
- All 27 reached provider start.
- Average time from accepted ingress to provider start was roughly 13 seconds.
- Maximum time from accepted ingress to provider start was roughly 210 seconds.
- Only one other account had an ingress trace in this window.

Interpretation:

- The incident-window work was heavily concentrated on one account/line.
- Runtime provider work was not merely queued; it was actively reaching provider
  start.

### Hosted Linq Daily State

The daily state table showed inbound-heavy activity but did not reliably reflect
outbound delivery volume:

| UTC date | Members | Inbound total | Outbound total in daily state |
| --- | ---: | ---: | ---: |
| 2026-06-24 | 7 | 138 | 0 |
| 2026-06-25 | 6 | 106 | 0 |
| 2026-06-26 | 2 | 3 | 0 |

For 2026-06-25, the dominant account/line accounted for 97 inbound events in
this table.

Interpretation:

- `hosted_linq_daily_state` is not sufficient as an outbound line-volume guard.
- Actual outbox/provider egress logs must be used for outbound quota and line
  health enforcement.

## Code-Path Evidence

### Inbound Typing Webhooks

`apps/web/src/lib/hosted-onboarding/webhook-service.ts` ignores inbound Linq
typing events before planning, Prisma mailbox append, Temporal wake, Cloudflare
wake, or read-receipt side effects.

Evidence:

- The code returns a `typing-ignored` result for
  `chat.typing_indicator.started`.

Interpretation:

- The incident was unlikely to be caused by inbound typing webhooks directly
  waking the runtime in a loop.

### Linq Send Errors

`apps/web/src/lib/hosted-onboarding/linq-client.ts` treats Linq send failures as
non-OK HTTP errors. Retryability is limited to 429 and 5xx classes.

Interpretation:

- A Linq `401` would not be expected to retry indefinitely through this path.
- This matches the Cloudflare evidence showing no Linq `401` storm.

### Runtime Typing Indicators

`packages/assistant-engine/src/assistant/channels/runtime.ts` defines:

- Linq typing refresh interval: 45 seconds.
- Maximum Linq typing session: 5 minutes.

`packages/assistant-engine/src/assistant/channel-typing.ts` starts typing only
when response delivery is enabled. `local-service.ts` starts typing before the
user turn is fully persisted and stops it in a `finally` path. Progress delivery
can refresh typing indicators during a turn.

Interpretation:

- Runtime-generated typing indicators are real provider calls.
- Long-running or repeated turns can create repeated provider-visible typing
  starts/stops even if final message delivery is blocked or delayed.

### Cloudflare Provider-Egress Logging

`apps/cloudflare/src/runner-egress-intercept.ts` emits
`Hosted runner provider egress completed.` with provider kind, method, status,
success/failure, host, redacted path, and authorization metadata.

Interpretation:

- Cloudflare provider-egress logs are the strongest source for provider-visible
  Linq HTTP activity.

## Hypotheses Checked

### Hypothesis: Linq `401` storm caused the flag

Status: not supported.

Evidence:

- No Linq `401` provider-egress rows were found for the full UTC day.
- The app code does not classify Linq `401` as retryable for chat sends.

### Hypothesis: Typing indicator cycling contributed to the flag

Status: strongly supported.

Evidence:

- 2,999 successful Linq typing starts across the UTC day.
- 408 Linq typing operations between 17:30 and 19:30 UTC.
- 58 successful typing starts in the 4-minute window around the estimated flag.
- Runtime code refreshes typing every 45 seconds during active sessions and can
  refresh during progress delivery.

### Hypothesis: Pre-built or repeated messages contributed to the flag

Status: partially supported; content not inspected.

Evidence:

- Cloudflare logged 662 successful Linq `POST 202` provider calls across the UTC
  day, most of which were chat message sends.
- DB outbox summaries logged 104 successful Linq deliveries, including 86 for
  one dominant account/line.
- The investigation did not inspect message bodies, so it cannot prove content
  sameness or template repetition.

### Hypothesis: Inbound typing webhooks woke the runtime in a loop

Status: not supported by code path.

Evidence:

- Inbound Linq typing webhooks are ignored early and should not append mailbox
  items, signal Temporal, wake Cloudflare, or send read receipts.

### Hypothesis: A retry loop contributed to churn

Status: supported, but not as provider-sent messages.

Evidence:

- 97 retryable Linq delivery attempts failed before provider send with
  `ASSISTANT_VAULT_FILE_APPROVAL_UNAVAILABLE`.
- These did not become successful Linq sends, but they indicate repeated
  delivery attempts around the same account/line.

## Important Gaps

- No Apple-side enforcement logs were available, so the exact Apple classifier
  reason cannot be proven from first-party Apple evidence.
- The provider confirmation gives the approximate flag time, but not the exact
  server-side Apple timestamp.
- Message bodies were not inspected. This note cannot prove that sent messages
  were identical, templated, link-heavy, or otherwise content-risky.
- The discrepancy between Cloudflare's 662 Linq message-like `POST 202` calls
  and DB outbox's 104 successful Linq delivery summaries needs follow-up. It may
  reflect progress messages, side-effect sends, differences in logging scope, or
  outbox summaries that do not cover every provider-visible message call.
- The line-level net-new conversation count was not directly available from the
  inspected daily state table because that table did not reflect outbound volume.

## Recommended Follow-Ups

1. Add a provider-line kill switch that disables Linq sends, typing indicators,
   message deletes, reactions, and voice memos for a flagged line.
2. Enforce line-level daily and burst quotas from actual provider egress and
   outbox delivery logs, not `hosted_linq_daily_state` outbound counters.
3. Cap Linq typing starts per account, chat, turn, and provider line. Consider
   disabling refreshes unless a turn is demonstrably active and below line-health
   thresholds.
4. Treat `ASSISTANT_VAULT_FILE_APPROVAL_UNAVAILABLE` as blocked/manual-action
   rather than a retryable delivery state that can keep runtime churn alive.
5. Alert on:
   - Linq `401`, `403`, `429`, and elevated `400`/`404` rates.
   - Typing starts per minute.
   - Typing-to-message ratio.
   - Successful sends per line per day.
   - Successful sends after a line is suspected flagged.
6. Add a content-safe audit that uses template IDs or content hashes, not raw
   message bodies, to identify repeated/pre-built outbound copy.
7. Investigate why Cloudflare provider-egress message counts substantially exceed
   DB outbox successful delivery summaries.
