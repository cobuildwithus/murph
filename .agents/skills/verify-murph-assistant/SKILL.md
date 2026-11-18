---
name: verify-murph-assistant
description: Add and run focused real-Codex journeys for changes that can alter how Murph understands a turn, chooses or calls tools, stays quiet, or writes a user-visible reply. Use for assistant prompts and instructions, tool descriptions or availability, skill routing, conversation context, reply policy, scheduled-assistant behavior, and regression fixes whose success depends on model behavior or reply quality.
---

# Verify Murph Assistant

Prove the real assistant journey as well as the TypeScript around it. Keep the
live lane focused and synthetic, and count the member's experience as part of
the result.

## Workflow

1. Read `agent-docs/operations/verification-and-runtime.md` § Expensive And
   Stochastic Proof Order and the production prompt, tool, context and delivery
   builders the change touches.
2. Add the cheapest deterministic regression first: the exact composed
   instructions or tool schema, the owned effects, and the absence of
   conflicting guidance or forbidden calls. The live run adds to this proof and
   does not replace it.
3. Add or extend one focused journey in
   `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts`.
   - Build it from the production prompt functions and real dynamic-tool
     contracts, with synthetic messages, state, ports and provider results.
     Never copy a member transcript, identity, health record or production row.
   - Assert required call counts, arguments, ordering where it matters, writes
     or suppression, and the absence of bad calls. Leave incidental reasoning
     steps unasserted.
   - Assert what the reply must say and must not claim, and print a compact
     scenario/reply line so the prose can be read.
   - Give the journey a unique test name so it runs on its own.
4. Run only that journey:

   ```bash
   pnpm test:assistant:live -- --test "<unique test-name pattern>"
   ```

   It defaults to `gpt-6.2-sol` on the authenticated local ChatGPT/Codex
   subscription. Pass `--model <model>` only when the product target differs,
   and `--auth provider` only for a configured provider-key lane. A
   subscription run uses the developer's own Codex home and global
   instructions, so report it as developer-local evidence; an isolated
   provider run is the release evidence. Keep the auth mode you were given,
   and never print, copy or persist auth material. If the default subscription
   home fails before any provider action, the section named in step 1 owns the
   alternate-home retry.
5. Read every printed reply next to its tool assertions. The journey is
   `Ready` when Murph did what the member wanted, correctly and completely;
   took each action once and in the right order; replied concisely, warmly and
   truthfully, without nagging, invented certainty or internal language; kept
   quiet paths quiet; and, on a failure, gave the smallest useful next step
   without blaming the member.
6. If it misses that bar, fix the production instruction, tool or context that
   owns the behavior, strengthen the deterministic proof and rerun the same
   journey. Keep the assertion as strict as it was.
7. In the PR evidence, give the command, model, auth class (`local
   subscription, ambient configuration` or `provider, isolated home`), the
   scenarios, the exact effect result and the `Ready` or `Hold` verdict.
   Summarize the replies; transcripts stay out of the PR.

## Boundaries

- Live journeys are opt-in. Routine CI compiles them and never calls a paid
  provider or a developer's subscription, and no scheduled workflow runs them.
- Journeys use injected synthetic ports and fixtures, never production
  databases, delivery or device providers, or member-facing channels.
- A pass is evidence for that model and run. Deterministic invariants and
  required CI stay authoritative.
