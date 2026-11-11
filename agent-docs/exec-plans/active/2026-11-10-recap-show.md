# Pair game recap as a show (agentic)

Status: active. ReviewGPT (GPT-6 Pro) wrote this plan on 2026-11-10 from the owner's direction that Murph (or a subagent Murph drives) makes the recap with its existing composable tools and files. It replaces an earlier pipeline plan the owner rejected. The parent agent's amendments below override the plan text.

## Amendments (override the plan)

1. **No compatibility for older iOS builds** (owner: "idc about older ios builds everyone will update on testflight"). Drop the `X-Murph-Recap-Show` capability negotiation and the legacy projection for old clients; the server returns the show presentation to every client and the new iOS build ships with it. Keep tolerant reading of recaps already stored in the database.
2. **The partial asset pipeline was never deployed.** Delete the asset mailbox task, recipe executor, recap-only provider exports and post-save cover polling now; no drain step. Fold PR 11's deletion into this work.
3. **Chat retention is 30 days by default** (owner decision). Raise the existing inbound transcript and mailbox retention from 14 to 30 days in the existing conversation owners; the recap transcript export covers what is retained and reports gaps. No separate recap archive.
4. **Provider use is approved** (owner): permitted player profile and game photos may go to the existing OpenAI image account and bounded lyrics with player names to the existing ElevenLabs account, for all pair games.
5. **Fewer PRs, same order.** murph PR A = plan PRs 01-07 plus the deletions (one branch, one logical commit per plan PR). murph PR B = plan PR 08 (child tool forwarding, the subagent path). murph-ios PR = plan PRs 09 + 10. The parent path must fully work without PR B.
6. **Model:** the recap task runs on GPT-6.1 Sol.
7. **Murph cameo:** the approved character sheet exists at `agent-docs/assets/murph-character-sheet-v1.png` (the plan's ZIP omitted images).
8. **Craft carries over:** the writing guidance proven in the prototype prompt (genre treatment, scene staging rules, setup above and payoff below, whole real photos, zero to two Most likely to cards, song rules, "jokes may exaggerate, facts may not") must reach the agent as clear, well-organized instructions it reads for this task, not as scattered strings.
9. **Rollout:** after deploy and verification, turn the show on for all pair games, then regenerate the three settled pair games through the existing ops regeneration (the owner approved re-texting their chats).

10. **Checkout evidence:** the supplied checkout was on `fable/recap-show-01-contracts`, at the same head as `fable/recap-show`. PR A branches from that head as requested; no base update or other worktree mutation is needed.

11. **Prospective image cost:** current official Flare documentation provides output-token calculation but no guaranteed total input-token ceiling for photo edits. Reference-bearing paid requests fail closed unless `MURPH_RECAP_IMAGE_INPUT_TOKEN_CEILING` supplies a separately verified provider ceiling for the allowed request. Charge all those input tokens at the higher uncached image rate. Synthetic providers can establish their own bounded test ceiling; this is not rollout evidence for a real provider. Text-only images use the UTF-8 prompt-byte bound. Sources: https://developers.openai.com/api/docs/guides/image-generation#calculating-costs and https://developers.openai.com/api/docs/guides/images-vision#calculating-costs .
12. **Provider scope survives game deletion:** add a nullable scope to the existing runtime owner, cleared by trusted turn finalization or invocation turnover. A GameEvent-only scope would disappear with its game FK and permit an unscoped provider request after deletion. The budget and operation receipts remain GameEvents; there is no new scheduler or process owner.
13. **Committed replies:** the canonical committed Murph replies live in the owning room's assistant transcript, not Web mailbox ingress. Export those locally alongside server-paginated player ingress. The existing server quote policy quotes players only and validates against that same canonical ingress. Report any trimmed reply history as a gap.

14. **Plain fallback page ownership:** store two authored text pages and derive the third from the canonical result, so the native show has three pages without duplicating score ownership. Validate the complete three-page plain content through the shared validator. The fallback has no treatment, song, quotes or cards; its locally rendered title cover uses the same private storage and preview capability.
15. **Lore repair checkpoint:** when an older accepted usage stamp is pending, repair it without a model call or chat send, checkpoint the workspace, acknowledge the exact repaired generations, then resume the same existing mailbox item. This avoids accepting another treatment before its predecessor is durably recorded, without a second queue or scheduler.
16. **Native execution configuration:** the pinned Codex RPC uses raw dotted override keys, not quoted TOML key segments. An empty environment list disables execution. The parent recap selects the default local environment and applies the exact task permission profile; other game-host turns keep their existing empty environment list. The live journey exposed both differences from the assumed configuration.

## PR A execution

Outcome: pair players receive one accepted themed recap through one text line and link. Full, sparse, failed-media and retired generations use the existing game authority; groups retain their current path. Proof includes contract fixtures, focused unit/Postgres checks and synthetic live parent journeys. Native visual implementation and child forwarding remain separate work.

Implementation covers plan PRs 01–07 and removes the undeployed recipe executor,
asset mailbox and cover polling. The iOS contract and synthetic decoder fixtures
are frozen for commit 01. PR 08 and native UI are intentionally excluded.

Local synthetic acceptance passed on GPT-6.1 Sol through the sanctioned
`test:assistant:live` runner: the existing production-validator recap journey and
the parent file/preview/revision journey. The latter generated two JPEGs and one
twenty-second MP3 through in-process synthetic providers, previewed two distinct
drafts, and accepted once with one queued text message plus link and zero chat
media. Its PNGs and accepted presentation are under the ignored
`audit-packages/recap-show-live/` directory. These mocks prove orchestration and
real validation/decoding, not production provider cost or artistic quality.

The locally available Codex lacked the required public-live patch. The test lane
used a local build from the existing Dockerfile's checksum-pinned source and
repository patch; no production credentials or provider calls outside the
sanctioned runner were used. Preview now reports field-level draft errors so the
model can repair invalid structure. Malformed retained ingress is reported as a
transcript gap rather than aborting the recap.

Changelog decision: no public entry in PR A. The show producer remains disabled
by default and native presentation ships separately. The rollout owner should
publish the member-facing entry when the native consumer and show flag ship.

Deployment order: schema migrations, compatible Web control/storage consumers,
Worker and runtime producers, then iOS; only then enable
`MURPH_GAME_RECAP_SHOW_ENABLED=true` for pairs. Reference edits additionally need
a verified `MURPH_RECAP_IMAGE_INPUT_TOKEN_CEILING`. The synthetic test ceiling is
not suitable rollout evidence. `MURPH_GAME_RECAP_MEDIA_VISIBLE=false` hides media
and cover previews without deleting readable stories. `MURPH_GAME_RECAP_MEDIA_DIR`
is a local test storage override. The separate authorized rollout regenerates
the three settled pair games after verification; this task performs none of it.

The Worker adds one signed, serial Web admission request before each OpenAI or
ElevenLabs egress request, including an unscoped request. It uses the existing
Web-control timeout (30 seconds by default), has no admission retry and fails
closed. This is required to distinguish a trusted active recap scope from a
missing model-supplied token. Preserve the Web endpoint and nullable runtime-owner
column while any new Worker is deployed, even with show production disabled.
Before release, collect representative control-path latency and complete
base/head provider-input token measurements; local mocked correctness tests do
not provide those measurements.

Completion remains blocked at commit creation: the supplied checkout is rejected
by `scripts/committer` because it bypassed `scripts/create-worktree`; routing
forbids editing local authorization state. No guard bypass, push, PR, deployment,
production access or other-worktree mutation is authorized by this execution.
The owner must resolve checkout authorization before the seven ordered commits
can be created. Required remote CI and final ReviewGPT await a separately
authorized pushed candidate. Product rollout status: Hold pending native consumer,
verified provider input ceiling and those completion gates.

## Plan


Pair recap show: agentic implementation plan

Decision

Murph should make the recap inside its existing hosted Codex runtime, using ordinary files and the existing image and song tools. The existing recap notification owns the work; write_recap remains the canonical submission boundary.

Murph can drive one native subagent to read the material, compose the show, generate media, preview it, and revise it. That requires a small, explicitly scoped change to child tool dispatch: the snapshot supports native child lifecycles and usage accounting, but currently rejects children’s dynamic-tool requests. Until that bridge passes a live conformance test, the parent performs those same tool calls. Both paths use the same tools, files, budget, submission, and recovery behavior.

Remove the separate post-save media-generation pipeline. Generate and inspect the chosen media before accepting the final recap, then let the existing notification/outbox deliver the accepted chat line.

The product remains a pair recap presented as a themed show: a genre, generated scenes featuring the players, optional Murph cameo, a theme song heard only inside the recap, whole real photos, zero to two “Most likely to” cards with one card per page, setup above and payoff below pictures, and the cover as the link preview. The web route remains an app handoff. Group recaps retain their existing behavior.

Evidence scope

This plan is based only on codebase(20261111-042241).zip.

The archive omits agent-docs/exec-plans/active/2026-11-10-recap-show.md, its Amendments, the referenced recap-show contract document, and agent-docs/assets/murph-character-sheet-v1.png. The    documentation index links to the missing documents. Consequently, this plan preserves the requirements enumerated in your request and the useful implementation present in the snapshot; it cannot certify a line-by-line carryover of unseen Amendments.

The snapshot has no Git metadata, so the exact uncommitted diff cannot be identified. It contains substantially more than the described partial PR 01, including the separate media executor and retirement implementation. Keep/adjust/drop decisions below concern the code actually present.

The separate iOS repository was not supplied. Changes to MurphCompanion/Game/GameRecapReel.swift are implementation requirements, subject to inspecting that repository before editing. No repository files were changed, repository programs executed, or external actions taken during this review.

1. Material simplifications, ordered by leverage

P1 — Remove the second owner of recap creation

Seam and evidence. prepareRecapGeneration saves pending asset recipes and publishes game.recap-assets-requested. executeRecapAssets then independently generates images and music, records usage, batches work, recovers uploads, and stamps lore. handleRecapAssets supplies a separate claim/reference/stage/recover/fail protocol. Cover delivery waits on that second process. See   recap-generation.ts,   events/recap-assets.ts, and   recap-asset-task.ts.

Current cost. A creative change crosses the writer, recipe conversion, mailbox protocol, runtime executor, asset state machine, encrypted-envelope updates, and delivery polling. The writer cannot inspect the generated result before its creative decisions become final.

Smallest target. Murph creates local files, previews the draft, and submits selected files through write_recap. Keep authorized storage, immutable uploads, retirement, and acceptance; delete the independently scheduled generator.

Migration risk. Previously deployed consumers or queued asset wakes may exist; the archive cannot establish deployment state. Stop old producers before removing consumers. Drain or terminally resolve existing work if necessary.

Focused validation. A new recap creates no asset-generation wake; only the ordinary media tools call providers; selected media exists before acceptance; retries converge on one accepted recap and one delivery intent.

P1 — Separate making media from sending media in the existing tools

Seam and evidence. Hosted generate_image normally creates chat response media and can launch a conversation continuation. generate_song depends on voice-memo delivery: Telegram defers generation to delivery, while Linq generates and uploads an attachment. The recap executor compensates by calling the underlying providers separately. See   generate-image-tool.ts,   generate-song.ts, and   generate-voice-memo-tool.ts.

Current cost. Two paths own generation and accounting, while the normal tools cannot compose cleanly into a file-based task. The duplication already diverges: the recap executor changes music usage to featureKey: "game-recap-assets", but the music-pricing matcher requires "music-generation". See   usage-allowance.ts, matchHostedAiUsageElevenLabsMusicRecord.

Smallest target. Add a file-output branch to each existing tool, before chat-specific effects. Reuse the same provider primitives and accounting. Associate recap identity separately from the provider’s pricing identity.

Migration risk. Ordinary image attachments and song voice memos must retain their current behavior. File-output availability must not depend on a deliverable chat channel.

Focused validation. File mode produces verified local bytes without response media, attachment uploads, voice-memo descriptors, or conversation continuations. Existing chat-mode tests continue to pass.

P2 — Preserve picture semantics in the compatibility projection

Seam and evidence. Show pages may contain four blocks: kicker, setup, picture, payoff. presentGameRecap currently truncates legacy pages with slice(0, 3), which can discard the payoff. The same function separately interprets pages for the show presentation. See   recap-show.ts, presentGameRecap.

Current cost. A valid authored page can tell a different story on an older client.

Smallest target. Keep one pure interpretation of setup, picture, and payoff. The legacy projection drops the optional kicker when necessary and preserves the essential three blocks. Keep writer, storage, and presentation contracts separate because they carry different authority.

Migration risk. Historical recaps must remain readable, including pending or malformed optional media.

Focused validation. Add four-block-page fixtures proving that old clients receive setup/picture/payoff and no authoring prompts, storage keys, or provider metadata.

2. Runtime owner, subagent support, and context

The existing recap notification owns the task

Keep the current lifecycle:

Game settlement reserves the existing recap lifecycle receipt.

Publication records the permitted-entry witness.

The existing assistant.notification.requested wake starts the recap.

Its game-recap:<gameId> identity, including an explicit regeneration suffix when applicable, remains the dedupe, recovery, budget, and delivery identity.

These owners already exist in   chat-lifecycle.ts and   recap-witness.ts. Do not introduce another mailbox task kind, workflow, process identifier, or recap scheduler.

For trusted pair-show scope, reuse the existing isolated provider-turn execution path. Compose its applicable room capabilities with the bound recap tools. Simply switching profiles is insufficient: today’s recap tool list replaces the normal catalog, and normal gameplay discovery depends on accepted user-input authority that a notification does not have. Do not fabricate such an input.

Groups and other game notifications keep their current restricted profile. The relevant owners are   notification-turn.ts,   planning.ts, and   codex-turn-runner.ts.

What subagents can do today

Native children are supported, including lifecycle tracking, usage attribution, and waiting for them before a workspace checkpoint. However:

The current game-host-turn disables shell and multi-agent capabilities.

handleSubagentThreadMessage rejects all child server requests, including dynamic tools and approvals.

Existing tests intentionally enforce that rejection.

These are implemented restrictions, not prompt configuration gaps. See   assistant-codex.ts, handleSubagentThreadMessage, and   assistant-codex-runtime-events.test.ts.

The smallest tool-capable child change is to reuse the existing dispatcher with inherited authority:

Prove that the child belongs to the active root invocation using the existing child-registration relationship.

Inherit the exact game/event scope, deadline, cancellation signal, and budget.

Forward only tools authorized for that parent task.

Keep unrelated delivery effects and approval handling root-scoped.

Reject foreign, stale, detached, or unregistered children.

Designate one submitter. The parent must not independently submit while its child is submitting.

A real run against the pinned Codex build must prove tool declaration/inheritance and dispatch. If that fails, the parent completes the task using the same tools; do not build a substitute subagent framework.

Filesystem and canonical writes

Give the task ordinary shell, file, and image-viewing capabilities within a scoped working directory. Authoritative input exports and accepted lore markers are read-only to the agent’s shell; the existing trusted lore tool remains their write path. Draft JSON, media candidates, and previews are ordinary writable files.

Use the existing permission-profile machinery to compose these rules. The current unrestricted member workspace profile permits broad writes, while the current game-host profile denies the entire workspace; neither should be selected blindly for this task. See   assistant-permissions.ts.

The task remains in the game chat container. It gains no authority over either player’s separate personal vault or unrelated account actions.

Full transcript requires a retention decision

Today’s recap transcript reader returns at most the latest 100 live inbound messages within the game window. It omits Murph’s replies. Ordinary prompt history is also bounded, and the audit transcript is physically trimmed. Inbound transcript content and mailbox retention are 14 days, while games can last 365 days. See   chat-tool.ts, readGameChatTranscript;   persistence.ts;   projection.ts; and   rules.ts.

Implement a paginated game-window export from the existing conversation owners:

Include authorized player messages and committed Murph replies.

Preserve source identities, sender attribution, timestamps, ordering, and a settlement watermark.

Export to a local chat.jsonl, with a manifest describing coverage and any unavailable history.

Keep the normal prompt compact; the agent searches and reads the full file as needed.

Use the same canonical sources for server quote validation. Agent-edited files and quoted excerpts are not evidence.

For future long games, a full-transcript guarantee requires a bounded game-window retention hold in the existing conversation owners. Extend their retention policy rather than creating a recap archive. Read visibility, pruning, deletion, and quote validation must use that same policy.

Already-deleted messages cannot be recovered. Such games must report incomplete context and use available game records and lore. Do not enable a “full transcript” promise until the retention decision is approved and implemented.

3. Data flow

Step	Owner and operation	Result

Admit	Existing notification handler checks event, room, witness, deadline, and previous acceptance	Trusted recap scope

Read	Bound read_game, conversation export, and game_lore	Game data, transcript files, lore, permitted photo manifest

Compose	Murph parent or its scoped child writes draft JSON	Editable local draft

Generate	Existing generate_image and generate_song in file mode	Local media receipts

Inspect	preview_recap validates and renders pages; agent views PNGs	Corrections before submission

Submit	write_recap validates, freezes selected media hashes, uploads chosen files, and seals	Accepted story, selected media, preview capability

Deliver	Existing notification/outbox uses the accepted server-built line	One chat line and recap link

Finish	Existing checkpoint handling acknowledges lore; existing cleanup retires abandoned uploads	Durable completion without another generator

Local files contain the draft. The server owns acceptance, generation admission, private media access, and retirement. No local manifest is allowed to grant itself those authorities.

4. Tool changes

read_game and reference materialization

Extend the bound recap read to provide a compact manifest for:

Each player’s current permitted profile photo.

Permitted photo entries from this game’s generation witness.

The approved Murph character sheet.

Canonical results, tasks, schedule, entry details, and posted times.

Paths to the authorized transcript and other materialized input files.

Keep raw storage keys and provider credentials host-side. Use opaque reference IDs and trusted content hashes. Materialize reference bytes locally for inspection, but resolve provider inputs through the trusted manifest.

Reuse recapReferencesCurrent and the existing normalization behavior. That checker already validates settled pair membership, consent revocation, blocks, reports, current profile keys, and current entry media. Add the event witness where needed so a current photo is also eligible for this generation. See   recap-asset-access.ts.

Recheck immediately before provider admission and final publication. A missing profile photo may use an eligible photo of that same player from this game; if suitable identity references are unavailable, degrade the scene rather than inventing the player’s appearance.

Package and verify the exact approved character sheet before enabling cameos. Its absence disables the cameo, not the entire recap.

generate_image

Add an explicit file-output option to the existing tool. The host binds the output directory, recap scope, permitted references, generation limits, and deadline.

The file branch must run before:

Detached conversation-generation launch.

Chat response-media conflict handling.

Canonical chat capture/attachment creation.

Conversation-continuation publication.

Reuse generateOpenAiImage, image-byte validation, and normal usage accounting. Return a structured local receipt containing path, hash, MIME type, byte count, dimensions, and stable operation identity.

For recap reference inputs, accept only manifest IDs. Arbitrary URLs, local filenames, other-game photos, and unrelated inbox/capture files are rejected. The current generic resolver explicitly describes its path checks as a misreference guard, not a boundary against shell-based copying; it must not be treated as recap authorization. See   image-reference-resolver.ts.

generate_song

Add file output before channel-specific voice-memo behavior.

Reuse generateElevenLabsMusic with the existing hosted provider transport. Generate the actual MP3 during the task; do not return Telegram’s deferred generation descriptor or create a Linq attachment.

Retain the snapshot’s 20-second recap song constraint, with original lyrics and generic musical styling. Return path, hash, MIME type, byte count, decoded duration, and operation identity. File-mode discovery must work without VoiceMemoToolRuntime.

Preserve normal song behavior for ordinary conversations. Recap file mode appends no response media and never creates a voice memo or continuation.

preview_recap

Add one local preview tool, backed by a small CLI rendering command.

It should:

Read the draft and selected local media.

Run the shared writer schema and validateGameRecap.

Derive pages through presentGameRecap.

Render per-page PNGs and a contact sheet.

Return validation errors, layout warnings, and file paths for the normal Codex image viewer.

Render the title, setup, picture, payoff, individual superlative cards, song metadata, and canonical result. Real photos use contained, orientation-correct rendering with no crop. Validate audio decoding and duration separately; page images do not prove musical quality.

Reuse installed Sharp and the existing SVG-rasterization pattern in   experiment-progress-card-image.ts. Put shared pure layout/SVG code beside the existing presentation helpers, with thin CLI and Web rasterization adapters. Do not import CLI implementation into assistant-engine or add a browser/player service.

Preview is advisory. Final server validation remains authoritative. Compare preview fixtures with the actual iOS renderer before claiming native visual parity.

write_recap

Keep this public submission tool. Its local wrapper may accept a draft path or structured authoring input plus selected local-file receipts, deriving its JSON schema from the canonical schema.

The wrapper performs:

Authoritative preflight validation.

Local file inspection and hash verification.

Registration of cleanup ownership.

Upload of selected files into the existing immutable recap slots.

Final server validation and canonical acceptance.

Beginning upload freezes the selected slot hashes. Publication retries reuse identical bytes. Text corrections may reuse staged media; replacing bytes at a partially uploaded immutable slot is not permitted.

This keeps candidate images as ordinary local files and avoids a new remote candidate-selection lifecycle.

5. Submission, storage, cover, and lore

Preserve canonical acceptance

Continue through handleGameRecapTool, sealGameRecap, and acceptGameRecapTx.

Keep their signed runtime checks, active-access checks, exact lifecycle receipt, pair/game locking, roster reread, encryption-owner check, current audience, and generation witness. Ordinary first write wins. Explicit regeneration requires its existing request and once-only acceptance marker; the previous recap remains visible until replacement succeeds. See   chat-tool.ts and   service.ts.

The model supplies creative content and selected file receipts. The host derives storage keys, accepted timestamps, generation identity, provenance, preview secrets, and authoritative media metadata.

New submissions contain resolved media or explicit fallback. Preserve readers for historical pending/failed envelopes.

Preserve sealed media and retirement

Reuse putRecapMedia, inspectRecapMedia, and the Cloudflare recap store. Existing checks include bounded JPEGs, bounded MP3s, decoded song duration, integrity hashes, immutable creation, identical-byte retries, and permanent retirement tombstones. See   recap-media.ts and   recap-media-store.ts.

Move registerRecapAssetsTx before upload. Otherwise an agent crash between upload and final acceptance leaves unowned media. Use the existing foreign-key-free HostedRuntimeOrphan receipts and cleanup sweep. Retain only assets selected by the accepted recap; abandoned uploads expire.

Adjust regeneration retirement: today retireGameRecapAssetsTx retires every generation for a game. With uploads moved before acceptance, that would retire the replacement’s own staged files. At replacement, retire only the previously accepted generation and atomically retain the new selection. Deletion and takedown continue to retire all generations. See   recap-retirement.ts.

Serve the composed cover without another asset model

Keep the existing cover-only capability and route. Extend readRecapCoverPreview to render the accepted cover’s title, selected scene-0 image, and kicker using the same pure layout renderer used by local preview.

This requires no extra generated image, upload slot, or preview manifest. After checking token, expiry, generation, source authority, and media hash, the route renders only the cover.

For a plain fallback, retain an accepted envelope containing its text-only first page and preview token; the same renderer can produce its cover while the native payload remains plain.

Keep the existing no-store, no-referrer, noindex, and content-type protections. The capability must not expose other pages, raw source photos, song, transcript, or private API data. See   recap-preview.ts and the   cover route.

Send after acceptance

The final acceptance must establish a renderable cover and selected media before returning the accepted chat line and preview URL.

Preserve the notification’s existing accepted-line override and text-only policy. The agent’s commentary, generated images, and song cannot become chat output. Replays reuse the accepted capability and frozen delivery identity.

Delete normal cover-delivery polling after old pending generations are drained. The existing owners are   recap-message.ts and assertAssistantGameRecapSaved, resolveAssistantGameRecapPresentation, and textOnlyGameNotification in   notification-turn.ts.

Keep file-native lore stamps

Retain appendRecapUsage, protected accepted-generation markers, pending-pointer repair, and the rule that lore acknowledgment follows a durable checkpoint.

Move acknowledgment from the removed asset executor into the existing notification/checkpoint completion path. A successful write_recap already has an accepted-lore hook, and trusted reads already repair pending usage stamps. Do not leave recap_lore_pending stranded when removing the asset wake. See   game-recap-lore.ts,   dynamic-tools/games.ts, and   recap-lore.ts.

6. Guardrails and costs

Durable admission belongs to the tools and existing provider boundary

Use the existing game/event authority for a small, bounded admission receipt: deadline, attempt identity, image/song counts, reserved cost, and source-reference identities or hashes. GameEvent already holds generation witnesses and pointer receipts; keep its payload structural and keep private words out of it.

Under the existing game lock, reserve the next operation’s conservative maximum cost before provider egress. Parent, child, and resumed attempts share the same budget.

The current withinRecapBudget only checks whether prior spending is below $1.25; it does not check whether prior spending plus the next reservation fits. Replace that logic rather than copying it into the tools.

A tool-only check is insufficient after enabling shell access. The existing Worker injects provider credentials for authorized container requests, including direct image and music calls. It currently has no recap reservation or photo-reference requirement, and its Responses WebSocket is opaque to subsequent image-tool calls. See   runner-egress-intercept.ts.

Extend that existing boundary:

Bind recap scope to trusted invocation/lease state.

Require a one-use reservation tied to provider, model/settings, request digest, and approved reference hashes.

Validate it before upstream dispatch.

Reject unreserved direct/native media calls within recap scope.

Use the inspectable HTTP Responses path for this scope and reject native image-generation requests that bypass the ordinary tool.

Treat missing or omitted scope headers as insufficient; the agent cannot opt out of the host-bound scope.

This is a guard on the existing provider path, not another generator.

Initial limits

These are proposed rollout defaults.

Limit	Policy

Paid images	At most four attempts, including cover and revisions

Published scenes	Preserve two to three; allow four when fewer than three real photos are available

Paid songs	One 20-second attempt

Image concurrency	At most two

Native children	One active recap child; no recursive delegation

Media spending	Hard cap of $1.25 per recap generation, enforced prospectively

Agent attempts	At most two admitted runs for the same event

Generation deadline	Ten minutes from first admission; preserve time for finalization

Provider timeouts	Existing image 240 seconds and music 300 seconds, each shortened by remaining task time

Ambiguous provider result	Attempt and reservation remain consumed; recover bytes if possible

Regeneration	Only the existing explicit regeneration flow allocates a new generation

The provider primitives already disable automatic media retries. Keep that behavior. See   openai-image-generation.ts and   elevenlabs-runtime.ts.

A $0.25 placeholder is not automatically a safe per-image upper bound. Admission must account for allowed reference-image inputs, prompt size, output settings, and the pricing version. If a request cannot be conservatively bounded, reject it.

Cost estimate and its limits

The snapshot accounts for image text input at $5/million tokens, image input at $8/million, image output at $30/million, and music at $0.15/minute. Thus a 20-second song is $0.05 under the snapshot’s accounting. These are repository rates, not independently verified current provider prices. See   usage-allowance.ts.

For planning, assuming $0.10–$0.25 per image:

Composition	Illustrative media cost

Three images and one song	$0.35–$0.80

Four images and one song	$0.45–$1.05

The image range is an explicit planning assumption. Replace it with measured reference-heavy synthetic runs before rollout.

The $1.25 cap covers media, not total Codex reasoning cost. Meter parent and child usage through existing accounting and report it separately. Attempts, elapsed time, and child concurrency bound operational work; they do not establish a hard dollar ceiling for in-flight model tokens. A combined hard dollar cap would require additional token-cost admission and proven provider output bounds, which the snapshot does not provide.

7. Reliability and fallback

The existing system mailbox already persists failed work for retry and successful work for checkpoint recording. Native children are awaited at checkpoint boundaries; they are not durable background processes. See   system-mailbox.ts and   snapshot-bridge.ts.

On every admission or retry:

Check terminal retirement and current authority.

Replay an accepted recap before doing any model or media work.

Recover the existing deadline, reservations, and staged final files.

Re-materialize authorized inputs and resume available local work.

Run only while the existing generation still has time and budget.

Otherwise finish through the plain-fallback path.

Do not reset the clock or budget when a container restarts, a child fails, or Codex produces a new tool-call ID.

Local-file durability

A generated local file is not durable until a workspace checkpoint or upload completes. The existing canonical-write wrapper does not independently snapshot arbitrary files, and snapshotting waits for child quiescence.

For the first implementation, keep candidates local and upload final choices only. If a container loses a paid result before checkpoint/upload, its attempt remains consumed. Another generation is possible only within the remaining cap; otherwise produce the plain fallback.

Keep sensitive input exports and previews in a bounded task directory, clean it on completion and startup recovery, and avoid creating an independent durable transcript copy. Server receipts and canonical sources recover the task even when local creative work is lost.

Plain fallback is a trusted completion mode

Current show validation requires a treatment, at least five pages, and at least two scenes. Omitting those fields cannot produce a valid show. See   recap-validation.ts.

Add a host-selected finish-if-due operation behind the existing recap write authority, called by notification preflight/error recovery. It is not a model-controlled “skip validation” flag.

After deadline, exhausted attempts/budget, or disabled generation:

Replay any accepted result.

Reread current authorized game material.

Build a deterministic three-page plain recap from canonical facts and result.

Omit generated scenes, treatment, song, quotes, and optional cards.

Validate through the same shared validator using the trusted plain policy.

Seal through the same acceptance transaction.

Return the saved line to the existing notification/outbox.

Generation failure can lead to a plain recap. Revoked or retired authority must end without saving or sending. Storage outages retain the existing durable retry; they do not authorize delivery before save. Completion resumes when the existing runtime/service is available.

8. Privacy and deletion

Preserve current game audience, witness, block/report, consent, and source-key checks at input access, provider admission, submission, private asset reads, cover reads, and dispatch.

Only permitted player photos and the approved character sheet may reach the image provider. Song prompts contain the minimum approved creative material, not the full transcript. Transcript text, captions, provider responses, and media bytes stay out of operational logs.

Provider-retention and processing approval remains a release gate. Existing feature flags do not prove account-level approval for sending player likenesses or game-derived lyrics.

Retain immediate logical retirement plus durable physical cleanup. Account deletion must clear the recap, retire staged and accepted assets, cancel further admissions, and preserve cleanup ownership even when the encryption owner changes or disappears. The existing game deletion path already retires recap media before clearing/transferring game state; extend tests to the new pre-accept uploads and task-local copies. See   account-deletion.ts.

The cover capability deliberately allows an unfurler to retrieve the cover. Keep its bounded expiry and revocation checks, while acknowledging that third-party preview caches cannot be retroactively erased by Murph.

9. Partial work and client contract

Present work	Decision

Strict writer, tolerant historical reader, public presentation	Keep. These enforce useful trust boundaries.

Tool JSON schema derived from canonical schema	Keep.

Scene prompts/song recipes as instructions for a later generator	Adjust. Final authoring selects generated files; provider prompts need not remain canonical generation recipes.

Stable show presentation and old-client projection	Keep; fix payoff preservation.

Historical pending/failed media readers	Keep for compatibility. New writes finish with resolved media/fallback.

Pair zero-to-two cards, one per page	Keep.

Group recap/card policy	Keep unchanged.

Posted times with instant, zone, and local offset	Keep.

Sealed media, immutable hashes, retirement, account-deletion cleanup	Keep; register before upload and narrow regeneration retirement.

Cover-only capability	Keep; render the accepted composed cover.

Lore treatment stamps and checkpoint acknowledgment	Keep; move completion out of the asset executor.

Asset-generation mailbox, recipe executor, recap-only provider exports	Drop after cutover.

Post-save cover polling	Drop for new writes; remove after old work drains.

Preserve X-Murph-Recap-Show: 1 as capability negotiation, never authorization. Older clients receive only legacy kinds and fields. The current selector lives in   capability.ts.

In iOS, add decoding and private media loading before visual polish. Keep stable page IDs, independent optional-media fallback, canonical result rendering, whole-photo layout, and one superlative per page. Song playback belongs to the recap lifecycle: stop it on dismissal and other lifecycle exits, with no chat attachment or background voice-memo behavior.

10. Small PR sequence

PR	Owner label	Scope and dependencies	Acceptance checks

01	Codex backend	Keep/adjust partial contracts; selected-file authoring shape; legacy payoff fix; plain fallback compatibility. No producer activation.	Strict writer rejects host authority; historical fixtures decode; old clients retain setup/picture/payoff; groups unchanged.

02	Codex backend	Bound game material, paginated transcript export, reference manifest. Approved retention policy is a prerequisite for full-history support. Depends on 01.	Over-100-message export, Murph replies, settlement watermark, coverage gaps, witness scope, profile/entry authorization.

03	Codex backend	File modes in existing image/song tools; structured receipts; channel-independent song discovery.	No chat media or continuation in file mode; ordinary chat modes unchanged; valid bytes and existing pricing identity.

04	Codex backend	Durable operation reservations, prospective media budget, reference revalidation, scoped provider-egress enforcement. Depends on 02–03.	Concurrent callers cannot overspend; restart cannot reset caps; shell/native image bypass rejected; ambiguous calls remain charged.

05	Codex backend	Local preview command/tool and shared cover renderer. Depends on 01–03.	Whole photos, setup/payoff, one-card pages, overflow warnings, correct cover, no network resource loading.

06	Codex backend	Selected-file upload inside write_recap; pre-upload orphan registration; final seal; regeneration retirement; lore checkpoint hook. Depends on 01–05.	Immutable upload replay; one acceptance; old recap survives rejected replacement; new staged assets survive old-generation retirement.

07	Codex backend	Existing notification uses the agentic parent path; durable deadline/attempt handling and trusted plain fallback. Depends on 02–06.	Same-event recovery, save-before-send, deterministic failure completion, no generation after acceptance, no send after retirement.

08	Codex backend	Narrow current-child dynamic-tool forwarding. Depends on 07. Parent remains capable of completing the task.	Proven ancestry; inherited scope/budget; stale/foreign child denial; native child can generate, preview, and submit in a live synthetic run.

09	Codex iOS plumbing	Inspect separate repo; capability header, decoders, private media fetch, fallback and audio lifecycle. Depends on stable 01 fixtures.	Legacy/full-show/failure fixtures; auth failures; unknown optional media; song stops on exit; no crash or infinite refresh.

10	Opus UI	Implement themed reel in GameRecapReel.swift, using 05 and 09 contracts.	Whole photos, setup/payoff, one card per page, cover composition, accessibility, long names, small screens, native screenshots against preview fixtures.

11	Codex backend	Cutover verification and deletion of obsolete generator/routing/polling code after any drain. Depends on 07 and completed client gates; 08 gates child mode.	No new asset wakes; no live caller of recap-only provider exports; both synthetic journeys pass; kill switches and rollback floor demonstrated.

These PRs add no new package, scheduler, recap worker service, or public web player.

11. Test plan

Unit and contract tests

Extend the existing contract, show-policy, game-tool, image-tool, voice/song, notification, and subagent suites.

Cover:

Shared schema derivation and historical tolerance.

Four-block legacy projection.

Pair versus group policy.

Whole photos, exact quotes, canonical scores, posted times/DST, and treatment reuse.

File output without delivery effects.

Forged references, changed profiles, withdrawn entries, symlink/path substitution, and missing character sheet.

Parent/child scope inheritance and rejection.

Preview layout and audio metadata.

Plain fallback under show-enabled policy.

Saved chat-line exactness and media suppression.

Relevant existing suites include   recap-show.test.ts,   game-recap-show-policy.test.ts, and   assistant-notification-turn-runtime.test.ts.

Postgres and storage tests

Extend the existing late-recap, witness, retirement, and media-store suites with real concurrency:

Two final writers and two simultaneous budget reservations.

Crash after reservation, upload, acceptance, and before outbox recording.

Regeneration while delivery is uncertain.

Deletion/report/block races at reference admission, upload, seal, and dispatch.

Replacement retirement excluding its new staged assets.

Orphan expiry and late-upload resurrection prevention.

Accepted recap replay without additional provider calls.

Retain the existing proofs in   game-late-recap-postgres.test.ts,   game-recap-witness-postgres.test.ts, and   game-recap-retirement-postgres.test.ts.

Existing synthetic live recap journey

Preserve the real-Codex cases named “pair recap show production validation…” for ordinary play, weekends off, regeneration, and optional cards.

They currently exercise the real agent against the shared validator and a test write handler, asserting accepted-save, queued-line, and lore behavior. They do not prove real media generation, preview, private storage, or the actual acceptance transaction. See   assistant-codex-real-e2e.test.ts.

New live agentic run on synthetic data

Add a separate opt-in journey using synthetic identities, fictional profile/game photos, a transcript exceeding 100 messages, lore, and isolated storage/database fixtures.

Require observed evidence that:

Murph reads early and late transcript material.

The parent or registered child invokes the ordinary media tools in file mode.

The agent renders and opens preview images.

It makes at least one draft correction and previews again.

Only selected files are uploaded.

Actual server validation and acceptance complete.

The cover is available before the one queued chat line.

The song remains private to the recap.

Usage and reservations reconcile without duplicate billing records.

Add fault variants for a lost local output, provider timeout, song failure, expired deadline, and revoked reference. Use queue-only or test transport for chat effects. Record measured latency and parent/child/media cost. Inspect native screenshots and listen to the synthetic song before rollout.

12. Rollout, kill switches, and owner decisions

Deploy compatible readers, media controls, and runtime consumers with show production disabled. Deploy iOS plumbing before enabling the show payload. Run local/Postgres tests, both synthetic live journeys, and native visual/audio acceptance. Then enable a narrow cohort using the existing game access controls.

Reuse:

MURPH_GAME_RECAP_SHOW_ENABLED for new generation admission.

MURPH_GAME_RECAP_MEDIA_VISIBLE for private media and cover visibility.

Turning generation off must stop new paid admissions and allow pending work to finish plainly through the existing notification. Turning visibility off must fail media/cover access closed while preserving a readable plain/legacy presentation. These switches already exist in   access.ts.

If old asset wakes were deployed, disable their producer and drain them before deleting their consumers. Retain compatible readers and cleanup machinery through rollback. Never activate two generation owners for the same event.

Track save latency, fallback rate, provider attempts, duplicate admissions, media cost, parent/child cost, accepted-but-undelivered recaps, pending lore acknowledgments, and abandoned-media cleanup. Logs contain structural diagnostics, not recap content.

Only owner decisions still required

Full-chat retention: May the existing conversation owners retain the game window beyond 14 days, potentially for a 365-day game, until recap completion or a bounded post-settlement deadline? If not, the product must explicitly accept incomplete retained history for older/long games; increasing the query limit cannot satisfy the full-transcript requirement.

Provider privacy approval: Are the actual OpenAI image and ElevenLabs account arrangements approved for permitted player photos and bounded game-derived song content, including applicable retention and processing terms? Keep real-user generation disabled until that evidence exists.

The implementation otherwise has enough direction: use the existing notification, existing media primitives, local files, one canonical submission, and the existing storage and delivery owners.

