# Audit deferred capability discovery

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Make Murph answer plain-language capability questions truthfully by discovering
  relevant deferred tools before it denies or redirects, without taking an
  action merely because the member asked what is possible.

## Success criteria

- A bounded synthetic Terra audit covers representative deferred capability
  families and records which questions pass or fail.
- Every observed systemic failure has the smallest owning prompt or tool-contract
  correction plus deterministic boundary coverage.
- Focused real-Terra regressions return concise truthful answers and perform zero
  effects for capability-only questions.
- Focused tests, Assistant Engine typecheck, exact-head CI, and the required
  preliminary Product UX/prompt/coverage review pass.

## Scope

- In scope: private-assistant plain-language questions about representative
  deferred capability families; production prompt/tool discovery boundaries;
  focused deterministic and real-model proof.
- Out of scope: adding capabilities, changing authorization or delivery,
  broad tool-schema rewrites, production data, and exhaustive stochastic testing
  of every tool.

## Constraints

- Technical constraints: use production-composed prompts and dynamic-tool
  contracts; capability questions must have zero effects; keep one source of
  truth and avoid capability-specific machinery unless evidence requires it.
- Product/process constraints: Product UX Patch. Outcome: existing capabilities
  are represented accurately. Reaches: a member asks in a private conversation
  whether Murph can help. Proof: synthetic live Terra replies plus exact zero-call
  assertions and deterministic composed-boundary tests.

## Risks and mitigations

1. Risk: a stochastic sample is mistaken for a universal model guarantee.
   Mitigation: use the live audit only to locate failures, then pin the owning
   deterministic instruction or schema and add focused regression journeys.
2. Risk: a broad prompt rule causes overpromising or needless tool use.
   Mitigation: distinguish questions from action requests, require actual tool
   discovery before denial, and assert no actions on question-only turns.

## Tasks

1. Inspect the production prompt, dynamic catalog, and existing live journeys.
2. Run a bounded real-Terra capability-question audit across representative
   deferred-tool families and classify observed failures.
3. Implement the smallest shared owner correction supported by the evidence.
4. Add deterministic and focused live regressions, then replay affected UX.
5. Verify, commit, push a separate PR, run required review/CI, and hand off.

## Decisions

- Audit first; do not assume deferred schemas are the root cause.
- A capability question asks for an accurate explanation, not execution.
- The live audit found the main failure in eager tools as well as dynamic
  availability: Terra sometimes executed voice, song, device, or lab tools as
  availability probes, invented missing inputs, then treated the host rejection
  as proof that Murph lacked the capability. Deferred automation discovery
  answered correctly.
- Fix the shared classification boundary once: a bare `Can you...?` is a
  capability question until the member supplies a concrete task or content.
  Keep tool descriptions as the source of truth and forbid probe execution.

## Verification

- `pnpm --filter @murphai/assistant-engine exec vitest run
  test/codex-thread-instructions.test.ts test/model-behavior.test.ts
  --no-coverage`: 87 passed.
- `pnpm --filter @murphai/assistant-engine typecheck`: passed.
- `pnpm test:assistant:live -- --codex-home <LOCAL_SUBSCRIPTION_HOME> --test
  "answers capability questions without executing the capability"`: passed on
  `gpt-5.6-terra`; voice, song, Garmin, and lab replies were truthful and made
  zero capability calls; reply review `Ready`.
- `pnpm --dir apps/web test -- changelog-page.test.tsx`: 9 passed.
- `pnpm --dir apps/web typecheck`: passed.
- Exact-head CI and preliminary `completion-specialists` ReviewGPT run after the
  final candidate is pushed.
Completed: 2026-08-28
