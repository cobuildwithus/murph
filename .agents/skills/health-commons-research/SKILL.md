---
name: health-commons-research
description: Use when running Murph Health Commons protocol research with review:gpt, including protocol scoping, charter-first workspace setup, discovery fanout, snowballing, source-ledger reduction, extraction batches, section synthesis, page building, QA, and thread-wake recovery.
---

# Health Commons Research

Use this skill for Murph protocol-research runs that land Health Commons family/protocol/source/artifact packages.

Default stance:

- Treat `review:gpt` as the execution substrate.
- Treat the research workspace under `output-packages/research/**` as the source of truth.
- Treat normalized downloads and thread exports as more trustworthy than `responses/*.md` when a long run behaves oddly.
- Continue phase by phase until the workflow is finished unless the user explicitly wants a pause.

## Before Starting

1. Scope the intervention correctly.
2. Decide whether the user needs one protocol, a family plus one starter variant, or a family with multiple sibling variants.
3. Prefer a family plus one starter variant when the intervention name is overloaded.

Examples:

- Cold plunge: family `cold-water-immersion`, starter variant `cold-plunge`, keep winter swimming, cold showers, cryotherapy, contrast therapy, and post-exercise-only recovery separate.
- Red light: family `whole-body-photobiomodulation` or similar, starter variant `whole-body-red-and-near-infrared-light-exposure`, keep skin, hair, localized pain, red-light glasses, and infrared-sauna adjacency separate unless extraction later proves they should merge.
- HBOT: split clinical/supervised hyperbaric oxygen from home mild-HBOT immediately.

## Current Tooling Shape

The current repo flow is:

1. `pnpm research:init "<topic>"`
2. run `commands/01-charter.send.sh`
3. when the thread is ready, run `commands/01-charter.harvest.sh`
4. `pnpm research:materialize --workspace <workspace>`
5. run discovery shard `*.send.sh` commands
6. run discovery shard `*.harvest.sh` commands
7. run snowball/gap-fill
8. run source-ledger reducer
9. run extraction batches
10. run section synthesis seams
11. run page builder
12. run evidence QA and safety QA
13. run final landing reducer

The scaffold currently automates the early phases best. Later phases may still require the agent to materialize concrete prompt files and command wrappers from templates already present in the workspace.

Timing expectations:

- Research runs are allowed to take a long time.
- `RESEARCH_POLL_TIMEOUT` defaults to about 200 minutes and `RESEARCH_TIMEOUT` defaults slightly above that.
- Even the initial charter can legitimately take 60 to 120 minutes.
- Do not rush a thread just because the first assistant turn looks slow or the wake loop stays in `waiting` for a while.
- Do not replace the workspace-managed wait with an ad hoc shorter wake such as 30 minutes. If a manual wake is truly needed, match the workspace's long timeout budget or exceed it.

## Workspace Rules

For each research workspace, expect:

- `workflow.json`
- `prompts/`
- `commands/`
- `responses/`
- `downloads/`
- `state/chat-urls/`
- `state/thread-exports/`
- `config/review-gpt-research.config.sh`
- `config/review-gpt-work-profile.sh`
- `scripts/package-research-context.sh`

Research runs should use the workspace-specific config and isolated research browser profile, not the default personal `review:gpt` browser session.

Important current behavior:

- Generated research configs are self-contained. Research workspaces no longer inherit the repo-root `review:gpt` packaging config.
- `config/review-gpt-research.config.sh` points directly at that workspace's `scripts/package-research-context.sh`.
- `config/review-gpt-work-profile.sh` layers browser/profile settings on top of the workspace-specific research config.
- Artifact-producing seams declare their required machine-readable outputs under `workflow.json -> artifactContracts`.
- Murph now expects `@cobuild/review-gpt >= 0.5.76`, whose `thread export` preserves full assistant-turn text instead of clipping long inline replies at 20k characters.
- Generated seam commands are split into `*.send.sh` and `*.harvest.sh`.
- `*.send.sh` should only submit and persist the thread URL.
- `*.harvest.sh` should run `thread wake`, normalize required artifacts, validate them, and recover inline response text only when that seam actually needs a prose file.

## End-To-End Workflow

### 1. Charter

