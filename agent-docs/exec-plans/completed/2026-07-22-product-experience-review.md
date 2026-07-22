# Product experience review gate

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Make product experience a required, evidence-backed completion concern for
  materially changed user-facing behavior across chat, runtime, and web UI.
- Strengthen the ReviewGPT PR prompt so it audits end-to-end completion,
  latency and feedback, permission flows, and the smallest polished interface
  that expresses the feature's purpose.

## Success criteria

- A new review-only local `product-experience-review` specialist has a clear
  trigger, prompt, handoff packet, output contract, rerun rule, and valid
  zero-finding state.
- The specialist traces the irreducible user purpose, every user-visible state
  and async handoff, final delivery or recovery, and frontend interaction
  economy, craft, and rendered evidence when UI is involved.
- ReviewGPT reports reachable material UX failures and experience-collapse
  opportunities without turning subjective polish into merge-blocking noise.
- The PR intent contract states the expected feedback, timing class, terminal
  outcomes, and why the interface is the smallest complete experience.
- Workflow routing preserves the single cross-cutting gate while making the
  new pass independent from `frontend-review`, `coverage-write`, and
  ReviewGPT/local `deep-review`.
- Required prompt review and scoped docs/tooling verification pass with no
  unresolved accepted findings.

## Scope

- In scope: the ReviewGPT PR prompt, local audit prompt library, completion and
  routing docs, PR-loop specialist-pass wording, prompt inventory, and the
  required-file guard for the new prompt.
- Out of scope: product runtime fixes, changes to PR 840, a universal latency
  SLO, new UI components, or new audit services/state.

## Constraints

- Technical constraints: keep the new audit review-only; preserve ReviewGPT
  versus local `deep-review` mutual exclusion; use existing audit-subagent and
  resolution-loop machinery.
- Product/process constraints: judge the whole experience rather than only
  rendered UI; require rendered evidence for frontend craft; prefer deletion,
  strong defaults, and progressive disclosure over extra text, clicks,
  settings, confirmations, or screens.

## Risks and mitigations

1. Risk: a broad UX mandate produces subjective taste findings and process
   noise.
   Mitigation: require reachable evidence, material user impact, an explicit
   irreducible-purpose test, and a smallest-correction or deletion path.
2. Risk: the new pass duplicates `frontend-review` or the cross-cutting gate.
   Mitigation: give product-experience review ownership of purpose, journey,
   timing, feedback, interaction economy, and craft; keep frontend review on
   rendered implementation, responsiveness, accessibility, and design-system
   execution.
3. Risk: reviewers accept “asynchronous” as enough proof for delayed or lost
   work.
   Mitigation: require the normal wait path, wake/continuation ownership,
   eventual user-visible closure, and production-faithful direct evidence.

## Tasks

1. Add the local product-experience review prompt and register it in durable
   prompt inventory and required-file checks.
2. Wire its trigger, sequence, worker rules, handoff packet, rerun behavior,
   and handoff reporting into completion workflow and task routing.
3. Expand the PR experience contract and ReviewGPT prompt with end-to-end UX,
   frontend minimalism/craft, material UX failure, and experience collapse.
4. Update the ReviewGPT loop to preserve the new specialist alongside the one
   cross-cutting gate.
5. Run prompt review, scoped verification, parent final review, and finish the
   task with a scoped commit.

## Decisions

- Use one `product-experience-review` specialist across conversational,
  runtime, and frontend behavior instead of adding separate latency and visual
  minimalism passes.
- Run both `product-experience-review` and `frontend-review` for material
  frontend workflow changes because they answer different questions.
- Keep prompt-primary workflow changes on the existing `prompt-review` path;
  the new pass triggers on changed Murph product experiences, not on the audit
  prompt that defines the pass.
- Translate the “Steve Jobs” quality bar into testable principles: one clear
  purpose, ruthless subtraction, immediate comprehension, strong defaults,
  progressive disclosure, coherent feedback, and a finished rendered result.

## Verification

- Commands to run: `pnpm test:diff` over the touched prompt/workflow paths,
  `pnpm docs:drift`, `bash -n scripts/repo-tools.config.sh`,
  `git diff --check`, required local `prompt-review`, and privacy/readback
  inspection.
- Expected outcomes: every check passes, the prompt reviewer reports no
  unresolved actionable finding, the final diff contains no direct personal
  identifiers, and only task-scoped files enter the commit.

## Verification results

- `pnpm docs:drift`, Bash syntax, diff hygiene, privacy/readback inspection,
  and the required prompt-review rerun passed.
- The prompt reviewer accepted and verified two corrections: ReviewGPT no
  longer infers rendered quality without readable guarded artifacts, and the
  product-experience specialist now defers token-level frontend execution to
  `frontend-review`.
- A representative contract dry run classified the delayed/lost cross-runtime
  request, removable frontend friction, and healthy owned asynchronous path as
  intended, with zero findings valid for the healthy path.
- Canonical `pnpm test:diff` was invoked but remained queued behind unrelated
  workspace verification and was stopped without interrupting that owner. The
  focused ReviewGPT contract test reached the changed-prompt assertions, then
  failed four pre-existing checks whose 7.5-minute expectation disagrees with
  the current 10-minute driver threshold; this task changes neither surface.
- Runtime and browser scenario proof is not applicable to this prompt/process
  change.
Completed: 2026-07-22
