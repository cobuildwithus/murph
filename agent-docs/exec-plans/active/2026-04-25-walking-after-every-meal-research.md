# Walking after every meal Health Commons research

Status: active
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Start a Health Commons research workflow for walking after every meal as a new protocol candidate.
- Success means the workspace has a coherent charter, a persisted `01-charter` thread URL, harvested charter output when the thread is ready, and materialized post-charter seams if the charter preserves a clean evidence boundary.

## Success criteria

- `output-packages/research/walking-after-every-meal` exists and is scoped as a post-meal walking family plus starter variant.
- The charter prompt explicitly separates walking after meals from generic daily walking, standing breaks, exercise snacks unrelated to meals, pre-meal exercise, high-intensity intervals, and clinical cardiac/pulmonary rehabilitation unless the charter gives a concrete evidence reason to merge them.
- `01-charter` is sent through a named managed research lane and records `state/chat-urls/01-charter.txt`.
- `01-charter` is harvested into `responses/01-charter.md` before later phases proceed.
- If the charter is coherent, `pnpm research:materialize --workspace output-packages/research/walking-after-every-meal` generates discovery and later-stage seams.

## Scope

- In scope:
  - `output-packages/research/walking-after-every-meal/**`
  - this execution plan
  - the shared coordination-ledger row for this research lane
- Out of scope:
  - Landing live Health Commons family, protocol, source, biomarker, artifact, or generated catalog files.
  - Editing existing Health Commons content or generated outputs.
  - Collapsing the protocol into broad walking, daily step-count, glucose-only, rehabilitation, or weight-loss bundles before evidence review.

## Constraints

- Preserve unrelated dirty work and active research harvests in the shared checkout.
- Use workspace-specific research config and named managed browser lanes.
- Keep claims conservative and source-bound.
- Keep safety, contraindication, fall-risk, post-meal symptom, diabetes-medication, pregnancy, frailty, and mobility-limitation considerations visible in the charter.
- Do not expose local identifiers, secrets, or personal data in generated files, logs, commits, or handoff.

## Risks and mitigations

1. Risk: "Walking after every meal" collapses direct postprandial walking studies with generic physical activity or step-count evidence.
   Mitigation: Treat the direct protocol as light-to-moderate walking soon after meals and preserve adjacent exclusions until the source-ledger reducer decides otherwise.
2. Risk: Evidence may focus narrowly on postprandial glucose while Murph needs a performable whole-protocol page.
   Mitigation: Require the charter to map glycemic, cardiometabolic, digestion/reflux, sleep, adherence, burden, and safety outcomes separately.
3. Risk: Browser lanes are busy with other long-running research seams.
   Mitigation: Use a measured send on a lower-load non-Phlebas lane and rely on workspace wake/harvest commands with their normal long timeout.

## Tasks

1. Initialize the research workspace. Done.
2. Add charter scoping guardrails. Done.
3. Send `01-charter` on a managed lane. Done.
4. Record thread URL and seam state. Done.
5. Harvest `01-charter` when ready. Done.
6. Review charter boundaries and materialize post-charter seams if coherent. Done.
7. Verify workspace setup and planning diff hygiene. Done.

## Current state

- Workspace: `output-packages/research/walking-after-every-meal`
- Provisional family: `post-meal-walking`.
- Provisional starter protocol: `walking-after-every-meal`.
- Charter thread: `https://chatgpt.com/c/69eca649-40a0-839b-a53c-74fa6463539e`
- Charter send and harvest completed on `eragon`.
- Charter decision: keep the provisional `post-meal-walking` family and `walking-after-every-meal` protocol, but leave variant splitting `unclear` until extraction resolves micro-walk, 10-15 minute, 20-30 minute, after-dinner-only, treadmill, and standing/walking-break evidence clusters.
- Post-charter seams were materialized. Discovery has 9 shards:
  - `02-discovery-direct-repeated-after-meals`
  - `03-discovery-micro-walks-and-standing-comparators`
  - `04-discovery-dose-duration-intensity`
  - `05-discovery-timing-before-vs-after-meals`
  - `06-discovery-clinical-populations-safety`
  - `07-discovery-lipids-insulin-secondary-metabolism`
  - `08-discovery-gi-comfort-reflux-digestion`
  - `09-discovery-free-living-adherence-burden`
  - `10-discovery-guidelines-external-protocols-consumer-claims`
- Discovery sends and harvests are complete for all 9 shards. Landed shards:
  - `02-discovery-direct-repeated-after-meals` on `vonneumann`
  - `03-discovery-micro-walks-and-standing-comparators` on `eragon`
  - `04-discovery-dose-duration-intensity` on `hercules`
  - `05-discovery-timing-before-vs-after-meals` on `vonneumann`
  - `06-discovery-clinical-populations-safety` on `eragon`
  - `07-discovery-lipids-insulin-secondary-metabolism` on `hercules`
  - `08-discovery-gi-comfort-reflux-digestion` on `vonneumann`
  - `09-discovery-free-living-adherence-burden` on `vonneumann`
  - `10-discovery-guidelines-external-protocols-consumer-claims` on `eragon`
- Each discovery shard produced a parsed `source_candidates_v1.json` artifact with 40 records.
- Next step is source-ledger reduction after a quick review for duplicate or off-boundary discovery candidates.

## Verification

- Planned:
  - `git diff --check -- agent-docs/exec-plans/active/2026-04-25-walking-after-every-meal-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - direct readback of `workflow.json`, `prompts/01-charter.md`, `state/chat-urls/01-charter.txt`, and seam state after send.

Results:
- `pnpm research:init "Walking after every meal" --family post-meal-walking --slug walking-after-every-meal --out-dir output-packages/research/walking-after-every-meal` passed.
- `pnpm research:run --workspace output-packages/research/walking-after-every-meal --seam 01-charter --action send --lane eragon` passed.
- `pnpm research:run --workspace output-packages/research/walking-after-every-meal --seam 01-charter --action harvest` passed.
- `pnpm research:materialize --workspace output-packages/research/walking-after-every-meal` passed.
- Discovery sends `02` through `10` passed and recorded chat URLs.
- Discovery harvests `02` through `10` passed and recorded harvested artifacts.
- Direct JSON readback confirmed all 9 discovery `source_candidates_v1.json` artifacts parse and each contains 40 records.
- Seam state readback confirmed discovery `02` through `10` have `send=completed` and `harvest=completed`.
- Planning diff whitespace check passed for the plan, coordination ledger, and charter prompt.
- Direct readback confirmed `workflow.json` is `materialized`, with 9 discovery shards and 9 section seams.
- Local identifier privacy scan over the new research workspace, plan, and ledger passed after redacting generated wake helper/status/artifact-contract artifacts.
