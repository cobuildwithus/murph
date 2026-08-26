---
name: verify-murph-assistant
description: Add and run focused real-Codex journeys for changes that can alter how Murph understands a turn, chooses or calls tools, stays quiet, or writes a user-visible reply. Use for assistant prompts and instructions, tool descriptions or availability, skill routing, conversation context, reply policy, scheduled-assistant behavior, and regression fixes whose success depends on model behavior or reply quality.
---

# Verify Murph Assistant

Prove the real assistant journey, not only the surrounding TypeScript. Keep the
live lane focused and synthetic, and treat excellent user experience as part of
the acceptance result.

## Required Workflow

1. Read `agent-docs/operations/verification-and-runtime.md` § Expensive And
   Stochastic Proof Order and the relevant production prompt, tool, context,
   and delivery builders.
2. Add the cheapest deterministic regression first. Prove exact composed
   instructions or tool schema, owned effects, and the absence of conflicting
   guidance or forbidden calls. Live-model proof supplements this boundary; it
   never replaces it.
3. Add or extend one focused journey in
   `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts`.
   - Build from production prompt/instruction functions and real dynamic-tool
     contracts. Do not retype a simplified substitute.
   - Use private-free synthetic messages, state, ports, and provider results.
     Never copy a member transcript, identity, health record, or production row.
   - Assert exact required call counts, arguments, ordering when meaningful,
     writes or suppression, and the absence of bad calls. Avoid assertions on
     incidental reasoning steps.
   - Assert the reply's scenario-specific truth and forbidden claims. Print a
     compact synthetic scenario/reply line so the actual prose can be reviewed.
   - Give the journey a unique test name. Keep unrelated live turns in separate
     tests when they should be runnable independently.
4. Run only that journey through the local Codex subscription:

   ```bash
   pnpm test:assistant:live -- --test "<unique test-name pattern>"
   ```

   The command requires a focused name pattern and defaults to
   `gpt-5.6-terra` with the authenticated local ChatGPT/Codex subscription. Use
   `--model <model>` only when the product target differs. Use
   `--auth provider` only for an explicitly configured supported provider-key
   lane. Never print, copy, or persist auth material.
5. Read every printed member-visible reply and inspect the corresponding tool
   assertions. Mark the journey `Ready` only when all are true:
   - Murph fulfills the user's real purpose correctly and completely.
   - The number and order of actions are right; no duplicate check-in, send,
     write, question, or acknowledgement occurs.
   - The reply is concise, warm, clear, and truthful about what happened.
   - It respects user autonomy and saved preferences without nagging,
     contradiction, invented certainty, or internal implementation language.
   - Quiet paths stay quiet, and recovery copy gives the smallest useful next
     step without blaming the user.
6. If the prose or actions miss that bar, improve the owning production
   instruction/tool/context boundary, strengthen deterministic proof, and rerun
   the same focused live journey. Do not weaken an assertion to bless a poor
   experience.
7. In the PR evidence, name the command, model, auth class
   (`local subscription` or provider, never a secret), scenarios, exact effect
   result, and `Ready`/`Hold` reply-review verdict. Summarize the UX evidence;
   do not paste transcripts into the PR.

## Boundaries

- Keep live journeys opt-in. Routine CI compiles them but must not call a paid
  provider or depend on a developer's subscription.
- The local subscription mode intentionally uses the normal local Codex home
  for auth but does not copy it into a temporary home. It is developer-local
  evidence, not a hermetic CI lane. Provider-key mode keeps its
  isolated Codex home and minimal secret allowlist.
- Do not call production databases, delivery providers, device providers, or
  member-facing channels. Inject synthetic ports and fixtures.
- A stochastic pass is evidence for the tested model and run, not a guarantee
  for every future sample. Deterministic invariants and exact-head CI remain
  authoritative.
