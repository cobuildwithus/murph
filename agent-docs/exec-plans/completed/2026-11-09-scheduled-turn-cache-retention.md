# Keep scheduled turns on 30-minute prompt-cache retention

Status: completed
Created: 2026-11-09
Updated: 2026-11-09

## Goal

Cut the fixed input cost of scheduled turns without changing anything the
model sees. Scheduled turns and compaction requests stop paying the 12-hour
prompt-cache write rate; conversation turns keep it.

## Evidence

Usage ledger, last 14 days, turns with trigger `automation_cron` (aggregate
metadata only; prices from each row's pricing snapshot, tier adjustment
applied):

| Model | Scheduled spend | Cache writes | 12-hour premium paid |
| --- | ---: | ---: | ---: |
| GPT-6.1 Sol | $28.63 | 12.6M tokens | $17.31 |
| GPT-6.1 Terra | $13.71 | 17.2M tokens | $0.01 so far; $11.42 at the same volume now that #4760 is live |
| GPT-6 Luna | $9.81 | 56.6M tokens | $3.79 |

The premium is the difference between the 12-hour write rate (2.5x input) and
the 30-minute rate (1.25x). It buys a cache hit only when the same thread is
read again between 30 minutes and 12 hours later. Measured on the next turn in
the same session after each scheduled turn:

- Most scheduled turns have no next turn within 12 hours (for example 461 of
  843 morning passes, all 522 memory-maintenance runs).
- When a next turn does arrive 30 minutes to 12 hours later, its first request
  is usually cold anyway (morning pass 113 of 144; optimizer 21 of 22; meal
  closeout 10 of 13; member reminders 77 of 107). Idle compaction often rewrites
  the thread in between.
- Upper bound on what follow-up turns would lose with 30-minute retention,
  pricing every cached first-request token of a reply within 12 hours, or of a
  scheduled turn 30 minutes to 12 hours later, as a re-write: $3.55 per 14 days
  (Sol $2.61, Terra $0.81, Luna $0.13). On Sol, where both sides already use
  12 hours, only 4 of 30 replies that followed a scheduled turn were warm.

Net: about $29 per 14 days at this volume, against about $52 of scheduled
spend (about $63 once Terra pays the 12-hour rate). The morning-pass skip
shipped in #4773 lowers both numbers by removing some of those turns; expect
$25-30.

Provider check (development key, synthetic 23K-token request, GPT-6 Luna):

- `prompt_cache_options: {"ttl":"30m"}` is accepted; usage reports
  `ttl_30m_tokens` 23,158 and `ttl_12h_tokens` 0; the second request on the
  same key reads 23,158 cached tokens.
- A 30-minute request on a prefix written at 12 hours reads the prefix and
  writes only its own 43 new tokens at the 30-minute rate. A later 12-hour
  request still reads the 12-hour prefix.
- The reverse does not hold: a 12-hour request on a prefix written at 30
  minutes reads nothing and re-writes all 23,201 tokens at the 12-hour rate.
  So anything that follows a scheduled turn at 12 hours re-writes what that
  turn added. Idle compaction follows 108 scheduled turns per 14 days, about a
  minute later, and on Sol reads over half its input from cache today; left at
  12 hours it would lose those reads. Compaction requests therefore also use
  30 minutes. Their own writes are not reused: after compaction the thread has
  a new prefix.
- Omitting the option gives the same hits but usage reports no lifetime split,
  so the explicit value is used.

## Design

1. Engine: `turn/start` carries Codex's existing `turnTrigger` field with the
   value `automation-cron` for scheduled turns only. It is per turn, not
   sticky. Codex forwards it as request metadata and gives it no other meaning
   (only `automation_heartbeat_scheduled` is special upstream).
2. Codex patch: `hosted_prompt_cache_options` returns `{"ttl":"30m"}` when the
   turn trigger is `automation-cron` or the request kind is compaction, and
   `{"ttl":"12h"}` otherwise. Model, hosted-process and API-key eligibility are
   unchanged and still owned by that one function.
3. No change to prompts, tools, cache keys, sessions, thread resume, persisted
   state or Web pricing (`usage-allowance.ts` already prices total writes at
   the short rate and adds the reported 12-hour subset).

## Scope

- In scope: the two changes above, their tests, the cache-policy sentence in
  the docs that own it.