Run:

```bash
pnpm research:init "<topic>"
bash output-packages/research/<workspace>/commands/01-charter.send.sh
bash output-packages/research/<workspace>/commands/01-charter.harvest.sh
```

The charter must define:

- protocol/family identity
- direct protocol boundaries
- adjacent exclusions
- likely variants
- outcome map
- search shards
- section seams
- extraction schema
- initial file plan

Do not continue if the charter still conflates multiple modalities or user intents.

### 2. Materialize

Run:

```bash
pnpm research:materialize --workspace output-packages/research/<workspace>
```

This should generate discovery commands plus later-stage templates.

### 3. Discovery Fanout

Run discovery shard sends one by one or in a measured fanout. For browser stability, stagger starts by at least 20 seconds. For very heavy uploads, 60 seconds is safer.

Discovery completion target:

- `SOURCE_CANDIDATES_V1`
- downloadable file `source_candidates_v1.json`

The current harvest runner reads `workflow.json`, normalizes the returned file into `downloads/<label>/source_candidates_v1.json`, validates the JSON shape, and fails the seam if the file is missing or malformed.

For discovery seams:

- run `commands/<label>.send.sh`
- wait for the thread to finish
- run `commands/<label>.harvest.sh`

Do not leave a long interactive shell attached to the send command. The send path should finish quickly after it records the chat URL.

If a local `responses/*.md` file is weak but the thread finished, recover from the thread export or downloaded artifact instead of immediately rerunning. For discovery seams, prose alone does not count as completion, and `responses/*.md` is optional.

### 4. Snowball / Gap Fill

Run one snowball pass after discovery is locally backfilled.

Purpose:

- catch missing bibliography clusters
- tighten directness labels
- surface missing safety or dose anchors
- identify false merges across adjacent variants

The snowball prompt should start from:

- strongest review or guideline per cluster
- strongest direct primary study where no good review exists
- known gap bullets derived from thin or noisy discovery coverage

### 5. Source-Ledger Reducer

Run one reducer pass after snowball.

Reducer completion targets:

- `CANONICAL_SOURCE_LEDGER_V1`
- `SOURCE_EXTRACTION_BATCHES_V1`
- downloadable files `canonical_source_ledger_v1.json` and `source_extraction_batches_v1.json`

This phase decides the actual corpus and splits it into extraction batches. Do not skip it for overloaded modalities.

The current harvest runner normalizes those files into:

- `downloads/11-source-ledger-reducer/canonical_source_ledger_v1.json`
- `downloads/11-source-ledger-reducer/source_extraction_batches_v1.json`

and fails closed if either file is missing or has the wrong JSON structure.

### 6. Source Extraction Batches

Generate one extraction command per batch and fan them out.

Extraction completion targets per batch:

- source page drafts
- `ATOMIC_FINDINGS_V1`
- `ARTIFACT_CANDIDATES_V1`

Normalize downloaded outputs under `downloads/<label>/normalized/` if the thread returns multiple copies or mixed naming.

### 7. Section Synthesis

Synthesize from:

- charter
- canonical source ledger
- all extraction findings
- source page drafts

Expected section seams usually include:

- dose and implementation
- outcomes and biomarkers
- safety and contraindications
- variant boundaries
- mechanisms
- evidence quality
- user experience

Synthesis completion target:

- `SECTION_CLAIMS_V1`

### 8. Page Builder

Build the landing-ready package:

- family page
- protocol page
- source pages
- artifact manifest
- redirects or disambiguation if needed
- missing biomarker pages only when actually required
- `experimentOnboarding` only if the evidence is strong enough for Murph to run it safely

### 9. QA

Run:

- evidence QA
- safety QA

Use deterministic local checks where possible. Model QA should focus on claim discipline and safety severity; schema/artifact checks should stay local or be folded into the final reducer rather than a separate model seam.

### 10. Final Landing Reducer

The final reducer should consolidate the builder plus QA outputs into the final landing package and explicitly list:

- file manifest
- final page drafts
- source page create/update/skip decisions
- artifact manifest
- non-claims

## Recovery Rules

### Canonical truth order

When a long run behaves strangely, trust outputs in this order:

