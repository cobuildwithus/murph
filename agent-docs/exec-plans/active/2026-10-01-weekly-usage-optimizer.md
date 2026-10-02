# Weekly usage optimizer and private usage diagnostics

Status: active
Created: 2026-10-01
Updated: 2026-10-01

## Goal and product outcome

Reduce avoidable automation cost while preserving explicit member choices and
quality. A private hosted weekly automation uses GPT-6.1 Sol medium to review
bounded usage metadata, downgrade suitable ordinary automations to Luna, and
submit one anonymous product report. Members receive no unsolicited weekly text.

## Owners and boundaries

- Canonical automation records and versioned patches remain in the vault.
- Hosted AI usage remains the sole cost ledger; no vault copy or new database.
- Signed member-bound Web callbacks serve bounded private diagnostics; groups
  are excluded. Missing older-runtime support returns unavailable.
- Existing feedback persistence owns the anonymous report. Only the exact
  built-in private scheduled occurrence receives the new feedback authority;
  ordinary scheduled turns remain ineligible. No support-email authority.
- Preserve explicit member model requirements, managed pins, schedule, route,
  instructions, and inactive records. Auto-authored model pins may be optimized.

## Scope and implementation

1. Add hosted usage aggregate contract, signed callback, runtime port, dynamic
   tool, token/model/source/top-turn costs, canonical rates and byte attribution.
2. Seed a fresh-context weekly Sol medium task through existing managed lifecycle.
3. Reuse optimistic concurrency for model-only patches and bounded anonymous
   feedback with member/occurrence idempotency.
4. Update durable contracts; add deterministic and focused real-Codex proof.

## Risks and mitigations

- Partial telemetry is not zero: report coverage and bytes, never invented tool
  token costs. Exclude private text and identifying metadata from feedback.
- Bound database queries by one member and at most 31 days, returned groups and
  top turns. Bound the weekly review and acknowledge incomplete inventories.
- Deploy Web consumer before Worker/runtime producers; old runtime ports degrade
  gracefully. No deployment or production data mutation in this task.

## Verification and experience replay

- Deterministic: member/group authorization, read bounds, canonical prices,
  tool bytes, absent port, versioned patches, seed identity/cadence/model,
  single feedback candidate and anonymous persistence.
- Live synthetic Sol medium optimizer journey: eligible simple/contextual
  reminder changes; explicit preference, managed and sensitive work retained;
  one report and no message. Focused Luna journey validates the newly eligible
  bounded lookup reminder without unrelated reads or mutation.
- Focused package/app tests and relevant typechecks. No private fixtures, auth
  material or production connections. Parent owns final review and PR delivery.

## Progress

- Dependency install completed with frozen lockfile; Frog catalog inspected.
- Implemented the diagnostics transport, weekly seed, exact scheduled feedback,
  canonical model/managed inspection and patch readback, and anonymous persistence.
- New fixed managed workflow feature keys distinguish Morning Journal, Personal
  Patterns, research and optimizer self-cost in future ledger rows. Older generic
  rows remain unattributed; no title inference or historical rewrite.
- Current independent inventory surface caps at 200 rows, 30 candidate inspections
  and ten changes; incomplete coverage is explicit. The companion runtime change
  adds paginated batch instructions but is not required by this branch.
- Deterministic tests cover member isolation, SQL aggregates, absence/coverage,
  model readback, private occurrence authority, idempotency, and real cron wiring.
- Live GPT-6.1 Sol medium private diagnostics and weekly optimizer: Ready. Optimizer
  confirmed two model-only Luna changes, retained explicit choice/complex work,
  reported real synthetic costs/bytes and stayed silent. A prior run exposed missing
  model readback; the owning runtime projection and tool serializer were repaired.
- Live GPT-6 Luna high bounded completion read: Ready; exactly one read, no writes,
  and skip for an already completed occurrence.
- Engine, runtime, Web and Cloudflare typechecks passed. Complexity and diff checks
  passed; exact-head CI and final review remain parent-owned.
- Changelog: 2026-10-02 weekly-usage-review; unmerged entry has no source PRs.
  Public copy and archive render tests passed using the existing presentation.

## Initial provider input proof

- PASS: `MURPH_MEASURE_WEEKLY_USAGE_INPUT=1 pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-weekly-usage-input-measurement.test.ts` (two synthetic fixtures).
- Real pinned Codex CLI 0.159.1, GPT-6.1 Sol hosted mixed-mode catalog, native
  delegation enabled, credential-free loopback Responses endpoint. The exact
  `4cd1e58609` system prompt, tool catalog, and automation definitions are compared
  with the candidate; unchanged dependencies are shared. The baseline catalog
  import points to its baseline automation definition. No Codex CLI source edits.
- Complete first-request UTF-8 bytes: private 165,247 to 165,353, +106 (+0.064146%);
  group 142,993 to 143,099, +106 (+0.074130%). This measures ordinary first turns,
  not the weekly task's own instructions or its later tool responses.
- Includes all assembled input/instructions, eager and deferred tool conversion,
  generated guidance, and remaining request fields: `client_metadata`, `include`,
  `input`, `model`, `parallel_tool_calls`, `reasoning`, `store`, `stream`, `text`,
  and `tool_choice`. Only the nondeterministic transport `prompt_cache_key` is
  excluded. Full request contents are never printed or persisted.
- The private candidate registers the new deferred usage tool, but neither its
  name nor schema appears in the initial provider request; group registration
  excludes it. The measured ordinary growth comes from the scheduled-feedback
  instruction. Registration metadata is reported separately from request bytes.
- Exact GPT-6.1 Sol tokenizer unavailable: absolute tokens, token delta, and
  token percentage are unavailable; no approximate tokens or billed savings
  are claimed. Candidate source was measured before the final commit.

## Advisory review corrections and final checks

- Real scheduled notifications now forward the accepted report only after a
  successful skip/send commit or finalization. Fourteen composed cron scenarios
  cover commit waits, delivery modes, cancellation and failures; existing
  notification and audience tests also pass (123 tests total in that run).
- Tool attribution accepts canonical command-family labels containing spaces;
  arbitrary private command strings still fail the canonical contract.
- Allowance totals and expensive-turn ranking count only allowance-counted rows.
  Excluded records remain visible as workload/coverage without inflated charges;
  synthetic PostgreSQL proof includes a forgiven high-cost row.
- Anonymous audit IDs use a domain-separated HMAC with the existing required
  server session key and authenticated member/occurrence scope. Replay dedupes,
  distinct members remain separate, missing key fails closed, and no direct
  member link or enumerable plain hash is stored.
- The dedicated signed usage-feedback callback is an explicit rollout fence:
  old Web returns 404 and never falls back to ordinary feedback persistence.
  Deploy Web before Worker allowlist/runtime producers. Ordinary feedback is
  unchanged; reports remain best effort after successful turn completion.
- Final focused checks: engine 70 tests plus engine/runtime typechecks; Web audit
  service/route 22 tests plus prepared Web typecheck; Cloudflare feedback 6 tests,
  outbound forwarding 41 tests and Cloudflare typecheck; contract exports 10
  tests. These overlap prior runs and are not a unique-suite total.
- Final complexity guard passes with no added debt. Managed availability and
  hosted context debt decreased; existing dispatch/notification hotspots retain
  their established owners without extra decision-tree growth.
