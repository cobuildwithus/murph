# Physical Note Context Carry

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

Keep the authenticated originating request available after a trusted hosted
image completion so a later explicit approval can reuse recent workflow details
without depending exclusively on native provider-thread memory.

## Evidence

- Production ingress retained and consumed the originating conversation item;
  the image completion and later replies stayed in one assistant session and
  resumed one provider thread.
- Resumed turns intentionally supplied no explicit flat conversation history.
  Provider-visible input shrank materially at the asynchronous completion
  boundary, after which the assistant could no longer use a detail from the
  originating request.
- The completion selector already reloads the exact origin and proves the same
  authenticated route, but the completion input carries only result metadata.
- The separate stuck-note recovery correctly cleared the newly blocked request,
  then found one legacy unresolved guard. Its read-only provider lookup returned
  an authorization-class response, so absence is not proven and the guard must
  remain fail-closed.

## Affected People And Journeys

1. A person supplies all draft and destination details, receives generated
   artwork asynchronously, then approves it without repeating those details.
2. A person sends another same-route message before the trusted completion is
   processed; the completion remains first and carries only its authenticated
   origin context plus exact-successor input.
3. A completion is restored after interruption; the same bounded context is
   available without turning the historical request into current effect
   authority.
4. A person whose origin content has expired or is unavailable receives the
   existing truthful clarification path; the runtime does not invent context.

## Tasks

1. Extend the trusted completion renderer with a bounded, clearly delimited
   excerpt of the exact origin's user-level text, preserving both ends when the
   input must be shortened.
2. Stage that context only after the existing exact-origin and reply-route
   checks; keep the completion input as the sole accepted input so historical
   text cannot authorize a new external effect.
3. Add deterministic coverage for context presence, bounds, missing content,
   same-route batching, and current-input authority.
4. Add one synthetic real-Codex journey that starts from production-built
   trusted completion input with no origin provider history, then proves a
   terse later approval performs one physical-note send.
5. Update the hosted runtime contract and a privacy-safe changelog fragment.
6. Run focused tests and typecheck, ReviewGPT gates, exact-head CI, merge proof,
   and deployment verification.

## Constraints

- Never store or reproduce production transcript text, identifiers, names, or
  addresses in source, tests, documentation, reviews, or release notes.
- Add no new state owner, workflow, queue, provider request, or effect authority.
- Preserve the 14-day assistant-input content-retention owner and the existing
  completion provenance, ordering, and exact-successor boundaries.
- Do not clear a physical-note row without accepted or proven-absent provider
  evidence.

## Verification

- `pnpm --filter @murphai/assistant-engine exec vitest run --config
  vitest.config.ts --no-coverage
  test/assistant-automation-reply-event-path.test.ts
  test/assistant-hosted-image-completion.test.ts
  test/assistant-hosted-image-completion-authority.test.ts` — 117 passed.
- `pnpm --filter @murphai/assistant-runtime exec vitest run --config
  vitest.config.ts --isolate=true --no-coverage
  test/hosted-runtime-image-generation.test.ts
  test/hosted-runtime-turn-input.test.ts` — 41 passed.
- Assistant Engine and Assistant Runtime typechecks passed.
- `pnpm test:assistant:live -- --test "keeps the originating destination
  through completion and a terse approval"` — passed with `gpt-5.6-terra`
  through local subscription auth. The isolated completion attached the exact
  synthetic image once, the later approval sent once using the carried
  synthetic destination, and neither turn asked for destination fields. Reply
  review: Ready.
- ReviewGPT round 1 found that the initial candidate stored but discarded the
  origin excerpt at the production prompt boundary. The accepted correction
  extends the existing trusted in-memory projection, keeps result authority
  separate from historical context, and leaves late completions queued for
  normal trusted turn-context admission. Final remediation review is pending.
