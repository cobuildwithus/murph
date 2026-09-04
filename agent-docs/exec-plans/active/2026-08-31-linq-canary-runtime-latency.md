# Linq canary first-runtime-turn latency

Status: candidate
Created: 2026-08-31
Updated: 2026-09-04

## Goal

- Reduce the time from an accepted first post-signup iMessage turn to Murph's
  first useful response without changing onboarding meaning, delivery
  authority, or canonical state ownership.

## Product UX Patch

- Outcome: a new member receives the existing onboarding continuation sooner.
- Reaches: private iMessage instant-start followed immediately by the first
  ordinary hosted-runtime turn.
- Proof: deterministic production-boundary timing coverage plus one focused
  GPT Terra journey that preserves the reply and exact owned actions.

## Evidence boundary

- Production-safe timing aggregates show a cold hosted-runtime start and a
  tool-using onboarding model turn are the two material latency owners.
- A focused synthetic GPT Terra journey reproduces the same onboarding policy
  read and reply shape without production data.
- Keep production row contents, member identifiers, provider identifiers, and
  message text out of this plan and every review artifact.

## Constraints

- Preserve the instant welcome, canonical onboarding resume context, existing
  private iMessage route, typing feedback, and delivery semantics.
- Do not add a queue, scheduler, cache owner, fallback responder, or
  feature-specific capability sandbox.
- Prefer deletion, composition of existing owner work, or earlier reuse of an
  already-required result.
- Keep the first-response hot path free of new provider or database fanout.

## Tasks

1. [x] Capture the exact synthetic Terra action pair for the first routine-goal
   onboarding turn and map it to production owners.
2. [x] Prove whether the redundant work is in prompt composition, policy loading,
   onboarding-state resolution, or hosted cold-start sequencing.
3. [x] Implement the smallest owner-local latency reduction with deterministic
   regression coverage.
4. [ ] Finish the public changelog entry, parent review, scoped commits, draft
   PR, and exact-head CI. The prompt-primary diff is exempt from final
   ReviewGPT unless a separate cross-cutting trigger appears.

## Done when

- The synthetic first runtime turn preserves the current concise onboarding
  question and performs no duplicate write, question, progress update, or
  delivery.
- The proven avoidable latency step is removed or moved off the critical path.
- Required focused verification and reviews pass on the exact candidate head.

## Root cause and correction

- The injected onboarding overlay universally required the onboarding skill
  read before every onboarding answer. The skill then correctly required the
  canonical resume-context read, even when the visible direct transcript
  already contained Murph's canonical welcome and therefore proved the exact
  first-reply stage.
- The overlay now owns one narrow decision: a direct reply that accepts or
  continues immediately after the visible canonical welcome proceeds to the
  already-canonical bundled minimal-identity question without either read.
- Missing welcome evidence, an already-answered identity question, an immediate
  request, and ambiguous or later-stage conversations retain the normal skill
  and resume-context path.

## Product UX walkthrough

- Ready — new direct member: a synthetic `Hey` produced the canonical welcome;
  the same Terra session then accepted and named an evening-routine aspiration.
  Murph asked only for preferred name, age, and gender, with no internal
  progress message and no policy or resume shell action.
- Ready — ambiguous or unproven stage: the no-visible-welcome turn in the same
  journey retained the onboarding skill and resume-context calls before
  returning the canonical welcome.
- Excluded intentionally: later identity, discovery, foundation, return,
  deferral, skip, safety, and immediate-request behavior remains owned by the
  existing onboarding skill.

## Verification

- Deterministic prompt and turn-planning coverage: 183 tests passed across
  `model-behavior.test.ts` and `assistant-codex-turn-planning.test.ts`.
- Assistant Engine typecheck passed; the change adds no cross-package import.
- Focused real-Codex journey passed locally with `gpt-5.6-terra` and
  subscription authentication. The no-visible-welcome turn used two provider
  actions and took 14.215 seconds. The resumed visible-welcome turn used zero
  actions, read no policy file, ran no resume check, sent no progress update,
  and returned the bundled formal question in 3.268 seconds.
- Complete initial provider input was captured through the pinned real Codex
  App Server against the local scripted Responses stub with identical synthetic
  direct and group fixtures, production code mode, `gpt-5.6-terra`, low
  reasoning, and `gpt-tokenizer` 3.4.0 `o200k_harmony`. Present provider fields
  were `include`, `input`, `parallel_tool_calls`, `text`, and `tool_choice`;
  volatile local paths and UUIDs were normalized, and provider output,
  transport, model-selection, reasoning, storage, streaming, account, and cache
  metadata were excluded identically.
  - Direct: 26,187 tokens / 120,994 UTF-8 bytes at base; 26,394 / 122,019 at
    head; +207 tokens (+0.7905%) and +1,025 bytes (+0.8471%).
  - Group: 21,531 tokens / 99,443 bytes at both base and head.
  - The direct delta is entirely the assembled onboarding instructions. No
    tool/schema/generated guidance or other provider-visible field changed.
- `pnpm complexity:diff` and `git diff --check` passed. Existing complexity debt
  in the prompt builder stayed unchanged; no new abstraction is justified.
