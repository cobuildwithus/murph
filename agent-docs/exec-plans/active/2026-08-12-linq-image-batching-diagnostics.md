# Linq image batching and diagnostics

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

Keep image-heavy hosted iMessage responses within a deliberately smaller
authored-response budget than Linq's provider ceiling, reject oversized text
before provider delivery, and retain privacy-safe request and provider-error
diagnostics when Linq rejects a request.

## Success criteria

- Newly authored responses cannot attach more than eight images, while existing
  persisted outbox payloads remain readable during rollout.
- Linq requests reject provider text over 10,000 characters before network I/O.
- Provider request errors expose allowlisted validation details plus message,
  part, and media counts without logging recipients, message text, media URLs,
  credentials, or raw response bodies.
- Model-facing guidance states the eight-image response budget, and runtime
  validation independently enforces it.
- A failed image delivery remains outstanding image work; the recovery note
  does not invite a text-only substitute.
- Focused tests cover authored-response boundaries, provider text preflight,
  failure-note behavior, payload aggregates, and diagnostic privacy.

## Scope

- Existing assistant response-media assembly and Linq delivery adapter.
- Existing hosted outbox structured diagnostics and terminal failure context.
- Focused tests and the current messaging/reliability owner documentation.

## Constraints

- No text-only recovery for failed image delivery.
- No new queue, state owner, service, dependency, or persisted payload copy.
- Keep the current outbox as the only retry and terminal-delivery owner.
- Preserve foreground reply priority and existing provider-acceptance semantics.
- Keep all diagnostics metadata-only and allowlist-projected.

## Tasks

1. [x] Trace the recent image-volume change and current request construction.
2. [x] Define the smallest safe authored-response and diagnostic contracts.
3. [x] Implement bounded authoring, model guidance, diagnostics, and tests.
4. [x] Run focused verification and direct large-payload proof.
5. [ ] Complete ReviewGPT, exact-head CI, parent review, and plan closure.

## Verification log

- Root-cause inspection tied the newly reachable image volume to
  `ec6e1481206`: the exercise runtime began asking for complete multi-frame
  sequences per unfamiliar movement while the authored-media tool and
  persistence contract still admitted 40 items.
- Current Linq documentation confirms 100 total parts, 40 public-URL media
  parts, and 10,000 characters per text part. The request builder sends all
  response media in one provider message.
- Assistant Engine focused coverage: 5 files and 279 tests passed; package
  typecheck passed.
- Assistant Runtime focused coverage: 1 file and 283 tests passed; package
  typecheck passed.
- Operator Config focused coverage: 1 file and 67 tests passed; package
  typecheck passed. The adapter proof covers safe current-envelope error
  parsing, request-shape counts, response signatures, header trace fallback,
  and 10,001-character rejection before provider entry.
- Complete first-provider request capture used the pinned real Codex App
  Server, local scripted Responses provider, `gpt-5.6-terra`, low reasoning,
  production code mode, synthetic direct/group Linq workout turns, and
  `gpt-tokenizer` 3.4.0 `o200k_harmony`. It serialized the present `include`,
  `input`, `parallel_tool_calls`, `text`, and `tool_choice` fields, normalized
  local paths and UUIDs, and excluded model selection, reasoning, storage,
  streaming, service-tier, account, cache, and transport metadata identically.
  The base tool metadata was reconstructed by exact description and schema
  replacement from base `54558f7949`; the changed deferred exercise body does
  not enter the first request:
  - direct: 138,097 bytes / 29,869 tokens at base and 138,121 bytes / 29,878
    tokens at head (`+24` bytes / `+9` tokens, `+0.0301%`);
  - group: 102,194 bytes / 22,141 tokens at base and 102,218 bytes / 22,150
    tokens at head (`+24` bytes / `+9` tokens, `+0.0406%`).
- The temporary provider-request capture hook was removed and verified absent.
- `git diff --check`: passed.
