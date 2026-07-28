# Onboarding goal choice point

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Finish PR #1061 as one maintainable, member-owned managed one-shot that gives
  every eligible answered-onboarding member a low-pressure goal choice point,
  including members whose onboarding predates the feature.

## Success criteria

- Recent answered onboarding schedules the choice point 21 local-calendar days
  after completion with a seven-day finite delivery window.
- Older answered onboarding receives one distributed catch-up occurrence,
  installed through ordinary managed-automation reconciliation and never
  recreated after consumption.
- Unclear, unshared, changed, completed, and intentionally open goals are
  explicit prompt branches; Murph never invents a goal, problem, or progress.
- Canonical onboarding remains the eligibility and timing authority, while the
  existing automation record remains the only durable execution/idempotency
  owner.
- Cron revalidates current answered-onboarding authority before model work and
  at every existing provider, tool, delivery, and commit boundary.
- The temporary staging artifact is removed, focused and canonical verification
  pass, specialist and product reviews are resolved, final ReviewGPT is clean,
  CI is green, and the PR is mergeable and ready for review.

## Scope

- In scope: the existing PR implementation in assistant-engine and
  assistant-runtime, focused tests, current managed-automation/onboarding owner
  docs, PR description, review gates, and CI.
- Out of scope: new database state, a rollout table, recurring outreach,
  onboarding schema changes, a goal-review subsystem, or automatic goal/plan
  mutation.

## Constraints

- Reuse the existing managed-automation installer, canonical onboarding state,
  finite one-shot lifecycle, route authority, engagement pause, and bounded
  retry behavior.
- Keep immutable automation identity as the member-ownership authority; mutable
  instructions, tags, titles, and routes never confer authority.
- Preserve all ordinary suppression and safety behavior, including cold-thread
  engagement gating and quiet skipping.
- Keep the prompt short-message outcome to two to four sentences and exactly
  one easy question.

## Risks and mitigations

1. Risk: rollout creates a burst of stale outreach.
   Mitigation: distribute legacy catch-up by onboarding completion weekday,
   schedule a future local 1:30 p.m. occurrence, retain the seven-day window,
   and rely on existing engagement and suppression gates.
2. Risk: a later maintenance pass moves or recreates the legacy occurrence.
   Mitigation: preserve the first installed canonical record and stable
   automation id; archived or consumed records remain terminal.
3. Risk: reopening or recompleting onboarding leaves an already-claimed stale
   occurrence runnable.
   Mitigation: re-read canonical onboarding before provider work and at every
   existing irreversible boundary.
4. Risk: sparse context causes Murph to imply a goal or failure.
   Mitigation: keep the no-trustworthy-goal branch explicit and require claims
   to follow specific reliable evidence.
5. Risk: prompt-only mutation guidance leaves ordinary scheduled-turn tools
   available.
   Mitigation: the exact immutable automation id selects a fresh output-only
   one-shot profile with bounded transcript and engine-projected active-goal
   titles, while engine planning and provider execution remove the memory
   document, generic CLI contract, shell, hosted dynamic tools, broad context,
   network fetches, writable filesystem access, and mutation-capable overrides.
6. Risk: a rollback after the new bundle installs the stable record returns
   execution to code that does not recognize its owner or output-only profile.
   Mitigation: engine and runtime support ship together, the first installing
   bundle is a hard rollback floor, and production uses immediate container
   rollout plus runner-bundle fingerprint convergence proof.

## Tasks

1. Remove the staged patch artifact and land the deterministic onboarding
   execution guard.
2. Add stable legacy catch-up reconciliation for existing answered-onboarding
   members and focused lifecycle/idempotency coverage.
3. Update the durable onboarding, architecture, security, reliability, and
   verification contracts.
4. Run focused tests, `pnpm test:diff`, and `pnpm verify:acceptance`.
5. Complete product-experience review, preliminary prompt/coverage ReviewGPT,
   parent final review, final ReviewGPT, fresh CI, PR body update, and final
   mergeability/readiness proof.

## Decisions

- Do not create rollout state. For expired original windows, derive the next
  matching local weekday from the canonical completion date and current
  maintenance time; after installation, the existing canonical automation
  record anchors the occurrence.
- Keep legacy catch-up as the same stable one-shot identity. This preserves
  once-only behavior and lets ordinary managed reconciliation create the record
  for existing hosted workspaces during their next maintenance pass.
- Use final ReviewGPT because the change crosses prompt behavior, hosted
  execution, immutable identity, and lifecycle authority.
- Keep the 20-elapsed-day execution floor as the conservative lower bound for a
  21-local-calendar-day occurrence after a late-day completion or timezone
  transition. It rejects a recently replaced completion without adding rollout
  state or requiring exact historical-completion equality.

## Verification

- Focused assistant-engine schedule, reconciliation, and cron authority tests.
- Focused assistant-runtime managed-maintenance tests.
- `pnpm test:diff packages/assistant-engine packages/assistant-runtime
  ARCHITECTURE.md agent-docs/SECURITY.md agent-docs/RELIABILITY.md
  agent-docs/product-specs/murph-onboarding.md
  agent-docs/references/testing-ci-map.md`
- `pnpm verify:acceptance`
- PR-specific ReviewGPT and GitHub CI on the exact final pushed head.
- Completed: focused Assistant Engine suite passed 294 tests across scheduling,
  legacy reconciliation, lifecycle races, output-only planning, notification
  routing, silent skip, and provider execution; Assistant Engine and Assistant
  Runtime typechecks passed.
- Completed: the preliminary specialist pass found an over-broad memory/CLI
  evidence surface, an unmeasured high-reasoning override, and a missing
  production-faithful longest-path proof. The implementation now uses a
  dedicated output-only prompt built from bounded committed conversation and
  engine-projected active-goal titles, exposes no memory/CLI/shell/hosted tools,
  and inherits the ordinary reasoning setting. A cross-owner actual-provider
  mega-test was not added because the established owner boundaries are covered
  independently; the remaining actual-model evidence gap stays explicit.
- Completed: fresh product-experience re-review confirmed the earlier
  mutation-capability concern is resolved and found one material quiet-skip
  issue. The onboarding profile now starts no typing indicator, and focused
  coverage proves a skipped turn produces neither typing nor delivery. The
  follow-up product verdict returned no findings.
- Completed: parent prompt review found that editable automation task text still
  carried the detailed behavioral contract while the system layer correctly
  treated that text as untrusted. The immutable dedicated system prompt now owns
  the goal, skip rules, evidence branches, unclear/unshared/open/explore path,
  message shape, and no-mutation boundary; the persisted task is a short
  non-authoritative description. Focused planning and seed tests prove that
  ownership split. The final product follow-up returned no findings.
- The scoped canonical `test:diff` passed all repository guards, affected
  typechecks, 2,791 Assistant Engine tests, 128 Assistant CLI tests, 1,937
  Assistant Runtime tests, and 40 assistantd tests. Its unrelated CLI
  integration tail blocked waiting for a shared prepared-runtime artifact held
  by another checkout, so the owned process was stopped after the affected
  lanes completed. Canonical acceptance, parent final review, final ReviewGPT,
  and fresh CI remain.
- Two direct standalone runtime probes could not start because their ad hoc
  harness lacked prebuilt workspace artifacts. The focused Vitest owner tests
  exercise the same vault and notification paths; the remaining evidence gaps
  are the production-faithful hosted actual-model longest path and a sampled
  actual-model branch-quality matrix.
