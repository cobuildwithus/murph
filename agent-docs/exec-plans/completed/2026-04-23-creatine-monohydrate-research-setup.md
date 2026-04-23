Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Set up a Murph Health Commons research workspace for a creatine monohydrate experiment without widening into source landing or evidence claims.

## Success criteria

- A dedicated workspace exists under `output-packages/research/creatine-monohydrate`.
- The workspace is scoped as `creatine-monohydrate` under a broader `creatine-supplementation` family.
- The charter prompt explicitly separates monohydrate from adjacent creatine forms and biases the research toward experiment-relevant outcomes, safety boundaries, and practical dosing/implementation questions.
- The workspace is materialized so discovery shards and later-stage templates are ready for the next research run.
- Verification covers the touched setup files and generated workspace state.

## Scope

- In scope: the creatine research workspace under `output-packages/research/creatine-monohydrate`, this active plan, and the shared coordination ledger row needed to reserve the lane.
- Out of scope: running the full evidence workflow, landing Health Commons family/protocol/source pages, generated catalog updates, or broader research-tooling changes.

## Constraints

- Preserve unrelated dirty-tree work.
- Keep the workspace repo-local and avoid hardcoded absolute paths.
- Treat creatine monohydrate as the starter protocol variant unless the charter later proves a better split.

## Tasks

1. [ ] Register the task in the coordination ledger.
2. [ ] Scaffold the creatine monohydrate workspace with the repo research initializer.
3. [ ] Tailor the charter prompt for creatine-family boundaries and experiment-relevant outcomes.
4. [ ] Materialize post-charter seams without fabricating research outputs.
5. [ ] Run scoped verification for the touched setup files and workspace wrappers.

## Progress notes

- `pnpm research:init --topic "creatine monohydrate" --slug creatine-monohydrate --family creatine-supplementation --out-dir output-packages/research/creatine-monohydrate` created the workspace successfully.
- The charter prompt and workspace README were narrowed so the starter protocol stays `creatine-monohydrate` under `creatine-supplementation`, with adjacent creatine forms and clinical-only contexts kept separate by default.
- `bash output-packages/research/creatine-monohydrate/commands/01-charter.sh` successfully created and sent a real ChatGPT thread and persisted `state/chat-urls/01-charter.txt`.
- The managed-browser wake loop never wrote `responses/01-charter.md` cleanly, but the landed thread export under `downloads/01-charter/thread.json` plus `state/thread-exports/01-charter.thread.json` was sufficient to recover the charter output.
- `responses/01-charter.md` was backfilled from the landed thread export, with the machine-readable blocks reconstructed directly from the recovered prose charter so `research:materialize` could parse it.
- `pnpm research:materialize --workspace output-packages/research/creatine-monohydrate` completed successfully and generated the discovery tranche plus later-stage templates.

## Verification

- `bash -n` over the workspace command, config, and packaging shell scripts passed.
- `node -e "JSON.parse(...workflow.json...)"` passed before and after materialization.
- `git diff --check -- agent-docs/exec-plans/active/2026-04-23-creatine-monohydrate-research-setup.md output-packages/research/creatine-monohydrate` passed.
- `pnpm test:smoke` passed.
- `pnpm typecheck` remains red for the pre-existing unrelated failure in `apps/cloudflare/test/runner-run-processor.test.ts` (`TS2339: Property 'mockRejectedValue' does not exist on type 'never'`).
Completed: 2026-04-24
