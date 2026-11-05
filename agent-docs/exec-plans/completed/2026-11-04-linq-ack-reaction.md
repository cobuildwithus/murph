# Emoji acknowledgment reaction before slow replies

Status: completed
Created: 2026-11-04
Updated: 2026-11-04

## Goal

When a member texts Murph a request that takes real work, Murph puts one
topical emoji tapback on that message within about a second ("⏰" on a
reminder request, "📊" on "how did I sleep"). This is the
Instinct-style "on it" signal. It is judicious: no tapback on chat, thanks,
feelings, quick questions, or heavy moments (grief, crisis, injury), and at
most one per burst of messages. When the tapback went out, the runner's
`send_progress_update` text for that burst is suppressed so the two never
clash. Owner asks: send from the Web so it is fast; add no latency to the
existing reply path; never block later API requests or container wakeups.

## Success criteria

- Live eval `pnpm --dir apps/web linq:ack-reaction-eval` passes on the
  production prompt (175 cases + 25 bursts, synthetic): 0 false reactions,
  0 wrong emoji, recall >= 95% on must-react cases, <= 1 burst miss. Current
  result: 79/79 must-react, 0 false, 25/25 bursts, p50 ~250 ms, p90 ~500 ms.
- Webhook response time and mailbox wake timing unchanged. The work runs
  after the wake handoff through the existing `scheduleAfterResponse`
  (`after()`); nothing on the request path awaits it.
- Runner reply path unchanged. Progress updates add one indexed read on the
  engagement call they already make.
- Any failure (OpenAI, Linq, DB, timeout) fails closed to "no tapback" and
  never throws into the webhook.

## Design

### Classifier (Web, done)

`apps/web/src/lib/hosted-onboarding/linq-ack-reaction-classifier.ts` makes
one `POST https://api.openai.com/v1/decisions` (`gpt-6-luna`, the only
Decisions model) with two questions:

- `heavy` predicate: grief, frightening diagnosis, injury or emergency,
  crisis, panic, depression, shame. Ordinary venting and routine health
  questions or results are excluded.
- `kind` choice: reminder ⏰, my_data 📊, research 🔎, make 📝, look 👀,
  picture 🎨, song 🎶, calendar 📅, challenge 🏆, log, none.

The message reacts iff heavy < 0.5 and kind is not `log`/`none`.
- Input is the latest message only: text parts plus signed Linq image URLs
  from the raw event. The Web stores no plaintext conversation context.
- Plain `fetch`, because SDK 6.45 has no Decisions resource. Price is
  $0.10/1M input tokens with no output charge; ~800–1,000 tokens is about
  $0.0001 per message. No member usage record: platform cost, negligible.
