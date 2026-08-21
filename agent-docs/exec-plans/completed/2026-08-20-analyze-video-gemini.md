# murph.analyze_video: bounded Gemini video understanding

## Outcome

Murph can inspect one user-supplied video attachment through a new
`murph.analyze_video` dynamic tool. The tool samples visual content at exactly
1 FPS, sends one bounded request to Gemini 3.7 Flash, and returns a compact,
explicitly untrusted analysis to the assistant. Hosted credentials remain
Worker-owned and protocol-valid successful provider calls enter the existing
hosted usage accounting path without making accounting a second success
authority for returning the provider answer.

## Product UX plan

- Outcome: in a private direct conversation, a member can explicitly ask Murph
  about one supported video they supplied and receive a bounded, cautious
  observation in that same conversation.
- Entry and promise: the member attaches or refers to an accepted video and asks
  a focused question. Murph makes at most one analysis call per host turn,
  waits for the bounded same-turn provider request, and replies in the
  originating private conversation. If the attachment is unavailable, changed,
  unsupported, or too large, or Gemini fails, Murph must say that no analysis
  completed and leave the member with a clear retry path rather than a silent
  stall or invented result. If usage recording fails after Gemini has returned
  a valid answer, the answer still reaches the member while accounting records a
  secret-safe degradation off the foreground reply path.
- Authority and audience: the first release is private-direct only. Group use is
  excluded until the requester/uploader authority rule is explicitly approved
  and covered through final group delivery; sharing a clip in a group alone is
  not sufficient authority for this release.
- Deliberate exclusions: no automatic analysis, background continuation,
  provider-side upload lifecycle, larger-video flow, injury diagnosis, or claim
  that a visual observation proves causation.
- Ready proof: exercise the ordinary private hosted route from accepted video
  and natural-language request through tool selection, provider-shaped Gemini
  response, final Murph wording, and delivery. Exercise one representative
  provider failure through that same route and prove a clear recoverable reply.

## Success criteria

- The tool accepts one exact accepted-message ref, an optional video ordinal,
  and a focused question; paths and provider controls remain runtime-owned.
- Only supported video bytes within a documented inline request cap reach the
  provider; traversal, remote URLs, hidden paths, missing files, non-regular
  files, unsupported media, and over-limit inputs fail closed before egress.
- The provider request pins `gemini-3.7-flash`, explicitly requests 1 FPS, has
  a trusted per-turn call ceiling and timeout, and does not create provider-side
  uploaded-file state.
- Provider output is control-character sanitized, length bounded, and framed as
  untrusted observations rather than instructions.
- Hosted execution injects `GEMINI_API_KEY` only at the Worker egress boundary,
  records token usage without prompts, paths, video bytes, or response text,
  and prices the usage before the tool is deployed. Usage recording failure
  must not withhold an already-valid provider answer.
- Focused unit/integration tests, affected typechecks, dependency checks, exact-
  head ReviewGPT, CI, and a clean merge-tree proof pass before handoff.

## Design constraints

1. Prefer one inline request over the Gemini Files API. This deliberately caps
   first-version video size to avoid upload, polling, retention, deletion, and
   partial-cleanup state. Larger-video support is deferred until demonstrated.
2. Use one exact audited `generateContent` transport. The official Google SDK
   does not expose the request-scoped fetch injection Murph requires for its
   identity-bound Worker credential boundary, while the current Interactions
   API cannot explicitly set video FPS. Register and document this narrow raw
   transport exception rather than adding an SDK that would bypass the boundary.
3. Keep model, endpoint, FPS, output limit, timeout, supported media types, and
   call ceiling in trusted code. Prompt/model output cannot widen them.
4. Reuse existing vault materialization and path-containment contracts. Do not
   persist provider output outside the normal assistant transcript or add a new
   database/billing primitive.
5. Ship Web usage pricing before Cloudflare credential injection and tool
   availability. A missing key leaves the tool unavailable.

## Scope

- Assistant-engine video reference resolution, tool schema/executor, dynamic
  catalog registration, planning availability, and per-turn call state.
