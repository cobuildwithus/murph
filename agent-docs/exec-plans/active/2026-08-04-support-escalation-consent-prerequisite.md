# Keep support contact opt-in and send explicit escalations directly

Status: active
Created: 2026-08-04
Updated: 2026-08-05

## Goal

- Keep ordinary Murph product failures background-first and support contact
  details opt-in, while sending one de-identified account-linked escalation
  immediately when a verified private member explicitly requests human support.

## Success criteria

- A generic bug handoff or product-team feedback request remains ordinary
  anonymous feedback.
- An explicit verified-private human-support request submits one reserved
  closed-vocabulary product issue in the same turn without displaying it or
  asking for separate approval.
- Group, unverified, or semantically unsafe contexts receive a private support
  route without an account-linked tool call; the address appears only if asked.
- Completion copy reports the durable record without claiming that a capped
  email was delivered or received.

## Scope

- In scope: compact Assistant Engine support guidance, the shared closed
  product-issue contract, focused prompt and one-turn real-model scenario
  definitions, and the owning product, security, architecture, deployment, and
  verification docs.
- Out of scope: Web email formatting and persistence, database schemas, callback
  envelope changes, flags, queues, retries, recipients, or provider
  configuration.

## Risks and mitigations

1. Risk: a generated summary can include semantic private context.
   Mitigation: the provider supplies only allowlisted product-area and failure
   codes for support; the tool builds the canonical issue, and synthetic
   private-context coverage proves raw details do not cross the callback.
2. Risk: a generic product complaint accidentally becomes account-linked.
   Mitigation: reserve the shape for an explicit Murph human-support request in
   a verified private direct conversation; keep ordinary feedback anonymous.
3. Risk: completion copy can overstate delivery while Web sends metadata only
   or suppresses email above the daily cap.
   Mitigation: confirm only that the issue was saved and the account-linked
   escalation recorded; never claim email delivery or receipt.

## Tasks

1. Tighten the compact support authority contract.
2. Add one-turn, privacy, group, and copy regressions.
3. Update the owning durable contracts and remove the obsolete consent rollout.
4. Run focused tests, typecheck, provider-input measurement, ReviewGPT, and CI.
5. Update the existing runner-policy PR and preserve the follow-up PR as a
   stacked Web-only change.

## Decisions

- The product owner explicitly chose the verified-private human-support request
  itself as authority for immediate submission; Murph does not show the summary
  or add a separate approval turn.
- This removes the former consent-specific runner/Web compatibility dependency.
  The detailed-email PR may remain stacked for ordinary review sequencing, but
  no consent version, rollout floor, or feature flag is required. The two PRs
  still form one product release: direct submission alone does not complete
  human takeover until the stored issue reaches the support alert.
- Ordinary feedback remains silent and best-effort because candidate acceptance
  does not prove post-reply persistence. The assembled developer prompt and tool
  description route an explicit private human-support request to durable
  completion through the closed product-issue shape.

## Verification

- Run focused Assistant Engine support guidance and real-model scenario
  definition suites, Assistant Engine typecheck, docs drift, diff checks,
  provider-input measurement, required ReviewGPT passes, and exact-head CI.

## Verification log

- The earlier exact-summary consent candidate and its review evidence were
  superseded on 2026-08-05 by the product owner's one-turn direct-send decision.
  The revised exact head requires fresh focused proof, provider-input
  measurement, prompt/product ReviewGPT coverage, and CI.
- Focused support guidance, tool-contract, assembled-prompt, prompt-budget, and
  real-model scenario-definition suites pass 97 tests with 25 credential-gated
  live-provider cases compiled and skipped. Assistant Engine typecheck, docs
  drift, and diff checks pass. The compact runtime literal is 2,958 characters
  / 2,962 UTF-8 bytes and remains below the strict 3,000-byte ratchet.
- The earlier free-form-summary candidate's paired first-provider capture used
  the pinned real Codex App Server,
  `gpt-5.6-terra`, low reasoning, production code mode, the exact support tool,
  identical synthetic direct/group requests, and `gpt-tokenizer` 3.4.0
  `o200k_harmony`. It serialized `input`, `parallel_tool_calls`, `text`, and
  `tool_choice`, including Codex-generated tool guidance, while excluding model,
  stream/storage, reasoning, service-tier, cache/client metadata, and output-
  inclusion transport fields identically. Two App Server current-context fields
  were normalized identically across runs. Direct moved from 23,701 tokens /
  109,002 bytes to 23,711 / 109,020 (+10 tokens, +0.0422%; +18 bytes,
  +0.0165%). Group moved from 20,162 tokens / 93,282 bytes to 20,172 / 93,300
  (+10 tokens, +0.0496%; +18 bytes, +0.0193%). Sequential whole-request
  attribution is -36 tokens/-227 bytes for assembled product-feedback guidance,
  +21/+100 for compact base instructions, and +25/+145 for Codex-generated tool
  guidance; schema and other provider-visible input are unchanged. The capture
  compared `9d1d17fd45` to `e374d58700`. The closed-vocabulary remediation
  changes the prompt and schema again, so those figures are retained only as
  historical evidence and must be replaced by a fresh complete capture before
  completion. The temporary harness and detached measurement worktree were
  removed.