- Prompt history: an 11-variant prototype on ~200 cases converged on this
  wording. Two fixes mattered: "log = words only; a food photo is look" and
  "research = must search now; general knowledge is none". A third ("heavy
  excludes venting and routine results") fixed the bursts.

### Trigger (Web)

`webhook-service.ts` calls `maybeScheduleHostedLinqAckReaction` right after
`runPendingInstantStartActivationWake()`, beside the read receipt. The mailbox
append has committed and the wake handoff has settled by then.

Gate (synchronous, about 6 µs):
- `plan.response.reason === "wake-appended-active-member"`, which already
  excludes webhook replays (`duplicate-webhook-event`) and group routes
- `currentInboundReply` matches the chat and message, which excludes converted
  member reactions
- not instant-first-turn owned
- `wakeHandoff.conversationIsGroup === false`, `wakeHandoffResult.started`
- iMessage, `!is_from_me`, and `webhookReceivedAt` present (the burst cutoff)
- `HOSTED_LINQ_ACK_REACTIONS=on` and an OpenAI key
- an after-response scheduler is present; without one it skips and never
  runs inline

The webhook never awaits classification or the tapback. The route's
`after()` fallback (`void task()`) is safe because the task never throws.

### Burst state (Web DB)

Table `hosted_linq_ack_reaction`, one row per direct chat. Columns:
`linq_chat_lookup_key` PK, plus `claimed_at`, `reacted_at`, `heavy_at` and
`updated_at`, all `TIMESTAMP(3)` so tokens round-trip a JS `Date` exactly.

- **Burst**: member messages after the chat's latest
  `hosted_linq_delivery.attempted_at`, read across all chat lookup key versions.
- **Claim**: a short transaction under the chat ownership lock, the same lock
  the engagement route holds around the dispatch fence. It reserves
  (`claimed_at = now`, `reacted_at = NULL`) only when:
  - there has been no outbound since the message arrived, and
  - no `claimed_at` or `heavy_at` row (any key version) is later than that
    boundary.
- **Confirm**: set `reacted_at` where `claimed_at` equals our token.
- **Release**: clear `claimed_at` for our exact token, and only while it is
  unconfirmed. It runs only after a definite Linq refusal (any 4xx except 408),
  or when the deadline passed before sending. A timeout, transport error or 5xx
  keeps the reservation, so a lost response can't become a second tapback.
- **Heavy**: under the lock, set `heavy_at = now` only while no outbound has
  happened since the message arrived. A late heavy result can't silence the
  next burst.
- Every store transaction uses `maxWait` 500 ms and `timeout` 1.5 s, plus local
  `lock_timeout` 300 ms and `statement_timeout` 500 ms. Under contention the
  optional tapback is dropped. The lock is never held across a network call.

### Reaction send (Web)

`addHostedLinqMessageReaction` in `linq-client.ts` mirrors the read receipt:
`messages.addReaction(id, { operation: "add", type: "custom", custom_emoji })`.
It uses the shared SDK wrapper (`maxRetries: 0`) and Linq's default part 0,
which is the photo in a photo+caption message.

### Deadline

- One 4 s budget per task.
- The classifier gets `min(3 s, remaining)` and drops a late decision.
- No claim or send happens with under 250 ms left.
- Linq gets exactly the remaining budget.

### Progress-update suppression (runner + Web)

1. Contract: optional `deliveryPurpose: "progress_update"` on the engagement
   request, and optional `progressUpdateSuppressed` on the result. The
   Cloudflare decoder passes the flag through. The runtime's duplicate
   field-by-field normalizer is deleted, and route parsing moved into
   `requireHostedAssistantLinqResolvedRoute`.
2. `createHostedAssistantProgressDeliveryDependencies` tags its Linq send. The
   purpose rides only the resolved, provider-entry engagement calls.
3. Web checks only on the final `authorityCheckOnly: false` call for a direct
   thread, inside the transaction that already holds the chat lock, right
   before the dispatch fence.
   - Covered (`reacted_at` set and `claimed_at` after the last outbound):
     return `progressUpdateSuppressed` and record no fence.
   - Ordinary replies do no ack read; progress does exactly one.
4. The runner throws `ASSISTANT_PROGRESS_UPDATE_ACKNOWLEDGED` before the
   dispatch-claim check (pre-provider). The engine maps it, even when wrapped,
   to `{ kind: "skipped", reason: "acknowledged" }`, and the tool returns a
   handled no-op text.
5. Deploy skew: an old runner never sends the purpose; an old Web ignores it.
   The default-off switch covers the remaining "new Web, old runner" gap.

### Observability

One `hosted-onboarding.webhook.linq.ack-reaction` diagnostic per task, with no
message content. It carries outcome, kind, heavy flag, HTTP status, error
name, classifier ms and total ms. Outcomes:
`reacted | reacted_unconfirmed | quiet | heavy | answered_or_burst_taken | expired | provider_refused | provider_ambiguous | classifier_error | store_error | skipped_empty`.

### Rollout and kill switch

`HOSTED_LINQ_ACK_REACTIONS` is off unless set to `on`. The key is
`HOSTED_LINQ_ACK_REACTION_OPENAI_API_KEY ?? OPENAI_API_KEY`.

Order:
1. Merge: the migration plus Web, deployed with reactions off.
2. Deploy the Cloudflare runner.
3. Set `HOSTED_LINQ_ACK_REACTIONS=on` in Vercel production and redeploy.

Rollback: set it off first, then revert the runner if needed. Keep the
additive table.

## Scope

- In scope: classifier, eval, trigger, burst state + migration, Linq reaction
  send, engagement-route suppression, runner skip handling, tests, docs.
- Out of scope: groups (lurking rule), SMS (tapbacks degrade to text),
  conversation context (Web has none in plaintext), removing the tapback
  after the reply, a `log` ✍️ emoji, member usage accounting.

## Risks and mitigations

1. **Tapback after Murph already replied.** A claim after a recorded outbound
   is refused under the lock. A reply that lands during the ~100–300 ms send
   window can still precede the tapback; accepted.
2. **Progress during the send window.** Suppression needs a confirmed tapback.
   A progress update that reaches its fence between claim and confirm still
   sends, so both may show. Progress first fires around 6 s at p50 and the
   window is under 0.3 s. Accepted.
3. **Assistant `react_to_message` replaces our emoji.** iMessage keeps one
   tapback per sender. Accepted.
4. **Heavy and task messages within ~300 ms, task decision first.** The task
   may get an emoji. Rare; accepted.
5. **Signed media URL not fetchable.** The Decisions call fails and the task
   ends quiet. A live remote-URL check reacted in 317–351 ms.
6. **OpenAI tail latency or cost.** The 3 s cutoff, the 4 s task budget, the
   kill switch and per-task diagnostics cover it.
7. **Key rotation.** Claims and reads scan every configured key version.

## Plan review (ReviewGPT, apollo, 2026-11-04)

Response: `audit-packages/plan-linq-ack-reaction.md`.

1. **P1, one arbitration owner and reservation vs confirmed.** Accepted.
   - Claims and heavy marks take the chat ownership lock.
   - The progress check moved to the fenced final call under that lock.
   - Reservation (`claimed_at`) is now separate from confirmation (`reacted_at`).
   - Only confirmed tapbacks suppress progress; the pending-window overlap is
     accepted (risk 2).
   - Release only on definite refusal.
   - Key-version scan.
   - Proof: two-connection lock test with a held fence, plus stale-release,
     confirmed-release and prior-key tests.
2. **P2, delete the runtime's second normalizer.** Accepted.
   - Deleted it and moved route parsing into the require helper.
   - Suppression is handled before the dispatch-claim requirement.
   - The existing contradictory-route test still passes (320/320).
3. **P2, bind writes to their input.** Accepted.
   - The heavy write is guarded by "no outbound since this message".
   - Confirm and release match the exact token.
   - Timestamp precision is pinned at `TIMESTAMP(3)`.
   - Proof: late-heavy and stale-release Postgres tests.
4. **P2, one deadline and bounded DB work.** Accepted.
   - One 4 s budget, with no claim or send when it is nearly spent.
   - Transaction `maxWait`/`timeout` plus local lock and statement timeouts.
   - Release when the deadline passed before sending.
5. **P2, use the kill switch as the activation barrier.** Accepted.
   - Default off; enable after the runner deploy (rollout above).
- **Eval note.** Accepted: the live eval uses the production 3 s cutoff and
  counts drops as misses. Burst arbitration is proven against the real store,
  not the eval's input-order fold.
- **Scheduling note.** Kept the placement. The stated guarantee is now "the
  webhook never awaits it", and a webhook-service test proves the call happens
  after the wake handoff with the task left pending.

## Tasks

1. Classifier + eval + fixtures (done; eval PASS at 3 s cutoff).
2. Migration, store and Postgres proof (done).
3. `addHostedLinqMessageReaction` (done).
4. Orchestration with gate, deadline, confirm and release, plus unit tests (done).
5. Webhook-service hook plus a wiring test (done).
6. Engagement-route suppression plus route tests (done).
7. Runner contract, normalizer deletion, skip mapping, tool text, tests (done).
8. Env, SECURITY.md, `.env.example` (done). Live journeys (see Verification).

## Decisions

- Judge the latest message alone. Burst context added nothing (24/25 both
  ways) and would cost a Linq thread read.
- Web-side trigger, not the runner, for speed (owner).
- Suppress progress updates only when our tapback covered the burst (owner).
  Covered means Linq confirmed it.

## Verification

- `pnpm --dir apps/web linq:ack-reaction-eval` (live Decisions API, 3 s cutoff):
  PASS, 79/79 must-react, 0 false, 0 wrong, 0 dropped, 25/25 bursts. Latency
  p50 211 ms, p90 417 ms, p99 1,067 ms.
- Live end-to-end, `hosted-onboarding-linq-ack-reaction-live.test.ts` (opt-in,
  real Decisions API + local Postgres):
  - Receipt to tapback: p50 328–475 ms, p90 658–998 ms with 10 concurrent.
  - Remote photo URL: 317–351 ms.
  - Schedule cost per webhook: 5.5–7.7 µs.
  - Bursts: one tapback per burst, none for a heavy burst, none after an answer.
- Postgres proof, `hosted-onboarding-linq-ack-reaction-postgres.test.ts`: 7/7.
- Focused Web, engine and runtime tests; Web, engine, runtime and Cloudflare
  typecheck.
- Real-Codex journey: "ack tapback covers the early update and the reply never
  mentions it".
- Required PR CI and ReviewGPT.
Completed: 2026-11-04
