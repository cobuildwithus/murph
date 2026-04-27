# Resonance breathing and meditation Health Commons research

Status: active
Created: 2026-04-26
Updated: 2026-04-26

## Goal

- Start a Health Commons research workflow for pre-sleep resonance breathing and silent meditation as related but separable low-burden downshift protocols.
- Success means the workspace has a coherent charter, a persisted `01-charter` thread URL, harvested charter output when the thread is ready, materialized post-charter seams if the charter preserves clean evidence boundaries, and discovery sends distributed across named managed browser profiles where possible.

## Success criteria

- `output-packages/research/pre-sleep-resonance-breathing-and-meditation` exists and is scoped as a pre-sleep downshift family with explicit starter variants for `resonance-breathing-before-bed` and `silent-meditation-before-bed`, unless the charter justifies splitting them into separate workspaces.
- The charter prompt explicitly separates resonance breathing from generic breathwork, hyperventilation/breath-hold protocols, pranayama/yoga breathing bundles, clinical HRV-biofeedback treatment, and device-specific guided-breathing apps unless the charter gives a concrete evidence reason to merge.
- The charter prompt explicitly separates silent meditation before bed from yoga nidra, guided meditation/audio apps, CBT-I, broad mindfulness-based therapy programs, daytime meditation, sleep-hygiene bundles, and religious/spiritual programs unless the charter gives a concrete evidence reason to merge.
- `01-charter` is sent through a named managed research lane and records `state/chat-urls/01-charter.txt`.
- `01-charter` is harvested into `responses/01-charter.md` before later phases proceed.
- If the charter is coherent, `pnpm research:materialize --workspace output-packages/research/pre-sleep-resonance-breathing-and-meditation` generates discovery and later-stage seams.
- Discovery sends use multiple available browser profiles with a measured stagger instead of funneling all seams through one profile.

## Scope

- In scope:
- `output-packages/research/pre-sleep-resonance-breathing-and-meditation/**`
- this execution plan
- the shared coordination-ledger row for this research lane
- Out of scope:
- Editing unrelated Health Commons protocols or generated outputs beyond the source-owned finding additions required to avoid duplicate source pages.
- Collapsing breathwork, meditation, CBT-I, sleep-hygiene, yoga nidra, pranayama, HRV-biofeedback therapy, or app-specific programs into one intervention before evidence review.

## Constraints

- Preserve unrelated dirty work and active research harvests in the shared checkout.
- Use workspace-specific research config and named managed browser lanes.
- Work across available managed browser profiles to share the load, with one active harvest per lane and `--explore-lane` where the workflow supports it.
- Keep claims conservative and source-bound.
- Keep contraindication and burden considerations visible: insomnia severity, anxiety/panic responses, trauma-related reactions to silence or inward focus, respiratory/cardiac symptoms, dizziness, breath-holding/hyperventilation avoidance, pregnancy/frailty where relevant, and when to seek clinical support.
- Keep starter protocols low-burden and realistic before bed; do not turn them into high-effort optimization stacks.
- Do not expose local identifiers, secrets, or personal data in generated files, logs, commits, or handoff.

## Risks and mitigations

1. Risk: the charter collapses resonance breathing, meditation, CBT-I, sleep hygiene, yoga nidra, and guided apps into one vague bedtime routine.
   Mitigation: ask the charter to treat resonance breathing and silent meditation as sibling starter variants under a family only if the evidence map supports shared outcomes and boundaries.
2. Risk: meditation duration variants such as 10, 30, and 60 minutes become arbitrary dose claims without direct bedtime evidence.
   Mitigation: require separate dose/duration evidence mapping and mark unsupported duration precision as uncertain.
3. Risk: breathing protocols drift into breath holds, hyperventilation, or clinical HRV-biofeedback claims.
   Mitigation: bound the starter protocol to gentle paced resonance breathing before bed and keep clinical/device-guided variants separate until reducer review.
4. Risk: browser lanes are already busy with other long-running research seams.
   Mitigation: inspect active research state, send/harvest on named lanes with staggered fanout, and rebalance independent harvests onto idle profiles when supported.

## Tasks

