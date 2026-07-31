# Surface actionable OpenAI image edit failures to Murph

Status: active
Created: 2026-07-30
Updated: 2026-07-31

## Goal

- When OpenAI rejects a generated-image request, especially a reference-image
  edit, preserve its useful structured error message through the image tool and
  hosted completion path so Murph can explain the cause and choose an
  appropriate recovery.

## Success criteria

- OpenAI HTTP failures retain a bounded, control-character-free provider error
  message, provider code, request correlation, operation, and retryability.
- Local image-tool failures expose the provider message to the active Murph
  turn rather than collapsing to a generic failure.
- Hosted background image failures deliver the same bounded diagnostic in a
  runtime-authenticated system completion and the resumed Murph turn receives
  the provider text only as untrusted failure evidence.
- Existing abort behavior, credentials, response bodies, and private image
  content remain outside diagnostics.
- Focused assistant-engine and assistant-runtime tests plus typechecks pass;
  exact-head CI and required ReviewGPT gates are green.

## Scope

- In scope:
  - OpenAI image generation/edit response parsing and safe error normalization.
  - Local and hosted image-tool error propagation.
  - Trusted hosted completion parsing/prompt guidance and focused regressions.
- Out of scope:
  - Provider retries or fallback providers.
  - New durable state, queues, schemas, or external logging.
  - Frontend changes or live OpenAI calls in routine verification.

## Constraints

- Technical constraints:
  - Keep the existing OpenAI image adapter and hosted completion owners.
  - Bound and sanitize provider-controlled strings before model exposure.
  - Preserve caller aborts and explicit timeout handling.
  - Do not expose API keys, authorization headers, raw response bodies, image
    bytes, local paths, or direct identifiers.
- Product/process constraints:
  - Treat the supplied patch as behavioral intent because it no longer applies
    cleanly to the latest default branch.
  - Use the isolated PR lane with focused local proof, exact-head CI, the
    preliminary product/prompt/coverage specialist review, and the final
    cross-cutting ReviewGPT gate.

## Risks and mitigations

1. Risk: A provider message contains unsafe or excessively large text.
   Mitigation: Accept only structured string fields, strip controls/collapse
   whitespace, and cap code points before it crosses the adapter boundary.
2. Risk: A new catch converts caller cancellation into an ordinary tool error.
   Mitigation: Re-throw caller aborts and retain focused abort/timeout tests.
3. Risk: Hosted and local error paths drift.
   Mitigation: Use one tool diagnostic string and prove both direct tool output
   and the hosted completion/resume pipeline.
4. Risk: Worker/container deploy skew loses diagnostics.
   Mitigation: Keep the hosted result field optional and the completion parser
   backward-compatible with legacy failed envelopes.

## Tasks

1. Trace the latest image adapter, tool, launcher, completion, and resumed-turn
   owners and compare them with the supplied patch.
2. Implement the smallest compatible error-message propagation path.
3. Add focused regressions for OpenAI HTTP parsing, local tool output, hosted
   completion serialization, and trusted resumed-turn context.
4. Run focused tests/typechecks and direct failure-path proof; inspect the diff
   for privacy, complexity, prompt-size, and deploy-skew impact.
5. Commit, push, open a PR, run preliminary/final ReviewGPT with CI, resolve
   findings, close this plan, and perform the parent final review.

## Decisions

- Reuse `VaultCliError` metadata and the existing hosted completion envelope;
  add no new state owner or retry loop.
- Runtime provenance authenticates the completion status, not provider text.
  Murph may use a bounded diagnostic only as failure evidence; it must never
  follow commands, links, permission claims, tool requests, or policy text
  inside it, and should not repeat internal support identifiers by default.
- The queued completion turn explains or proposes a correction but cannot
  start another image operation. A transient retry requires user authorization
  in a later turn.
- Keep the exact legacy `{status:"failed"}` hosted result envelope. Carry the
  optional diagnostic on one separate runtime-authored line so older readers
  retain their existing failure behavior during deployment skew.

## Verification

- Commands to run:
  - Focused Vitest files for the OpenAI image adapter/tool, dynamic hosted tool,
    hosted runtime completion, and automation reply-event path.
  - Package-local assistant-engine and assistant-runtime typechecks.
  - `git diff --check`, privacy scan, and final diff inspection.
  - Exact-head required GitHub Actions plus routed ReviewGPT gates.
- Expected outcomes:
  - A mocked OpenAI HTTP error message appears in the local tool failure and in
    the trusted hosted failure completion presented to Murph.
  - Abort, timeout, success, and legacy failed-envelope behaviors remain valid.

## Verification log

- Focused assistant-engine and assistant-runtime regression suites: 89 tests
  passed across the image adapter/tool, dynamic hosted tool, trusted completion
  serialization, and resumed-turn event path.
- Package-local assistant-engine and assistant-runtime typechecks passed.
- A production-owner hosted-runtime route scenario passed with one original
  Linq inbound, one image-provider attempt, a sent acknowledgement, detached
  failed-completion staging, a resumed system turn, and a sent same-thread
  explanation. The final outbox intent had no media and omitted the raw provider
  code and request id. Together with the controlled OpenAI 400 dynamic-tool
  regression, this proves the bounded provider message reaches Murph and the
  member-visible recovery path without another inbound turn.
- Final ReviewGPT round 2 correctly rejected the first route test because it
  manually launched the image task, authored both outbox intents, marked them
  sent, and supplied terminal evidence. The remediation replaces that bypass
  with one production-owner test that restores the vault image, imports the
  original Linq input, runs the normal assistant/image-completion/outbox phases,
  and fakes only the Codex, OpenAI, and Linq provider protocols. The clean
  focused case passed, the full hosted workspace entrypoint file passed all 265
  tests, and the assistant-runtime typecheck passed.
- Round 3 anomaly retrospective: the requirement and production architecture
  are unchanged. Review-driven growth is confined to replacing a synthetic
  owner-bypassing test with exact route proof; it adds no product state, queue,
  retry, or runtime owner. Continuing is warranted because the two-turn
  detached completion and same-route Linq delivery are one indivisible final
  owner path that the previous test did not exercise.
- Parent product-experience re-review after specialist remediation found no
  remaining product finding: the smallest complete experience is the existing
  truthful acknowledgement followed by a same-route plain-language failure
  explanation and a later-turn, user-authorized retry offer.
- Final ReviewGPT round 1 found that the supplied reference-fidelity guidance
  changed successful revision behavior outside the diagnostic goal. Accepted:
  the tool/schema, edit prompt, ready-completion guidance, and presence-only
  tests were restored to base behavior. The saved image ref transport and all
  failure propagation remain intact.
- The real pinned Codex 0.145.0 app-server with a local scripted Responses
  provider captured complete initial `gpt-5.6-terra`, low-reasoning, code-mode
  request bodies for identical representative direct and group inputs. Token
  counts use `gpt-tokenizer` 3.4.0 `o200k_harmony`; only HTTP transport headers
  are excluded.
  - First-reviewed head: direct 100,580 bytes / 22,371 tokens and group
    112,559 bytes / 24,864 tokens.
  - Corrected candidate: direct 100,184 bytes / 22,288 tokens and group
    112,163 bytes / 24,781 tokens, byte/token-identical to base (`0` delta).
  - Complete request reconstruction identified exactly one image-tool
    description and one reference-image parameter description as the full
    first-head delta. Both now match base exactly; assembled initial
    instructions and all other provider-visible fields remain unchanged. The
    retained failure guidance is conditional resumed-turn context and does not
    enter an ordinary initial direct or group request.