- Out of scope: idle-compaction turns, conversation turns, prompt trimming,
  cross-thread sharing of the static prompt (see Decisions).

## Risks and mitigations

1. Risk: a member replies 30 minutes to 12 hours after a reminder and that
   reply re-writes what the reminder turn wrote.
   Mitigation: measured; the bound is $3.55 against $32.5 saved. The reply
   still reads everything earlier conversation turns wrote at 12 hours.
2. Risk: engine and binary skew.
   Mitigation: both ship in one runner image. An old binary ignores the label
   for caching and sends 12 hours; a new binary without the label sends 12
   hours. No durable state, so rollback is a plain revert.
3. Risk: the retention option changes between turns on one thread, so the
   WebSocket path sends a full request instead of an incremental one at that
   boundary (`prompt_cache_options_changed`).
   Mitigation: only at a turn boundary, where the first request is already
   full; prompt-cache reads are unaffected (proved above).
4. Risk: a turn longer than 30 minutes with a 30-minute gap between requests.
   Mitigation: each read refreshes the entry; a gap that long inside one turn
   is a stalled turn.

## Tasks

1. Rust change, patch regenerated for the two files, upstream-source check.
2. Engine change and tests (request builder; real Codex scripted turn).
3. Rebuild the native binary; prove on the wire that a labelled turn and the
   compaction after it send 30 minutes and the next reply on the same thread
   sends 12 hours. Keep that proof as a CI test against the deployed binary.
4. PR, CI, review, merge, runner deploy.
5. Post-deploy: 12-hour write tokens on `automation_cron` rows go to zero;
   in-turn cache hits on requests 2..N unchanged; scheduled spend per turn
   down; first-request cache hits on replies that follow a scheduled turn
   within 12 hours.

## Decisions

- Chosen: 30-minute retention for every `automation-cron` turn, selected per
  turn by the existing trigger field.
- Rejected: per-thread opt-out limited to provably never-resumed threads (the
  earlier agent plan). Retention only matters if a read lands in the 30-minute
  to 12-hour window, and the ledger shows that is rare for every scheduled
  source, resumed or not.
- Rejected: using the Flex tier as the signal. It couples two policies and
  misses scheduled turns that fall back to the standard tier.
- Shelved: one fleet-wide cache key plus an explicit breakpoint after the
  member-invariant prompt, so fresh threads read the static 23K tokens. Live
  replay proved the mechanism (23,251 of 28,017 tokens cached on fresh
  threads), and both parts are required. ReviewGPT plan review
  (`audit-packages/plan-shared-static-prompt-cache.md`) findings:
  - P1 accepted: provider egress authorizes the container, not the caller
    (`runner-egress-intercept.ts` `authorizeHostedProviderEgress`,
    `OPENAI_EGRESS_POLICY`; member turns have network access), so a raw request
    from a member's tools could choose the fleet key and probe for cache hits.
    Exact-prefix matching still applies, but the claim that members cannot
    query the namespace is false. Closing it needs new egress machinery.
  - P2 accepted: an in-band marker becomes durable thread history and needs a
    rollback floor; hosted prompt updates do not rotate threads.
  - P2 accepted: eligibility needs one owner across auth modes and catalogs.
  - P2 accepted: the replay's `inputCostUnits` uses the wrong write rate;
    this plan prices from the ledger snapshot instead.
  - The saving shrinks with cohorts ($5-19 per 14 days at 5 to 10 cohorts per
    model) and after this change is smaller still. Not worth the privacy and
    lifecycle cost now; needs an owner decision to revisit.

## Verification

- `pnpm --dir apps/cloudflare verify:codex-upstream-source`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-base-image.test.ts apps/cloudflare/test/container-image-contract.test.ts --no-coverage`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime-config.test.ts`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-scripted-runtime.test.ts -t "labels only the scheduled turn"`
- The same file with `MURPH_TEST_CODEX_COMMAND=<patched binary>` and
  `-t "keeps scheduled turns and compaction on 30-minute cache retention"`
  (also added to the runner permission sandbox workflow).
- `pnpm --dir packages/assistant-engine typecheck`
- Rust unit test `hosted_cache_ttl_requires_managed_api_key_and_supported_model`
  and the wire proof with the rebuilt binary.
Completed: 2026-11-09