- Parent privacy review found that the reserved tool rejected known non-direct
  scopes but admitted a missing verification scope. The tool now requires an
  affirmative `direct` scope and focused coverage includes missing, group, and
  unverified-external scope rejection. All five focused suites still pass 97
  tests with 25 credential-gated cases skipped, and Assistant Engine typecheck
  remains clean. This implementation-only guard does not change provider input.
- The preliminary specialist pass found five material seams: the paired email
  needed to be treated as part of the same product release; the deterministic
  unverified-audience responder and public changelog still volunteered the
  address; ordinary feature-request classification conflicted with the exact
  reserved support shape; real-provider fixtures lacked affirmative direct and
  group action scopes; and callback failure lacked provider-boundary no-retry
  proof. The fixes keep the two PRs as one release, make deterministic and
  prompt address disclosure opt-in, scope feature-request guidance to ordinary
  feedback, provide exact scopes, and cover one failed callback with truthful
  recovery. The supplied coverage patch was inspected and applied through the
  normal source edit.
- Final round 1 independently confirmed the ordinary/reserved classification
  and deterministic address findings and found that the new ordinary
  `flagged for the product team` line could overstate a best-effort post-reply
  write. The classification and address corrections are retained; the ordinary
  success claim was deleted from the compact and assembled guidance and the
  owning product contract.
- The stacked email specialist pass proved that capture-time token redaction is
  not semantic de-identification authority for text emailed beside an internal
  member identifier. The shared support contract now uses only allowlisted
  product-area and failure codes. The tool constructs the canonical persisted
  issue from those codes and rejects free-form reserved summaries, so the Web
  formatter can validate and render the issue without disclosing model-authored
  names, health facts, relationships, medications, or locations.
- Current focused proof passes: 106 Assistant prompt/tool/scenario tests with 26
  credential-gated provider cases compiled and skipped, the targeted
  deterministic unverified-audience privacy case, 6 hosted product-feedback
  contract tests, and 25 changelog tests. Assistant Engine and Hosted Execution
  typechecks pass; the compact base is 2,973 characters / 2,977 UTF-8 bytes,
  docs drift passes, and `git diff --check` is clean. After generating Health
  Commons and Prisma artifacts, Web typecheck reaches only two pre-existing
  `next.config.ts`/`next-config.test.ts` errors for the unrelated `agentRules`
  NextConfig extension; exact-head CI remains required.
- After merging the latest base and resolving the documentation, assembled-
  prompt, and model-behavior test conflicts, exact-head focused proof passes:
  106 Assistant prompt/tool/scenario tests with 27 credential-gated cases
  compiled and skipped, the deterministic unverified-audience privacy case, 6
  hosted product-feedback contract tests, and 26 changelog tests. Assistant
  Engine and Hosted Execution typechecks pass, docs drift passes, and
  `git diff --check` is clean.
- The final paired provider capture compares base `97993b4c2d` with merged head
  `3305014877` through the pinned real Codex App Server, `gpt-5.6-terra`, low
  reasoning, production code mode, and `gpt-tokenizer` 3.4.0
  `o200k_harmony`. The exact provider input adds 297 tokens / 1,393 bytes in
  both runtimes: direct moves from 27,031 tokens / 123,774 bytes to 27,328 /
  125,167 (+1.0987%), and group moves from 23,685 / 108,739 to 23,982 /
  110,132 (+1.2540%). Sequential attribution is +29 tokens / 117 bytes for
  compact instructions, +17 / 104 for assembled feedback guidance, and +251 /
  1,172 for the closed product-area/problem schema plus generated guidance.
  The synthetic capture included `input`, `parallel_tool_calls`, `text`, and
  `tool_choice`; its ignored temporary harness and generated workspace build
  outputs were removed or remained outside version control.
- Exact-head app verification on `11ccf04cc5` exposed that Web still classified
  support by the complete valid shape rather than by the reserved prefix. An
  old free-form `Support escalation:` value therefore fell through to ordinary
  feedback persistence instead of failing closed, and the Web support fixtures
  still built that obsolete value. Web now routes every exact reserved-prefix
  value through the closed-shape validator, so malformed or free-form reserved
  input is rejected before persistence. The Web fixtures and callback-boundary
  case use the shared canonical builder. After reconciling current `main`, the
  focused Web suites pass 11 tests, the shared support contract passes 6 tests,
  and Hosted Execution typecheck passes. Web typecheck reaches only the same
  unrelated existing `next.config.ts` and `next-config.test.ts` `agentRules`
  type errors, neither of which is in this PR's diff; exact-head CI remains
  pending.
