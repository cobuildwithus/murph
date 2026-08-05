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
  product-only summary in the same turn without displaying it or asking for
  separate approval.
- Group, unverified, or semantically unsafe contexts receive a private support
  route without an account-linked tool call; the address appears only if asked.
- Completion copy reports the durable record without claiming that a capped
  email was delivered or received.

## Scope

- In scope: compact Assistant Engine support guidance, focused prompt and
  one-turn real-model scenario definitions, and the owning product, security,
  architecture, deployment, and verification docs.
- Out of scope: Web email formatting, feedback persistence, schemas, callback
  shapes, flags, queues, retries, recipients, or provider configuration.

## Risks and mitigations

1. Risk: the generated summary can include semantic private context.
   Mitigation: keep the bounded product-only model contract, deterministic
   redaction defense in depth, and a synthetic private-context scenario.
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
  no consent version, rollout floor, or feature flag is required.
- Ordinary feedback remains best-effort; a clear accepted Murph product failure
  may receive one brief product-team acknowledgement. The assembled developer
  prompt and tool description exclude reserved support escalation from that
  policy and route an explicit private human-support request to durable
  completion.

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
- Complete paired first-provider capture used the pinned real Codex App Server,
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
  compared `9d1d17fd45` to `e374d58700`; later base-only merges changed a food
  skill, provider-usage extraction, tests, and Web build tooling/docs but no
  loaded fixture prompt, tool, schema, provider configuration, or request
  assembly, so the rendered totals remain the current base/head totals. The
  temporary harness and detached measurement worktree were removed.
- Parent privacy review found that the reserved tool rejected known non-direct
  scopes but admitted a missing verification scope. The tool now requires an
  affirmative `direct` scope and focused coverage includes missing, group, and
  unverified-external scope rejection. All five focused suites still pass 97
  tests with 25 credential-gated cases skipped, and Assistant Engine typecheck
  remains clean. This implementation-only guard does not change provider input.