1. Register this plan and ledger row. Done.
2. Initialize the research workspace. Done.
3. Add charter scoping guardrails. Done.
4. Send `01-charter` on a managed browser profile. Done.
5. Harvest `01-charter` when ready. Done.
6. Review charter boundaries and materialize post-charter seams if coherent. Done.
7. Send discovery seams across multiple profiles with a measured stagger. Done.
8. Harvest discovery seams across available profiles. Done.
9. Send and harvest snowball/gap-fill. Done.
10. Send and harvest source-ledger reducer. Done.
11. Verify workspace setup and planning diff hygiene. Done.
12. Generate source-extraction batch seams from the reducer output. Done.
13. Send source-extraction batches across managed browser profiles. Done.
14. Harvest source-extraction batches across available profiles. Done.
15. Validate source-extraction artifacts. Done.
16. Pause before any new sends or later synthesis seams. Done.
17. Generate section-synthesis seams from templates. Done.
18. Send section-synthesis seams split across `phlebas` and `hercules`. Done.
19. Harvest section-synthesis seams. Done.
20. Validate section-claims artifacts. Done.
21. Pause before page builder, QA, or landing reducer. Done.
22. Materialize, send, harvest, and recover the page-builder seam. Done.
23. Run Evidence QA and Safety QA. Done with recovery for stalled Evidence QA.
24. Run final landing reducer. Attempted; remote reducer stalled and was preserved, so landing was recovered locally.
25. Land Health Commons content package with QA blocker fixes. Done.
26. Validate Health Commons generation, R2 dry-run, typecheck, and tests. Done, with repo-wide test failure recorded below.

## Decisions

- Provisional family: `pre-sleep-downshift-practices`.
- Provisional starter protocols: `resonance-breathing-before-bed` and `silent-meditation-before-bed`.
- Working workspace slug: `pre-sleep-resonance-breathing-and-meditation`.

## Current state

- Workspace: `output-packages/research/pre-sleep-resonance-breathing-and-meditation`
- `pnpm research:init` completed with provisional family `pre-sleep-downshift-practices`.
- `prompts/01-charter.md` now includes explicit boundaries for resonance breathing, silent meditation duration variants, adjacent exclusions, safety, and burden.
- `01-charter` was sent on `phlebas` and recorded a ChatGPT thread URL under `state/chat-urls/01-charter.txt`.
- `01-charter` was harvested on `phlebas`.
- Charter decision: `split_variants`. Keep the combined workspace as the research umbrella, but treat `pre-sleep-resonance-breathing` and `pre-sleep-silent-meditation` as the likely runnable sibling protocols; duration-specific meditation forks remain tentative until extraction.
- The harvested response flattened the required JSON blocks as `JSON{...}`; a mechanical response-format normalization inserted the expected newline after each `JSON` label, preserving payload content, and `research:materialize` then passed.
- Post-charter seams were materialized. Discovery has 10 shards: `02` through `11`.
- Discovery sends and harvests `02` through `11` completed across `hercules`, `eragon`, `vonneumann`, `mountain`, and `phlebas`.
- Each discovery shard produced a parsed `source_candidates_v1.json` artifact with 40 records and no missing required artifact.
- A concrete `10-snowball-gap-fill` prompt and send/harvest wrappers were created from the generated template.
- `10-snowball-gap-fill` was sent and harvested on `eragon`.
- A concrete `11-source-ledger-reducer` prompt and send/harvest wrappers were created from the generated template.
- `11-source-ledger-reducer` was sent and harvested on `mountain`.
- The reducer produced `canonical_source_ledger_v1.json` with 308 canonical source records and `source_extraction_batches_v1.json` with 13 extraction batches. Local validation confirmed every extraction batch source key resolves against the canonical ledger, no batch exceeds 40 sources, and the artifact contract has no missing required artifact.
- Concrete source-extraction seams `12-source-extraction-001` through `12-source-extraction-013` were generated from `12-source-extraction-batch.template.md`.
- `workflow.json` now includes artifact contracts for each extraction seam requiring `SOURCE_FINDINGS_V1`, `EVIDENCE_APPRAISALS_V1`, and `ARTIFACT_CANDIDATES_V1`.
- Source-extraction seams `12-source-extraction-001` through `12-source-extraction-013` were sent across `hercules`, `eragon`, `vonneumann`, `mountain`, and `phlebas` with a 60-second stagger; all 13 recorded chat URLs.
- Source-extraction seams `12-source-extraction-001` through `12-source-extraction-013` were harvested. Some seams returned uppercase or batch-qualified artifact filenames; the workspace-local harvest normalizer was made tolerant of exact, case-insensitive, and logical-name-prefixed JSON filenames, then affected seams were reharvested against their existing threads.
- Local extraction validation found all 13 artifact contracts clean, with required `SOURCE_FINDINGS_V1`, `EVIDENCE_APPRAISALS_V1`, and `ARTIFACT_CANDIDATES_V1` JSON artifacts present and parseable for every batch.
- User asked to continue with the whole section synthesis split across `phlebas` and `hercules`.
- Concrete section-synthesis seams `20-section-synthesis-identity-variant-boundaries` through `28-section-synthesis-onboarding-and-test-plan` were generated from templates, with `SECTION_CLAIMS_V1` artifact contracts.
- Section-synthesis seams `20` through `28` were sent split across `phlebas` and `hercules`; all nine recorded chat URLs.
- Section-synthesis seams `20` through `28` were harvested. They returned inline text rather than downloadable JSON files, so `SECTION_CLAIMS_V1` blocks were recovered from the harvested responses into normalized `section_claims_v1.json` files.
- Local section validation found all nine `section_claims_v1.json` files present and parseable, totaling 77 section claims, with no missing artifact-contract entries.
- Page-builder `30-page-builder` completed remotely but its attachment controls were not downloadable from the managed browser. The inline recovery prompt produced protocol, family, and build-report blocks; the artifact manifest block was incomplete, so the package was reconstructed locally from normalized extraction artifacts.
- Recovered page-builder package contents were landed locally into Health Commons content: protocol page, family page, external-only artifact manifest, standalone evidence-appraisal JSONL, `pre-sleep-arousal` biomarker page, and source pages for new pre-sleep downshift source keys.
- Evidence QA first failed with a ChatGPT `Thinking failed` state. A retry on a separate lane stalled for 37 wake checks at a short preface, so the stalled retry was preserved under `recovery/` and a local blocker memo was written to `responses/31-evidence-qa.md`.
- Safety QA completed and blocked landing until safety edits were applied. Its required red-flag gates, stop conditions, 5-10 minute starter dose, optional-not-forced breathing pace wording, grounding meditation anchors, and family-page safety boundary paragraph were applied.
- Final landing reducer was sent on `vonneumann`, but the thread stalled for 20 wake checks at a short acknowledgement. The stalled reducer was preserved under `recovery/`; local landing recovery applied the QA blockers and then used Health Commons generation checks as the reducer acceptance gate.
- Health Commons local generation now passes for the landed package. `pnpm test` remains red on an unrelated `device-syncd` webhook lifecycle assertion.

