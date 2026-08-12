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
- Linq requests reject provider text over 10,000 characters before private
  media loading, attachment upload, or message-provider entry.
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
- Changelog fragment and registry coverage: 2 files and 45 tests passed. Web
  typecheck passed after generating the fresh worktree's ignored Prisma and
  Health Commons artifacts; neither generator changed tracked files.
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
- Preliminary and final ReviewGPT round 1 independently found that the
  adapter-level text check ran after private-image reservation and upload.
  Accepted: the shared exact Markdown-rendering preflight now runs before
  private bytes are loaded, before attachment reservation/upload, and before
  create/send message entry. Existing-chat and participant-create tests prove
  zero loader and provider calls at 10,001 characters and successful delivery
  at exactly 10,000.
- ReviewGPT also found that synchronous `generate_image` could pay for a ninth
  image that response-media enforcement discarded. Accepted: tool guidance
  states that synchronous generation consumes the shared eight-slot response
  budget, and execution refuses the call before usage ordinals or provider work
  once the slots are full. Hosted detached generation remains unchanged.
- ReviewGPT's proposed group terminal-recovery expansion was not accepted. The
  incident and existing recovery owner are direct-chat scoped; adding group
  recovery would require new audience/authority and continuation-delivery
  semantics. Product and changelog claims now state that exact direct scope,
  while the authored eight-image cap continues to protect both direct and
  group responses.
- ReviewGPT found a production-shaped Linq HTTP diagnostic could exceed the
  hosted parser's 16-key object bound. Accepted: every summary now has seven
  base fields and at most nine prioritized details, retaining provider status,
  code, operation/stage, method, request/response shape, trace id, and response
  signature. A real-shaped 16-field case passes the production parser.
- Corrected focused proof: Assistant Engine 3 files / 351 tests passed;
  Operator Config 1 file / 67 tests passed; Assistant Runtime 3 selected cases
  passed with 280 skipped. Typechecks passed for all three affected packages.
- Parent product-experience re-review found no remaining product finding. The
  smallest complete experience is one bounded image-bearing response; invalid
  composed text fails before private-media work, and a terminal direct-chat
  failure remains image work instead of presenting a misleading text resend.
  Multi-message batching remains intentionally absent because it would create
  partial-delivery and reconciliation states without improving the bounded
  eight-image outcome.
- Corrected complete first-provider request capture used the same pinned real
  Codex App Server, local scripted provider, `gpt-5.6-terra`, low reasoning,
  production code mode, and `gpt-tokenizer` 3.4.0 `o200k_harmony`. The selected
  and normalized provider fields remained `include`, `input`,
  `parallel_tool_calls`, `text`, and `tool_choice`. Exact replacement of both
  changed tool descriptions reconstructed base behavior:
  - direct: 112,350 bytes / 24,821 tokens at base and 112,496 bytes / 24,856
    tokens at the corrected candidate (`+146` bytes / `+35` tokens,
    `+0.1410%`);
  - group: 96,456 bytes / 21,200 tokens at base and 96,602 bytes / 21,235
    tokens at the corrected candidate (`+146` bytes / `+35` tokens,
    `+0.1651%`).
  The temporary capture hook, captures, tokenizer package, and temp directory
  were removed and verified absent.
- Frog entry `20260812122351-changelog-guide-omits` records that the completion
  guide omits the Markdown list marker required by the changelog CI parser.
- Exact-head CI found two patch-related integration gaps. The provider-request
  boundary guard rejected an object spread in the SDK-typed Linq text part;
  explicit field assignment now passes the guard. CLI coverage still expected
  the former smaller HTTP diagnostic object; its exact assertion now includes
  the safe zero-media counts, text-part count, and response signature. The
  focused CLI case, all 67 Linq adapter tests, CLI and Operator Config
  typechecks, and the provider-request guard pass after remediation.