- Hosted-execution usage record construction.
- Cloudflare Worker contracts, secret/env policy, egress interception, and
  failure-isolated Web usage recording after a successful Gemini response.
- Web hosted allowance pricing for Gemini 3.7 Flash.
- Provider-boundary registration, environment example, architecture/security/
  deployment/testing documentation, deferred post-activation changelog, and
  focused tests.
- Exact dependency and lockfile changes only when required by the chosen SDK.

## Risks and rollback

- Video bytes are sensitive external-provider input. Limit eligible refs,
  content types, byte size, and logs; document the Google trust boundary.
- Inline base64 expands request size. Keep the raw cap below provider and Worker
  body limits and test both the raw and encoded boundaries.
- Provider pricing or usage metadata may change. Pin a versioned pricing rule
  and fail usage pricing closed when required token fields are absent.
- The one-call ceiling is per turn. A rare outer hosted replay after provider
  acceptance but before terminal delivery evidence may resend the same
  explicitly requested clip because the endpoint exposes no usable idempotency
  key. V1 accepts this bounded at-least-once residual; exact-once recovery would
  require a durable receipt and cached-result/recovery retention design outside
  this minimal release.
- A completed turn cannot silently suppress an analyze-video outcome: trusted
  fallback text fills blank/no-reply output while model/card wording still wins,
  and a successful analysis remains the selected fallback even if a later
  same-turn tool attempt hits the one-call limit. If the primary provider
  transport itself fails after the tool result, the ordinary outer-turn retry
  owns recovery; v1 does not add a separate failed-attempt delivery path for
  that narrow window.
- Rollback is removal of Cloudflare tool exposure/secret injection after Web
  pricing support has shipped; absent `GEMINI_API_KEY` is the safe skew state.

## Tasks

- [x] Collect independent ReviewGPT designs and vet the implementation artifact against
      repository contracts and current official Gemini documentation.
- [x] Implement the smallest accepted design with focused tests.
- [x] Add security, architecture, deployment, testing-map, and environment
      documentation.
- [x] Remove the pre-activation changelog entry so the Web-first pricing deploy
      does not advertise an unavailable tool.
- [x] Keep the member-visible changelog out of this implementation PR and defer
      it to a post-activation Web release, only after the production key,
      Worker, runner, pricing path, and consented private-direct smoke have
      passed.
- [x] Run focused tests/typechecks, dependency policy checks, diff audit, and
      privacy scan.
- [x] Commit and push a review candidate, open a new PR, then run preliminary
      completion-specialist and final sensitive exact-head ReviewGPT passes.
- [x] Resolve findings, obtain exact-head CI evidence, finish this plan, and
      prove a clean merge tree against current `origin/main`.

## Verification

- Assistant-engine tests for schema/ref validation, byte sniffing, 1 FPS request
  shape, timeout/abort, per-turn limit, output hygiene, and tool planning.
- Hosted-execution tests for Gemini usage-record shape and token extraction.
- Cloudflare tests for credential ownership, exact host/path/method policy,
  request/response handling, no failed-call billing, and env/deploy invariants.
- Web tests for exact pricing, invalid/missing usage, and immutable historical
  pricing behavior.
- `pnpm test:diff`, affected package typechecks, provider-request boundary guard,
  release-artifact secret guard, dependency guard/audit/ignored-build checks,
  and exact-head PR CI.

## Deployment order

1. Web usage-record acceptance and Gemini pricing.
2. Complete vendor approval and verify that the exact Gemini project behind
   `GEMINI_API_KEY` has the applicable paid/no-training controls, then configure
   the key through the private secret path; the old runtime still omits the
   tool. Key presence alone is not that proof.
3. Deploy the Cloudflare Worker and runner together with immediate convergence;
   without the key the tool remains absent.
4. Prove one consented private-direct request reaches a bounded final reply and
   a priced usage record, then publish the changelog item in a follow-up Web
   release.

Status: completed
Updated: 2026-08-21
Completed: 2026-08-21