## Verification

- Commands to run:
  - direct readback of `workflow.json`, `prompts/01-charter.md`, `state/chat-urls/01-charter.txt`, seam state, and harvested charter artifacts as they exist.
  - `git diff --check -- agent-docs/exec-plans/active/2026-04-26-resonance-breathing-meditation-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - privacy/local-identifier scan over the new research workspace, active plan, and coordination ledger.
- Expected outcomes:
  - Charter and materialized seams keep breathing and meditation boundaries explicit.
  - No local identifiers, secrets, or raw personal data appear in generated artifacts.

Results:
- `pnpm research:init --topic "Resonance breathing before bed and silent meditation before bed" --family pre-sleep-downshift-practices --slug pre-sleep-resonance-breathing-and-meditation --out-dir output-packages/research/pre-sleep-resonance-breathing-and-meditation` passed.
- `pnpm research:run --workspace output-packages/research/pre-sleep-resonance-breathing-and-meditation --seam 01-charter --action send --lane phlebas` passed.
- `pnpm research:run --workspace output-packages/research/pre-sleep-resonance-breathing-and-meditation --seam 01-charter --action harvest --lane phlebas` passed.
- First `pnpm research:materialize --workspace output-packages/research/pre-sleep-resonance-breathing-and-meditation` failed on flattened `JSON{...}` charter blocks.
- After mechanical response-format normalization, `pnpm research:materialize --workspace output-packages/research/pre-sleep-resonance-breathing-and-meditation` passed.
- Discovery sends `02` through `11` passed and recorded chat URLs:
  - `02-discovery-direct-presleep-slow-breathing` on `hercules`
  - `03-discovery-resonance-dose-mechanism` on `eragon`
  - `04-discovery-breathing-safety-boundaries` on `vonneumann`
  - `05-discovery-direct-silent-meditation-bedtime` on `mountain`
  - `06-discovery-mindfulness-insomnia-adjacent` on `phlebas`
  - `07-discovery-meditation-duration-dose` on `hercules`
  - `08-discovery-presleep-arousal-mechanisms` on `eragon`
  - `09-discovery-meditation-safety-adverse-events` on `vonneumann`
  - `10-discovery-measurement-wearable-diary` on `mountain`
  - `11-discovery-clinical-guidelines-boundaries` on `phlebas`
- Discovery harvests `02` through `11` passed. Local validation confirmed 10/10 `source_candidates_v1.json` artifacts parse, each with 40 records and no missing required artifact.
- `bash -n output-packages/research/pre-sleep-resonance-breathing-and-meditation/commands/10-snowball-gap-fill.send.sh output-packages/research/pre-sleep-resonance-breathing-and-meditation/commands/10-snowball-gap-fill.harvest.sh` passed.
- `pnpm research:run --workspace output-packages/research/pre-sleep-resonance-breathing-and-meditation --seam 10-snowball-gap-fill --action send --lane eragon` passed.
- `pnpm research:run --workspace output-packages/research/pre-sleep-resonance-breathing-and-meditation --seam 10-snowball-gap-fill --action harvest --lane eragon` passed.
- `bash -n output-packages/research/pre-sleep-resonance-breathing-and-meditation/commands/11-source-ledger-reducer.send.sh output-packages/research/pre-sleep-resonance-breathing-and-meditation/commands/11-source-ledger-reducer.harvest.sh` passed.
- `pnpm research:run --workspace output-packages/research/pre-sleep-resonance-breathing-and-meditation --seam 11-source-ledger-reducer --action send --lane mountain` passed.
- `pnpm research:run --workspace output-packages/research/pre-sleep-resonance-breathing-and-meditation --seam 11-source-ledger-reducer --action harvest --lane mountain` passed.
- Reducer artifact validation passed: 308 canonical source records, 13 extraction batches, maximum batch size 39, no extraction-batch keys missing from the canonical ledger, and no missing required artifacts.
- `git diff --check -- agent-docs/exec-plans/active/2026-04-26-resonance-breathing-meditation-research.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- Privacy/local-identifier redaction pass over the research workspace, active plan, and coordination ledger scanned 272 files, redacted generated path-bearing status/log files, and found zero remaining repo/home-prefix or local-account-token matches.
- `pnpm typecheck` passed.
- `pnpm test` failed in pre-existing/non-research surfaces: `packages/device-syncd/test/service.test.ts` webhook trace claim lifecycle expected `processed` but got `claimed`; `packages/cli/test/cli-typed-agent-inputs-schema.test.ts` still exposes `event upsert` as a legacy command; and the same CLI manifest review test found `event upsert` and `supplement upsert` in the reviewed input-file command surface.
- Generated extraction wrappers passed `bash -n`.
- Source-extraction sends `12-source-extraction-001` through `12-source-extraction-013` passed and recorded chat URLs.
- Source-extraction harvests `12-source-extraction-001` through `12-source-extraction-013` passed after local artifact-filename normalization cleanup.
- Extraction artifact validation passed for 13/13 batches: 351 source findings, 307 evidence appraisals, and parseable artifact-candidate ledgers for every batch, with no missing required artifact-contract entries.
- Final hygiene checks after extraction passed: extraction wrapper `bash -n`, active plan/ledger `git diff --check`, and privacy/local-identifier scan over the research workspace plus active plan/ledger.
- `pnpm typecheck` failed in unrelated hosted-runtime work: `packages/assistant-runtime/src/hosted-runtime.ts` reports duplicate `HostedMailboxImportCheckpointConflictError` identifiers.
- `pnpm test` failed in unrelated device-syncd work: `packages/device-syncd/test/service.test.ts` webhook trace claim lifecycle expected `processed` but received `claimed`.
- Generated section-synthesis wrappers and the workspace-local review-gpt runner passed `bash -n`.
- Section-synthesis sends `20` through `28` passed and recorded chat URLs.
- Section-synthesis harvests `20` through `28` completed; inline response recovery produced normalized `section_claims_v1.json` artifacts for each seam.
- Section artifact validation passed for 9/9 seams with 77 total claims and zero missing required artifact-contract entries.
- Page-builder wrappers and downstream QA/final-reducer wrappers passed shell syntax checks.
- Page-builder package recovery produced required protocol/family/build-report/manifest files, a 307-record evidence-appraisal JSONL, and a ZIP that passed integrity checks.
- Safety QA harvested successfully and returned a blocker verdict; blocker edits were applied to the landed protocol and family pages.
- Evidence QA remote attempts failed/stalled; a local blocker memo was written and used during landing recovery.
- Final landing reducer remote attempt stalled; local landing recovery was completed instead.
- `pnpm --filter @murphai/health-commons generate` passed.
- `pnpm --filter @murphai/health-commons generate:check` passed.
- `pnpm --filter @murphai/health-commons artifacts:r2:dry-run` completed. It reported expected blocked/not-redistributable external artifacts; the pre-sleep manifest uses external-only entries and schedules no new upload.
- `pnpm --filter @murphai/health-commons typecheck` passed.
- `pnpm --filter @murphai/health-commons test` passed: 10 test files, 35 tests.
- `pnpm typecheck` passed.
- `pnpm test` failed in the unrelated `packages/device-syncd/test/service.test.ts` webhook trace claim lifecycle test: expected `processed`, received `claimed`.
- Privacy/local-identifier redaction pass over the research workspace, active plan, coordination ledger, and landed pre-sleep content scanned 1179 text files, changed 14 generated path-bearing files, and found zero remaining local path/account-token matches.