1. normalized local downloads required by `workflow.json -> artifactContracts`
2. raw downloaded assistant artifacts
3. thread export JSON
4. thread URL visible in ChatGPT
5. local `responses/*.md`

For artifact seams, `responses/*.md` is a convenience log, not the source of truth.

For inline seams such as charter, synthesis, and QA, `responses/*.md` remains the primary recovered prose file.

Use `thread export` for inline-text seams such as charter, snowball, synthesis, QA, or other no-attachment responses. Use `thread download` only when the assistant actually returned attachment controls.

### If a run “failed” after send

This is common. A local wrapper can fail after the thread already exists.

Do this:

1. capture or recover the thread URL
2. run `thread wake --skip-resume`
3. export the thread
4. download artifacts if the assistant returned any
5. backfill local files from recovered outputs

With `@cobuild/review-gpt >= 0.5.76`, a normal `thread export` should be enough to recover long inline charters or reducers without dropping to ad hoc DOM scraping.

### If a shard looks partial locally

Do not rerun immediately if the thread is still obviously thinking.

Instead:

1. keep the isolated Chrome profile open
2. wait for the thread to finish
3. export/download
4. backfill the local response

For artifact seams, also confirm the required normalized files exist under `downloads/<label>/...`. If they do not, treat the seam as incomplete even if the prose response looks plausible.

### If the model says the workspace is missing

Check packaging first.

Research packaging must include:

- current workspace prompts
- prior responses
- downloads
- chat URLs
- thread exports
- curated Health Commons references

Do not let repomix exclude `output-packages/**`.

## Packaging Rules

- The workspace package script is the packaging authority for research runs. The send helper now refuses to start if the active config resolves to some other package script.
- `repo.snapshot.zip` inside the produced bundle is authoritative for staged research workspace files.
- Research packaging must include the active workspace files plus prior responses, downloads, chat URLs, thread exports, and the curated reference pack.
- If bundled download names drift, rely on the normalized local files under `downloads/<label>/...` after wake rather than the attachment label shown in ChatGPT.

## Operational Rules

- Use the workspace-specific isolated browser profile for research.
- Keep launches measured; fast fanout is good, but broken uploads are wasted time.
- Expect long waits. Let the normal wake loop do its job unless there is concrete evidence the run is wedged.
- The workspace command wrappers already carry the intended long wait budget. Prefer those wrappers over manually assembled `thread wake` commands.
- Persist thread URLs immediately.
- Export and download after every meaningful run.
- Backfill local workspace files as soon as recovered outputs exist.
- For discovery and reducer seams, treat required normalized artifacts as the success contract; prose recovery is secondary evidence only.
- Prefer continuing from an existing good thread over spawning duplicates.
- Use `thread wake` rather than long brittle local `--wait` capture as the main completion primitive for heavy runs.
- Avoid manual thread intervention during the expected wait window, including charters that sit active for an hour or two.
- If a detached manual wake becomes necessary because the parent session may die, keep the timeout in the same long-running range as the workspace defaults instead of shrinking it.

## Autonomy Contract

When asked to run protocol research, the agent should normally:

1. choose the right family/variant boundary
2. initialize the workspace
3. run charter
4. materialize
5. run and recover discovery
6. run snowball
7. run reducer
8. run and recover extraction
9. run and recover synthesis
10. run builder, QA, and final reducer
11. report only the real blockers

Do not stop just because a local response file is incomplete if the thread and artifacts are recoverable.

Only ask the user to intervene for:

- ChatGPT login
- ambiguous protocol scoping the repo cannot safely infer
- unrecoverable thread loss
- dependency release/bump decisions outside the current repo

## Practical Command Notes

- Init: `pnpm research:init "<topic>"`
- Materialize: `pnpm research:materialize --workspace <workspace>`
- Normal repo review:gpt: `pnpm review:gpt`
- Research send helpers live under each workspace `commands/`
- Thread export/download/wake primitives come from `cobuild-review-gpt thread ...`

When writing or editing research prompts, keep claims conservative and evidence-led:

- no invented identifiers or sample sizes
- preserve null, mixed, negative, safety, and mismatch findings
- keep adjacent variants separate unless extraction proves a merge
- keep safety language stronger than efficacy where evidence is thin
