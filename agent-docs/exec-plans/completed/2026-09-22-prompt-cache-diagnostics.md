# Prompt cache diagnostics and workflow cost optimization

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Goal

Measure real Murph provider requests over HTTP and WebSockets, compare completed
response IDs, and identify verified savings for scheduled turns and document
extraction without weakening behavior or transport reliability.

## Success criteria

- Privacy-safe diagnostics include actual token usage, cache writes, comparison
  outcomes, compatible request settings, and transport.
- Replay production prompt builders and the pinned native Codex process using
  synthetic fixtures and an explicitly provisioned local API key.
- Compare baseline and candidate policies; report measured ratios and input cost,
  distinguish local evidence from production results, and do not promise 90%.
- Focused regression tests and relevant typechecks pass.

## Scope

- Local replay tooling, bounded comparison tracking, provider request diagnostics,
  and experimentally justified cache policy changes.
- No production transcript exports, production secret access, production writes,
  deployment, model-routing changes, or altered clinical extraction authority.

## Constraints

- Preserve Cloudflare opaque WebSocket forwarding and native Codex recovery.
- Preserve ordinary conversational prompt/tool policy for scheduled automations.
- Keep document tools read-only, source validation, dates, schemas and leaf isolation.
- Comparison IDs remain bounded ephemeral state. Logs never include raw inputs,
  output, credentials, response IDs, thread IDs, or document/member identifiers.
- Current Codex does not serialize prompt_cache_options or expose native cache
  diagnostics. Validate a local adapter before selecting a production integration.

## Risks and mitigations

1. A relay can alter transport lifetime or backpressure: keep it local and opt-in,
   test closure and fallback, and preserve opaque Cloudflare forwarding.
2. One-shot cache writes may be useful to a later tool call: compare full workflow
   cost and correctness before enabling explicit-only caching.
3. Cache percentage can rise while total cost rises: report input, cached, write,
   uncached tokens and normalized input cost together.

## Tasks

1. Complete bounded read-only production aggregate audit (done).
2. Implement privacy-safe response comparisons and local HTTP/WebSocket replay.
3. Replay actual scheduled and clinical prompt assembly, then test stable keys
   and stable-prefix breakpoints against baseline.
4. Document experimentally justified policies and native integration gaps,
   update operational documentation and run focused checks.
5. Inspect latest upstream Codex, review the candidate, open a PR and complete
   ReviewGPT plus exact-head CI.

## Decisions

- Production aggregate baseline is 85.46% cached input; scheduled turns dominate
  noncached input. This is turn-level accounting, not per-request diagnostics.
- HTTP prefix hashes alone cannot prove a cache miss; use native API diagnostics.
- Local synthetic workloads may be sent using the user-provisioned development key.

## Verification

- Credential-free adapter and comparison-state tests.
- Live pinned Codex over WebSockets and HTTP using production prompt builders.
- Assistant engine and affected Cloudflare typechecks and focused tests.
- Privacy inspection and complexity diff before completion.

## Progress and evidence

- Local replay adapter and CLI implemented for HTTP/SSE and WebSockets; only
  synthetic content is sent. Native Codex, production prompt assembly and the
  confined clinical extraction function are exercised.
- Fresh clinical threads reproduce `prompt_cache_key_changed`. Stable cohort key
  alone reuses about 95.3% on warm documents; three-document input cost falls
  from 21,039 to 8,755.3 normalized units. A breakpoint alone does not help.
- Explicit-only writes cost more than stable-key implicit caching in the fixture.
  Do not adopt them globally or reduce read-only extraction safeguards.
- Scheduled prompt continuations reuse about 99.6% on both transports. The
  scheduled fixture is not a replay of hosted dispatch or long idle periods.
- WebSocket warmup responses do not become comparison baselines or generation
  cost totals. Incremental frames do not contain the whole effective prompt.
- Provider diagnostic version 4 adds embedded Responses Lite tool counts and
  fingerprints, output format fingerprints, and allowlisted cache settings.
- Assistant-engine and Cloudflare typechecks pass after generating the local
  Prisma client. Focused adapter and egress verification is recorded in session.
- Production response comparison injection and stable clinical cache keys are
  not enabled. The pinned native binary lacks these options; a production-local
  adapter must preserve runner credential/egress ownership, socket lifetime,
  native fallback, and per-member cache boundaries. This PR packages the
  completed instrumentation and experiment phase; production integration is
  explicitly separate from the reported local results.
- No deployment, production data mutation, or production model/prompt change.

## Candidate review

- Latest upstream Codex at 559264d92e4462e887d7508c705599f33daf4f1e still lacks
  request comparison options and completion diagnostics. Ephemeral fork cache-key
  inheritance is useful future evidence but does not preserve the current fresh
  clinical leaf history contract. The existing Codex pin is retained.
- 265 focused tests pass, both affected package typechecks pass, and the live
  replay CLI reproduces stable-key document savings over WebSockets.
- Complexity guard passes with no added complexity debt; the existing input-shape
  analyzer hotspot is unchanged. Privacy scan and diff whitespace check pass.
- No member-visible behavior changes, so no changelog entry is needed.
- PR/review/CI results remain external completion evidence. The production
  cache-policy follow-up is not represented as shipped or as a 90% result.

## Completion

- Instrumentation and local replay scope is complete in PR #3653. Parent final
  review found no further changes; no runtime policy optimization is shipped.
- Round 1 ReviewGPT returned PASS with zero findings on
  fab5ee7b9b3728c5d8b7684835308df2452b91c1. The Hercules lane confirmed the full
  snapshot attachment, exact response identity, GPT-6 Pro model and completion
  marker after approximately nine minutes. Earlier tooling failures were invalid
  attempts, not substantive review rounds.
- Required CI passed on the reviewed implementation head. This explanatory plan
  closure changes no executable behavior and uses the documented review exemption;
  required checks on the final documentation commit remain the handoff gate.
- Follow-up: select and validate a production integration for per-member stable
  clinical cache keys and response comparisons, then investigate scheduled idle
  gaps with the richer diagnostics. The 90% production target remains unproven.
Completed: 2026-09-22
