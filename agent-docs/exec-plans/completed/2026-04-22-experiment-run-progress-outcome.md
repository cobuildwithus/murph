# Land canonical experiment run, logging, progress, and outcome surfaces

Status: completed
Created: 2026-04-22
Updated: 2026-04-23

## Goal

- Land canonical private experiment run, logging, progress, and outcome surfaces so experiment truth lives in canonical vault records rather than assistant runtime residue.
- Close the current spec/prompt drift where onboarding and outcome flows assume exact protocol-bound run metadata that the canonical experiment record cannot yet store.

## Success criteria

- `vault-cli experiment` can persist a richer protocol-bound run contract with exact `protocolRef` and assistant-support fields.
- The repo exposes experiment-specific logging surfaces for protocol sessions and confounders/context without requiring the assistant to hand-assemble generic event payloads each turn.
- The repo exposes deterministic experiment progress and outcome reads/writes over canonical vault + wearable/query state.
- Assistant onboarding/prompt guidance points at the landed canonical surfaces instead of describing non-existent richer run storage.
- Truthful verification passes for the touched owners, required audit passes, and direct command proof for the new CLI surfaces are recorded before handoff.

## Scope

- In scope:
- `packages/contracts`, `packages/core`, `packages/query`, `packages/vault-usecases`, `packages/operator-config`, `packages/cli`
- directly coupled assistant guidance in `packages/assistant-engine/src/assistant/system-prompt.ts` and `packages/openclaw-plugin/skills/murph/SKILL.md`
- focused durable docs only if the landed contract/rules materially change canonical architecture or verification truth
- Out of scope:
- Health Commons content/model churn outside the already-landed onboarding/test-plan contract
- broad `apps/web` experiment UI work unless a directly coupled read-model/type consumer must move for the new canonical contract
- hosted onboarding/billing behavior beyond existing access/share gating
- public share/export UX beyond the private canonical outcome object and its direct read surfaces

## Constraints

- Technical constraints:
- Keep user-facing or queryable experiment truth out of assistant runtime per `ARCHITECTURE.md` and `agent-docs/SECURITY.md`.
- Reuse existing canonical event families and query wearable summaries where they already fit; do not invent a second parallel experiment-memory store.
- Preserve unrelated dirty-tree edits, especially the active biomarker and hosted-web lanes already in flight.
- Use `gpt-5.4` with `high` reasoning for any delegated subagents on this task.
- Product/process constraints:
- Keep one-meaningful-experiment / low-noise product guardrails intact.
- Keep reminders opt-in and skip-by-default for scheduled experiment checks.
- Avoid mixing this plan-bearing lane with currently dirty generated Health Commons artifacts unless a directly coupled contract change requires it.

## Risks and mitigations

1. Risk: widening the experiment frontmatter contract could ripple through CLI/query/browser-vault consumers and silently break overview/export paths.
   Mitigation: update contract/core/query/CLI in one coordinated pass with focused tests and direct CLI proof before touching assistant/web consumers.
2. Risk: experiment-specific logging could duplicate or bypass existing canonical event primitives.
   Mitigation: implement thin experiment wrappers over existing event families and keep linkage explicit through canonical ids/slugs and `relatedIds`/`links`.
3. Risk: overlapping dirty-tree work in `apps/web` and Health Commons/generated artifacts could create merge conflicts or accidental scope creep.
   Mitigation: keep the initial landing on private-run/query/assistant surfaces, avoid unrelated generated churn, and stage only exact touched paths at commit time.
4. Risk: deterministic progress/outcome logic could sprawl into speculative analytics.
   Mitigation: land a bounded v1 that focuses on phase/adherence/data coverage/basic biomarker deltas/confounders/confidence instead of full social/share flows.

## Tasks

1. Extend the canonical experiment contract to store richer private-run metadata.
2. Thread the richer run contract through core writes, CLI payloads, and query reads.
3. Add experiment-specific session/context logging wrappers over canonical event primitives.
4. Add deterministic experiment progress and outcome analyzer surfaces.
5. Update assistant guidance to use the landed canonical surfaces.
6. Verify with truthful owner-level commands, run required audit passes, and prepare a scoped finish/commit path.

## Decisions

- Keep the canonical private run on `bank/experiments/*.md` in this landing instead of inventing a brand-new canonical family.
- Keep progress deterministic and query-owned first; do not persist assistant-runtime “progress memory”.
- Treat hosted billing as a gating seam, not an owning seam, for this lane.

## Verification

- Commands to run:
- `pnpm typecheck`
- truthful `pnpm test:diff <path ...>` or owner-level coverage-bearing commands for touched packages
- `pnpm test:smoke`
- focused direct `vault-cli` command proof for richer run/logging/progress/outcome surfaces
- required `coverage-write` and `task-finish-review` audit passes before handoff
- Expected outcomes:
- New contract/core/query/CLI/assistant behavior is covered without unrelated owner regressions introduced by this lane.

## Verification record

- Passed:
- `pnpm --filter @murphai/contracts typecheck`
- `pnpm --filter @murphai/query exec vitest run test/experiment-analysis.test.ts test/browser-vault-replica-coverage.test.ts`
- `pnpm --filter @murphai/query typecheck`
- `pnpm --filter @murphai/query build`
- `pnpm --filter @murphai/vault-usecases typecheck`
- `pnpm --filter @murphai/vault-usecases build`
- `pnpm --filter @murphai/murph exec vitest run test/cli-expansion-experiment-journal-vault-phase2.test.ts`
- `pnpm --filter @murphai/murph typecheck`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/system-prompt.test.ts`
- `pnpm --dir packages/openclaw-plugin test`
- `pnpm --dir apps/web test -- --runInBand test/experiment-detail-private-run.test.tsx`
- `pnpm --dir apps/web typecheck`
- direct CLI proof with `node --import=tsx packages/cli/src/bin.ts` covering `experiment session log`, `experiment context log`, `experiment progress`, `experiment outcome analyze`, and `experiment outcome write`
- Audit passes:
- required `coverage-write` pass landed focused CLI proof for persisted outcome writes and context/session logging
- refreshed `task-finish-review` pass returned no findings after the final fixes
- Unrelated blocker:
- `pnpm --dir packages/assistant-engine typecheck` still fails on the separate assistant turn-input lane in `test/assistant-automation-runtime.test.ts` and `test/assistant-local-service-runtime.test.ts`; the experiment lane did not touch those seams
Completed: 2026-04-23
