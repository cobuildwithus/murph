# Product feedback 5,000-character recovery

Status: final-review remediation verification active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

Raise the bounded hosted product-feedback summary limit from 2,000 to 5,000
characters and let Murph recover once from a correctable
`murph.submit_product_feedback` input-schema rejection instead of ending an
explicit support request with an avoidable failure.

## Product UX

Effort: Patch.

- Outcome: A member who explicitly asks Murph to escalate a detailed product
  issue gets the existing durable account-linked escalation when the first
  tool call is correctable.
- Reaches: Verified private support requests and ordinary product-feedback
  capture through the existing `murph.submit_product_feedback` tool.
- Proof: Deterministic tool-contract tests plus focused real-Codex journeys
  cover one actionable validation error, one corrected retry, one durable
  accepted effect, a terminal second rejection, and silent ordinary feedback.

Affected paths:

- A verified private member whose first support summary exceeds the bound:
  Murph receives value-free validation details, rewrites the de-identified
  product-only summary within 5,000 characters, retries exactly once, and
  confirms only after durable acceptance.
- A member whose corrected retry is still invalid or whose callback/provider
  path fails: Murph stops after the bounded retry and truthfully says direct
  notification failed; it does not claim a ticket, response, or delivery.
- Ordinary feedback capture: the same shared 5,000-character bound applies,
  while the existing silent best-effort behavior, sanitizer, kinds, optional
  changelog linkage, and ownership remain unchanged.

## Scope

- In scope: the shared summary limit, model-visible tool schema and recovery
  contract, deterministic parser/executor/Web boundary tests, focused
  production-derived real-Codex journeys, and matching durable owner docs when
  numeric or recovery claims require them.
- Out of scope: new persistence, raw transcript retention, recipient changes,
  support-email retries, provider changes, new feedback fields, and automatic
  truncation of model-authored text.

## Constraints

- Preserve the existing deterministic sanitizer, de-identification contract,
  reserved support prefix, verified-private authority, anonymous detail row,
  fixed member-linked marker, daily email cap, and provider idempotency.
- Expose only value-free validation facts to the model. Never echo submitted
  summary text into persisted runtime issues or logs.
- Permit one retry only for input-schema rejection. Acceptance, deduplication,
  callback unavailability, and provider failure remain terminal for the turn.
- Reuse the current dynamic-tool parser and recorder; add no state owner,
  queue, supervisor, or compatibility layer.

## Tasks

1. Trace the complete shared length and validation-feedback path across Hosted
   Execution, Assistant Engine, Web persistence, and Cloudflare forwarding.
2. Raise the single shared constant to 5,000 and align exact boundary tests.
3. Return an explicit value-free correction contract for invalid product-
   feedback arguments and align the model-facing retry rule.
4. Add deterministic proof and focused real-Codex recovery journeys, then
   review the actual replies for truthful support and ordinary-feedback
   language.
5. Run focused tests and typechecks, inspect the complete diff, commit and push
   the candidate, and complete the required specialist, final ReviewGPT, CI,
   Product UX walkthrough, parent review, and plan closure gates.

## Verification

- Focused Hosted Execution contract/parser tests for exactly 5,000 accepted and
  5,001 rejected after sanitization.
- Focused Assistant Engine tests for provider-facing schema max length,
  value-free structured validation feedback, one-retry instruction, accepted
  corrected retry, and no duplicate recorder effect.
- Focused Web support/service tests for 5,000-character persistence and alert
  formatting without weakening stored-detail validation.
- Assistant Engine, Hosted Execution, and Web typechecks selected by the
  changed ownership surfaces.
- `pnpm test:assistant:live -- --test "<focused recovery journey>"`, followed by
  manual `Ready`/`Hold` review of every synthetic member-visible reply.
- `git diff --check`, privacy/identifier inspection, exact-head CI, preliminary
  Product UX/prompt/coverage ReviewGPT, sensitive final ReviewGPT, and a clean
  current-base merge-tree before completion.

Results so far:

- Focused Hosted Execution, Assistant Engine, Web, and Cloudflare tests pass.
  One Cloudflare timing test exceeded its suite timeout under concurrent load
  and passed alone without product-code changes.
- Hosted Execution, Assistant Engine, Cloudflare runner, and Web typechecks
  pass. The final prompt-contract run passes all 74 tests.
- The deterministic recovery proof returns value-free `path`, `code`, and
  5,000-character `maximum` facts, then records exactly one corrected
  escalation. Retry policy has one prompt owner; the validation result carries
  facts only and no attempt state. The Web boundary accepts an exact
  5,000-character summary.
- The required live journey was attempted twice. Both attempts stopped before
  any provider action with the subscription usage-limit error, so deterministic
  behavior is `Ready` and live model behavior remains `Hold` rather than being
  inferred.
- Preliminary and final review correctly found a stale no-retry instruction,
  unscoped support outcome wording, self-directing live-test copy, and repeated
  recovery metadata. The remediation deletes those duplicate owners, scopes
  outcomes to explicit private support, and adds separate accepted, second-
  rejection, and ordinary-silence model journeys. Focused deterministic tests
  pass 101 assertions, the real-journey file compiles, and Assistant Engine
  typecheck passes.
- The remediated live journey was attempted with the default local profile and
  two authenticated alternate Codex homes. All three stopped before any
  provider action with the same subscription usage-limit error, so the live
  verdict remains `Hold`; no additional profile attempts are planned.
- Complete first-provider request capture used the pinned real Codex App
  Server, identical synthetic direct/group turns, production code mode, and
  `gpt-tokenizer` 3.4.0 `o200k_harmony`. It serialized `include`, `input`,
  `instructions`, `parallel_tool_calls`, `text`, `tool_choice`, and `tools` when
  present, then normalized checkout/temp paths and generated request ids.
  Direct moved from 26,344 tokens / 122,123 UTF-8 bytes to 26,381 / 122,456
  (+37 tokens, +0.1404%; +333 bytes, +0.2727%). Group moved from 22,523 /
  104,859 to 22,560 / 105,192 (+37 tokens, +0.1643%; +333 bytes, +0.3176%).
  The final-review remediation reduced both routes by nine tokens versus the
  first-reviewed head while adding 11 bytes for explicit ordinary-versus-
  support wording. The base-to-head delta remains confined to assembled
  product-feedback instructions and tool/schema guidance; other provider-
  visible fields are unchanged. Repeated base and first-reviewed-head captures
  matched exactly. A deterministic current-versus-first-reviewed replay
  reconstructed the changed provider-visible fields, and all temporary
  instrumentation was removed.

## Deployment

The shared constant and runner-visible recovery prompt span Hosted Execution,
Assistant Engine, the Cloudflare runner bundle, and Web validation. Old and new
components both reject summaries above their local bound, so mixed rollout is
fail-closed rather than corrupting state. The candidate review will determine
the safest deployment order and required convergence checks from the final
diff.
