# Product feedback 5,000-character recovery

Status: completed
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
- Final ReviewGPT round 2 found two obsolete exact-string assertions that still
  required the deleted no-retry wording. The accepted non-production correction
  deleted those six lines; its direct/group test passes 2 assertions and the
  package typecheck remains green. A subsequent complete package test command
  stayed alive without output for roughly 12 minutes and was interrupted by
  this session, so it is recorded as incomplete rather than passed; the prior
  focused Assistant Engine run remains green at 107 assertions.
- Final round 3 required the mandatory requirement-level retrospective. The
  recorded decision below continues with the deletion-based single-owner
  architecture. Final round 4 audited the full exact-head snapshot, verified
  every prior correction, and returned `ROUND_OUTCOME: PASS` with no qualifying
  finding. Exact-head PR evidence is green, and the parent final diff/call-path
  review, `git diff --check`, and identifier/privacy scan found no remaining
  issue.

## Review round 3 retrospective

- Original requirement: keep one shared 5,000-character summary bound; after
  the first input-schema rejection, expose value-free correction facts and
  allow one corrected call; treat a second rejection as terminal; create at
  most one accepted support escalation; confirm only explicit verified-private
  support; and keep ordinary feedback silent.
- Shape movement: the immutable first-reviewed head changed 14 files and 450
  lines, including 37 authored-source lines. The current reviewed head changes
  19 files and 624 lines, including 38 authored-source lines. Review remediation
  therefore kept production churn essentially flat while adding five touched
  files and 174 total changed lines, primarily deterministic and real-model
  proof plus the owner documentation needed to state the corrected contract.
- Attribution: required production consolidation deleted product-feedback-
  specific recovery metadata and retry branching, removed the stale no-retry
  instruction, made the Product feedback prompt the single retry-policy owner,
  and scoped result wording to explicit support. Review-driven growth expanded
  contract tests and three real-model journeys for accepted correction,
  terminal second rejection, and silent ordinary feedback; the last review
  correction only deleted six obsolete legacy-string assertions.
- Concepts and owners: removed the recovery metadata object, feature-specific
  validation formatter branch, and duplicate retry-policy owner. Retained the
  existing dynamic-tool parser, recorder, persistence/effect owner, sanitizer,
  and support authority. Introduced no runtime owner or persisted state; generic
  validation facts remain at the existing validation boundary, the Product
  feedback prompt owns retry policy, support guidance owns member-visible
  outcome wording, and the expanded live journeys are durable regression proof
  for model behavior rather than temporary review machinery.
- Decision: continue as one patch. The numeric cross-deploy bound and recovery
  behavior are the two requested parts of the same tool contract and together
  close the reported failure. Splitting would create an avoidable window where
  one side ships without the other; reverting the proof would remove direct
  coverage for the behavior change. No further architecture is justified.
  Future remediation may only shrink or clarify these owners and must not add
  retry state, a second prompt-policy owner, product-feedback-specific
  validation formatting, or another persistence/effect owner.

## Deployment

The shared constant and runner-visible recovery prompt span Hosted Execution,
Assistant Engine, the Cloudflare runner bundle, and Web validation. Deploy Web
first, then the Cloudflare Worker/runner: an old runner remains inside the new
Web bound, while a new runner can author a 2,001–5,000-character summary that an
old Web deploy rejects. Mixed versions fail closed rather than corrupting
state. Roll back the Worker/runner first and retain the expanded Web validator
until convergence. Post-deploy, verify an exact-bound support escalation is
accepted and a corrected validation call records one durable escalation.
Completed: 2026-08-26
