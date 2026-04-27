# Pre-Sleep Silent Meditation Research

## Goal

Run a standalone Health Commons research workflow for silent meditation before bed, with 10, 30, and 60 minute duration variants evaluated separately when evidence supports that split.

## Scope

- Create a separate charter-first research workspace for pre-sleep silent meditation.
- Keep meditation distinct from the already-landed pre-sleep resonance breathing protocol until this workflow is complete.
- Preserve overlap intentionally for later cleanup/dedupe, but do not edit the landed breathing page during startup.
- Treat CBT-I, yoga nidra, NSDR, guided-app/audio meditation, broad mindfulness-based therapy programs, daytime meditation programs, religious/spiritual practice programs, generic relaxation bundles, and sleep-hygiene bundles as adjacent unless sources directly support silent meditation before bed.

## Tasks

- [x] Register the standalone meditation workflow in the coordination ledger.
- [x] Initialize the research workspace.
- [x] Tighten the charter prompt around silent pre-sleep meditation and duration variants.
- [x] Send `01-charter`.
- [x] Harvest `01-charter`.
- [x] Materialize discovery seams.
- [x] Send discovery shards.
- [x] Harvest discovery shards.
- [x] Materialize `10-snowball-gap-fill`.
- [x] Send and harvest `10-snowball-gap-fill`.
- [x] Materialize `11-source-ledger-reducer`.
- [x] Harvest `11-source-ledger-reducer`.
- [x] Materialize source extraction batches.
- [x] Send source extraction batches. Sent all `001` through `013`; `008` is a rerun after preserving a weak original harvest.
- [x] Harvest and validate source extraction batches.
- [x] Materialize section synthesis seams.
- [x] Send and harvest section synthesis seams.
- [x] Send and harvest `30-page-builder`.
- [x] Send and harvest Evidence QA and Safety QA.
- [x] Run final reducer/landing phase. Browser final-reducer retries were abandoned after contamination/no-URL failures; landing was completed locally from the harvested page-builder package plus Evidence QA and Safety QA blockers.
- [ ] After standalone meditation lands, run a cleanup/dedupe pass against the existing pre-sleep downshift/breathing content.

## Current State

Workspace initialized at `output-packages/research/pre-sleep-silent-meditation`. Charter, discovery, snowball, and source-ledger reducer phases are complete. The reducer produced 269 canonical records, 0 ambiguous identities, 2 excluded records, and 13 extraction batches. All extraction batches `001` through `013` are harvested and locally validated. Original batch `008` on `mountain` produced only a shallow no-artifact answer, so that weak output/state was preserved under a `weak-69ef09a6` backup, the prompt was patched with a batch-scoped source-index excerpt, and a new `008` rerun on `phlebas` at `69ef4fd8-4c0c-8398-b231-f01268a42f57` harvested successfully. Final extraction coverage is 296 findings, 267 evidence appraisals, and 301 artifact candidates across the 13 batches. Section synthesis seams `20` through `27` are materialized, sent, harvested, and validated with substantial section text. `25` and `27` initially hit local CDP export timeouts but succeeded on recorded-lane retry without resending. `30-page-builder` harvested a package draft with 267 source pages, 1 protocol, 1 family, an artifact manifest, and evidence JSONL. Evidence QA and Safety QA both harvested and both blocked the draft pending edits; blockers included source-key/appraisal/group normalization, adding null/mixed timing-close evidence to final claims, removing the 30-minute ordinary option, strengthening safety screening/stop rules, and softening in-bed/breath-body wording. Browser `34-final-landing-reducer` attempts were not usable: the original `phlebas` attempt was shallow, `hercules`/`mountain` reused wrong conversations, `eragon` exported a contaminated Caffeine Curfew conversation, and `vonneumann`/`phlebas` retries stalled before recording a fresh URL. Local landing is now applied in `packages/health-commons/content/**` from the harvested page-builder package plus both QA reports, with the standalone silent-meditation protocol kept separate from the existing resonance-breathing protocol. Next work is the cleanup/dedupe pass against existing pre-sleep downshift/breathing content.


## Verification

Startup checks only:

- `pnpm research:init --topic "Silent meditation before bed" --family pre-sleep-downshift-practices --slug pre-sleep-silent-meditation --out-dir output-packages/research/pre-sleep-silent-meditation`
- `pnpm research:run --workspace output-packages/research/pre-sleep-silent-meditation --seam 01-charter --action send --lane hercules`
- `pnpm research:run --workspace output-packages/research/pre-sleep-silent-meditation --seam 01-charter --action harvest`
- `pnpm research:materialize --workspace output-packages/research/pre-sleep-silent-meditation`
- Extraction validation: all 13 extraction batches succeeded with 296 findings, 267 evidence appraisals, and 301 artifact candidates.
- Section validation: all 8 section synthesis seams succeeded with assistant-response text.
- Page-builder validation: required artifacts present; package draft ZIP contains 267 source pages, 1 protocol, 1 family, artifact manifest, and evidence JSONL.
- QA validation: `31-evidence-qa` and `32-safety-qa` harvested; both report BLOCK pending final reducer edits.
- Landing validation: `pnpm --filter @murphai/health-commons generate` passed.
- Typecheck: `pnpm --filter @murphai/health-commons typecheck` passed.
- Test gap: `pnpm --filter @murphai/health-commons test:vitest` currently fails one pre-existing deterministic catalog-order expectation (`alcohol-abstinence` appears before `dry-sauna/bryan-johnson-blueprint` in the six-item compact protocol list); the generator and typecheck pass.
