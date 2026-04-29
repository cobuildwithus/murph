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
12. run evidence QA and safety QA once
13. run final landing reducer

The scaffold currently automates the early phases best. Later phases may still require the agent to materialize concrete prompt files and command wrappers from templates already present in the workspace.

QA policy:

- Run one Evidence QA pass and one Safety QA pass after the page-builder package.
- If QA blocks landing, do not create a second QA pass just to confirm repairs.
- Repair missing or shallow upstream seams when needed, rebuild the package when needed, then send the original QA findings plus the repaired package to the final landing reducer.
- The final landing reducer owns applying QA blocker fixes and producing any remaining punchlist; it should not require post-repair `31b`/`32b` QA seams unless the user explicitly asks for another QA pass.

When a later seam is still template-only:

- replace the `TODO_*` placeholders in the relevant `prompts/*.template.md`
- write the concrete prompt beside it as `prompts/<label>.md`
- create matching `commands/<label>.send.sh` and `commands/<label>.harvest.sh` wrappers using the same `_run-review-gpt.sh send|harvest` contract as discovery seams
- then run `send`, wait, and `harvest` normally

Timing expectations:

- Research runs are allowed to take a long time.
- `RESEARCH_POLL_TIMEOUT` defaults to about 200 minutes and `RESEARCH_TIMEOUT` defaults slightly above that.
- Even the initial charter can legitimately take 60 to 120 minutes.
- Do not rush a thread just because the first assistant turn looks slow or the wake loop stays in `waiting` for a while.
- Treat partial assistant text, a visible stop button, or a `stop-visible`/busy wake status as evidence that the thread may still be working, not as failure by itself.
- Do not kill wake processes, close ChatGPT tabs, split/re-send the same seam, or otherwise abandon an active research thread before the configured timeout just because artifacts have not appeared yet.
- If the user says a seam may take longer than the default budget, extend the wake timeout or leave the remote thread intact and report the state; do not cancel it preemptively.
- Only terminate or replace a research thread early when there is a concrete failure signal, such as the correct browser profile cannot load the conversation, the send clearly failed, the thread has returned a final non-artifact answer, the wake timed out, or the user explicitly asks to stop.
- If a ChatGPT Pro research seam returns almost immediately with a shallow final answer or no required artifact, do not blindly retry the same prompt on the same browser lane. First suspect that the lane/profile may have been shifted onto a faster instant model or otherwise rate-limited. Preserve the original thread URL and logs, then try a different managed browser lane/profile once; if the alternate lane behaves normally, keep the first lane out of heavy research fanout until it cools down or is manually inspected.
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

Research runs should use the workspace-specific config through the Hercules managed browser lane, not the default personal `review:gpt` browser session or any Chrome fallback.

If you need another parallel browser lane, a shared profile bundle under `output-packages/review-gpt-profiles/<name>/` is a valid pattern. The useful pieces are:

- `open-chatgpt.sh` to open ChatGPT in that profile for manual sign-in
- `review-gpt.<name>.config.sh` plus `review-gpt.sh` for direct `review:gpt` use on that lane
- `run-research.sh` to prefix workspace `commands/*.send.sh` or `*.harvest.sh` with the right `RESEARCH_MANAGED_BROWSER_*` overrides

Important current behavior:

- Generated research configs are self-contained. Research workspaces no longer inherit the repo-root `review:gpt` packaging config.
- `config/review-gpt-research.config.sh` points directly at that workspace's `scripts/package-research-context.sh`.
- `config/review-gpt-work-profile.sh` layers browser/profile settings on top of the workspace-specific research config.
- Artifact-producing seams declare their required machine-readable outputs under `workflow.json -> artifactContracts`.
- Murph now expects `@cobuild/review-gpt >= 0.5.76`, whose `thread export` preserves full assistant-turn text instead of clipping long inline replies at 20k characters.
- Generated seam commands are split into `*.send.sh` and `*.harvest.sh`.
- `*.send.sh` should only submit and persist the thread URL.
- `*.harvest.sh` should run `thread wake`, normalize required artifacts, validate them, and recover inline response text only when that seam actually needs a prose file.
- For browser recovery, prefer reusing an existing managed browser window and opening a new tab. Do not open additional managed browser windows just to recover a blank ChatGPT tab or retry a send; use CDP `json/new`, the profile helper's tab-opening path, or a clean existing tab before escalating to a profile restart.
- Do not treat one active wake as a hard reason to stop send fanout. Wakes are the heavier harvest/polling work; sends are usually acceptable while a lane has a wake running as long as the browser profile remains responsive and stays under the default 30 open ChatGPT tab budget per managed browser profile.
- When the user asks to maximize parallelism, keep independent sends moving across every managed lane up to that 30-tab-per-profile budget. Prefer more queued sends over idle capacity, but do not launch duplicate sends for a seam that already has a recorded ChatGPT URL.
- Do not call a browser profile "occupied" merely because another research workflow has active sends or harvests there. Treat occupancy at the tab/conversation level: a profile is still eligible for unrelated new sends if CDP is reachable, ChatGPT is responsive, the open ChatGPT tab count is under budget, and the new seam will not reuse or overwrite another seam's saved conversation URL. Existing cold/red/Finnish/etc. restart work should not block independent early-meal, alcohol, protein, fasting, or other research sends by itself.
- For independent seams, prefer running harvests in parallel across their recorded send lanes. Do not serialize a whole discovery fanout behind one seam unless the user explicitly wants that.
- Harvests stick to the saved `state/seams/<label>.json` lane and `state/chat-urls/<label>.txt` URL. If a requested harvest lane differs from the recorded send lane, rerun without `--lane` so the runner uses the recorded lane.
- Do not bulk-open or bulk-harvest recorded-lane conversations in a different browser profile just because that profile is idle. If the recorded lane cannot load a saved conversation, record the mismatch/blocker and repair that seam intentionally instead of moving it through an ad hoc cross-lane retry path.
- A harvest can be wrong even when it is using the recorded send lane. If a long wake loop starts producing repeated stale `stop-visible` snapshots followed by `Timed out waiting for ChatGPT thread content`, and live CDP targets no longer include the saved conversation URL, stop that watcher and record a lost-target/stale-profile mismatch. Do not keep forcing reloads on a tab that has drifted to the ChatGPT home page or another conversation.
- `pnpm research:run` now fails closed when a sent URL is already recorded by another seam or when a saved harvest URL is not visible in the recorded lane's live CDP targets. Treat that as a state-repair signal: quarantine the stale/cross-owned seam state and re-send the affected seam into a fresh conversation, instead of adding retry environment variables or forcing a cross-lane wake.

