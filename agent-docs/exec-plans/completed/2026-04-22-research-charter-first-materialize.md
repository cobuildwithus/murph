# Refactor research orchestrator to charter-first materialization

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Change the research scaffolding flow so `research:init` creates only the charter stage and shared runner.
- Add a follow-up materialization step that derives discovery shards and later seams from the charter output instead of preset or default shard maps.
- Remove preset-driven cold-plunge defaults from the tracked research-orchestrator assets to keep the workflow generic and charter-led.

## Success criteria

- `pnpm research:init "cold plunge"` creates a scaffold with only the charter prompt, charter command, workflow metadata, and a runbook that points to the materialization step after the charter response exists.
- A new `pnpm research:materialize --workspace <dir>` command reads the charter response, extracts the machine-readable seam definitions, and generates the post-charter prompts plus runnable discovery commands.
- Focused tooling tests cover both the charter-only scaffold and the charter-driven materialization flow.

## Scope

- In scope:
- `package.json` root script wiring for the new materialization command
- `scripts/research-init.mjs`
- new research materialization tooling under `scripts/**`
- tracked `scripts/research-orchestrator/**` prompt/docs assets
- focused repo-tools tests for the research tooling
- Out of scope:
- replacing `scripts/research.sh`
- automated wake or patch-download orchestration
- landing any Health Commons protocol content

## Constraints

- Keep the change in repo-internal workflow tooling.
- Preserve unrelated dirty-tree edits already present in the checkout.
- Do not hardcode topic-specific discovery shards or family mappings in the tracked scaffold generator.
- Keep generated scaffold files ASCII-only and free of local personal identifiers.

## Risks and mitigations

1. Risk: the charter output is too loosely structured for reliable materialization.
   Mitigation: tighten the charter prompt to require explicit named JSON blocks and validate them in the materializer.
2. Risk: existing generated workspaces still contain old discovery commands.
   Mitigation: make the materializer replace generated post-charter prompts and commands inside the target scaffold.
3. Risk: removing defaults makes the initial scaffold less convenient.
   Mitigation: keep `--family` and `--slug` overrides, and let the charter manifest update provisional identity fields before later stages are generated.

## Tasks

1. Register this plan and keep the file scope narrow in the coordination ledger.
2. Refactor `research:init` to create only the charter-stage scaffold and update the charter prompt contract.
3. Add `research:materialize` to parse charter output and generate discovery plus later-stage prompts from charter-defined seams.
4. Remove preset-driven tracked assets that are no longer used and refresh runbook/docs wording.
5. Run the truthful repo-internal verification lane and any required completion reviews before handoff.

## Decisions

- The charter owns the first concrete seam definition; presets and generic shard defaults are removed.
- Materialization should work against an existing scaffold directory instead of forcing a fresh `research:init`.

## Verification

- Commands to run:
- `node --check scripts/research-init.mjs`
- `node --check scripts/research-materialize.mjs`
- `pnpm test:repo-tools -- --runInBand scripts/research-init.test.ts`
- `pnpm typecheck`
- Expected outcomes:
  - research tooling scripts parse cleanly
  - focused repo-tools tests cover charter-only init plus charter-driven materialization
  - workspace typecheck stays green for the repo-internal tooling change
Completed: 2026-04-22
