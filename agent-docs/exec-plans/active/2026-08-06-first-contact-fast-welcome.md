# first-contact-fast-welcome

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Remove the mandatory onboarding-skill and resume-context action round trip
  from a provably fresh private Linq turn whose entire accepted message is a
  bare greeting, so Murph can send the existing exact welcome several seconds
  sooner without weakening ordinary health, safety, resumed-onboarding, or
  delivery behavior.

## Success criteria

- A narrow engine-owned proof identifies only a new private Linq session with
  open onboarding, no prior conversation turn/history, and a strict bare
  greeting.
- That exact branch receives the canonical existing Murph welcome in prompt
  context and may answer directly without reading the onboarding skill or
  running onboarding resume-context.
- A greeting plus any health/safety/request content, an established or resumed
  conversation, every non-Linq channel, and every unproven state retain the
  full onboarding skill and tool path.
- Prompt-layer, turn-planning, and production-shaped hosted-local regressions
  prove both the fast branch and the fail-closed counterexamples.
- Focused tests, package typecheck, prompt/product/coverage specialist review,
  and exact-head CI pass. The candidate remains unmerged and undeployed per the
  user's explicit instruction.

## Scope

- In scope:
  - assistant turn planning and prompt assembly for fresh private Linq turns;
  - reuse of the existing canonical onboarding welcome copy;
  - strict greeting recognition owned by assistant-engine;
  - prompt, planning, and hosted-local direct proof;
  - matching onboarding product/protocol documentation.
- Out of scope:
  - deterministic delivery outside the assistant outbox;
  - changing the admission classifier schema or persisted admission records;
  - signup/enrollment/runtime wake ordering;
  - health/safety intent classification;
  - other channels, resumed onboarding, later turns, merge, or deployment.

## Constraints

- Technical constraints:
  - derive eligibility from existing authoritative turn/session/context facts;
    add no persisted onboarding step or parallel state owner;
  - preserve the ordinary provider request, assistant outbox, route, receipt,
    retry, and idempotency owners;
  - fail closed to the full skill path whenever proof is incomplete.
- Product/process constraints:
  - preserve the exact onboarding welcome and its easy reply question;
  - never fast-path a message containing a health concern, request, attachment,
    or additional semantic content;
  - follow iMessage deliverability guidance and keep the user-initiated reply
    conversational, link-free, and non-acquisitional;
  - prompt-primary work uses the worktree/PR lane, preliminary combined
    product/prompt/coverage review, and no shipping or deployment.

## Risks and mitigations

1. Risk: A greeting prefix such as `hi, I have chest pain` is mistaken for a
   bare greeting and bypasses urgent handling.
   Mitigation: Normalize only bounded whitespace/punctuation and require the
   whole accepted text to match a tiny allowlist; counterexample tests retain
   the full skill path.
2. Risk: A resumed or prior conversation receives the introductory welcome
   again.
   Mitigation: Require authoritative new-session/zero-prior-turn evidence in
   addition to open onboarding and private Linq route; absence or ambiguity
   disables the exception.
3. Risk: Prompt instructions conflict and the model still performs the skill
   read, or skips it beyond the narrow branch.
   Mitigation: Express one explicit branch in the onboarding overlay, snapshot
   both prompt variants, and prove the hosted-local greeting turn emits text
   without a command/tool action while counterexamples retain the mandate.
4. Risk: Copy or routing changes create a second delivery owner.
   Mitigation: Reuse the current exact welcome inside ordinary assistant
   generation and outbox delivery; add no direct Web/Linq send path.

## Tasks

1. Trace the authoritative first-turn/session facts and current onboarding
   prompt assembly, then record the smallest eligibility proof.
2. Add red prompt/planning counterexamples for exact greeting, semantic suffix,
   prior history, non-Linq route, and closed onboarding.
3. Implement the narrow eligibility proof and onboarding-overlay exception
   using the existing welcome copy.
4. Add production-shaped hosted-local proof when the existing harness exposes
   the required action/text trace without new production state.
5. Measure prompt token/byte impact, update durable onboarding documentation,
   run focused verification, and open the unmerged PR.
6. Run the combined preliminary product/prompt/coverage review and applicable
   final gate, resolve accepted findings, and leave the verified PR undeployed.

## Decisions

- Prefer a prompt exception over a deterministic delivery shortcut: production
  traces show a 5.72-second median first-output-to-text gap caused by the action
  round trip, while ordinary assistant/outbox ownership is already correct.
- Keep the exception greeting-only. A deterministic welcome for broader vague
  intent would require another classifier/state owner and is not justified by
  the current evidence.

## Verification

- Commands to run:
  - focused assistant-engine turn-planning and model-behavior Vitest files;
  - focused hosted-local Linq first-contact scenario when locally runnable;
  - assistant-engine and affected package typechecks;
  - docs drift, `git diff --check`, exact-head CI, and required ReviewGPT passes.
- Expected outcomes:
  - exact bare greeting receives the fast-welcome prompt contract;
  - all ambiguous or substantive inputs retain mandatory skill/resume behavior;
  - no delivery, provider, tool, schema, persisted-state, or channel regression.