## End-To-End Workflow

### 1. Charter

Run:

```bash
pnpm research:init "<topic>"
pnpm research:run --workspace output-packages/research/<workspace> --seam 01-charter --action send --lane hercules
pnpm research:run --workspace output-packages/research/<workspace> --seam 01-charter --action harvest
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

- run `pnpm research:run --workspace output-packages/research/<workspace> --seam <label> --action send --lane hercules`
- wait for the thread to finish
- run `pnpm research:run --workspace output-packages/research/<workspace> --seam <label> --action harvest`

Harvest guidance:

- After the discovery shard sends are out, harvest independent shards in parallel where possible.
- `*.harvest.sh` is the wake/export/download step; it should poll the saved thread URL, export the assistant text snapshot, download any returned attachments, normalize required artifacts, and validate them locally.
- Do not block all remaining discovery harvests on the slowest single thread. If one shard is still cooking, let the other harvests run.
- For any independent phase with many seams, including extraction batches, use an idle-lane work queue for sends, then harvest each saved thread on its recorded send lane. Do not move saved-thread harvests to another profile merely because that profile is idle.
- For a large shard set, batch or parallel harvests are preferred over one-at-a-time polling loops.

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
- `SOURCE_FINDINGS_V1`
- `EVIDENCE_APPRAISALS_V1`
- `ARTIFACT_CANDIDATES_V1`

Before fetching or assigning a new source page, resolve each source through
`packages/health-commons/generated/source-index.json`. Reuse an unambiguous
`identityLookup[].canonicalSourceKey`; stop for explicit canonicalization when
the lookup is ambiguous.

Source findings are owned by the source artifact page via `sourceFindings`.
Protocol-specific appraisal belongs in standalone `evidence_appraisal` records,
not source page frontmatter.

Normalize downloaded outputs under `downloads/<label>/normalized/` if the thread returns multiple copies or mixed naming.

### 7. Section Synthesis

Synthesize from:

- charter
- canonical source ledger
- source-owned extraction findings
- standalone evidence appraisal records
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
- standalone evidence appraisal records
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
- evidence appraisal create/update/skip decisions
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

ChatGPT.com can sometimes answer a Pro research seam with the fast/instant model instead of the intended deep research path. Treat unusually short, generic, missing-artifact, schema-incomplete, or obviously shallow responses as suspect; verify the required artifacts and thread export before accepting them, and recover or rerun the seam when the response does not satisfy its contract.

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

1. keep the Hercules managed browser lane open
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

- Use the workspace-specific managed browser lanes for research. Before launching a new send, consider which named browser profiles already have active tabs and pick a lower-load profile when possible (for example `phlebas`, `hercules`, `vonneumann`, or `eragon`) instead of concentrating every seam in one browser.
- Keep all reasonable lanes busy for independent sends. For harvests, use the lane recorded by the send; start multiple harvests in parallel only when their recorded lanes can support them.
- A live tab for the conversation in one browser lane does not mean another lane can load it. Wrong-profile symptoms should be corrected on the conversation's owning lane, not by repeated reloads or cross-lane retries.
- After a seam is fully harvested and its required artifacts are normalized or its final blocker is recorded, close that seam's ChatGPT tab when it is no longer needed. Periodically prune ordinary `chatgpt.com` tabs that are not active research threads, especially bare `chatgpt.com` pages without a `/c/<conversation-id>` URL, so browser lanes do not accumulate stale tabs.
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
- write protocol frontmatter `summary` for `/experiments` cards as action/outcome/safety copy, not as a repeat of duration, session count, frequency, or dose timing already shown in metadata or protocol fields
- keep internal source keys out of user-facing Health Commons prose; preserve them only in structured source-key fields, ledgers, source pages, evidence appraisals, and manifests
- never put `Source basis:`, `Sources: source_artifact:...`, `Safety basis: source_artifact:...`, or similar internal source-key footnotes inside user-facing protocol, family, or biomarker copy/descriptions
- use readable source-card/study references in prose when attribution is needed
- before landing protocol, family, or biomarker pages, scan Markdown bodies and frontmatter prose fields for raw `source_artifact:*`, `sourceKeys`, or `Source keys:` leaks outside structured metadata
