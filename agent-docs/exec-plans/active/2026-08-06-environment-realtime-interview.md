# Environment Realtime interview

Status: active
Created: 2026-08-06
Updated: 2026-08-21

## Goal

- Replace the Environment audio-file walkthrough with a live, text-led voice interview that saves clear Habitat facts topic by topic.
- Make missing, automatic-provider failure, continuation, messaging fallback, and report-loading states clear on phone and desktop.

## Success criteria

- The phone layout fits the ordinary visible viewport without page scrolling and shows one current topic with up to four concise details.
- The desktop layout uses the same state owner and keeps the active topic calm, without a second next-topic panel.
- The live transcript remains visible while the member speaks, keeps recent context, and scrolls inside its bounded area instead of disappearing.
- OpenAI Realtime audio streams through WebRTC with an ephemeral credential. No standard provider key reaches the browser.
- Each recognized fact is durably accepted before its full check mark appears. The canonical Habitat report can refresh later without blocking the interview.
- Useful detail beyond a catalog value is saved as a concise note on that exact
  indicator and remains visible in the report. Raw transcript text is not
  retained.
- `Missing` fields are actionable, `Couldn’t check` records a secret-safe provider failure, and `Area` appears in the interview when absent.
- `Chat instead` remains channel-neutral and prepares readable copy for iMessage or Telegram.
- The print report uses a truthful skeleton, then a bounded retry state instead of an indefinite blank panel.
- The user can inspect the local result before any PR, ReviewGPT pass, broad verification, or commit.

## Scope

- In scope: Environment page and design catalog UI, Realtime session admission, bounded topic completion, canonical Habitat persistence, messaging handoff copy, missing/provider-failure states, and print loading recovery.
- Out of scope: spoken Murph audio, phone calls, unrelated voice memos, proactive reminder messages, broad assistant-provider routing changes, PR creation, ReviewGPT, and full acceptance verification before user review.

## Constraints

- Keep health-adjacent audio and transcript data out of logs, durable browser state, and public artifacts.
- Keep OpenAI credentials Worker-owned and use a short-lived browser credential.
- Preserve the existing Habitat write owner and Browser Vault read projection. Do not create a second product-truth store.
- Keep structured values and their concise notes together in the same Habitat
  Markdown record. A later update replaces the affected note instead of
  appending a transcript history.
- Reuse the current messaging channel picker and design system.
- Do not retain the old Environment upload flow as a hidden second architecture.

## Risks and mitigations

1. Risk: Realtime advances after a pause before the member has completed a topic.
   Mitigation: use semantic turn detection and require an explicit high-confidence topic-complete result; keep `Back` available.
2. Risk: a model-generated fact bypasses Habitat validation.
   Mitigation: accept only allowlisted topic fields, bind every write to the authenticated member and session, and persist through the canonical Habitat owner.
3. Risk: a connection drop loses progress.
   Mitigation: checkpoint each completed topic before advancing and reconnect at the first unresolved topic.
4. Risk: transcript growth pushes the active topic off screen.
   Mitigation: keep transcript history in a bounded internal scroll area, follow its latest lines, and cap visible topic details at four. Do not add a next-topic panel.
5. Risk: a visual skeleton hides a real Brave loading failure.
   Mitigation: prove the root cause, add a bounded terminal error state, and keep diagnostic logs metadata-only.
6. Risk: the foreground Environment save path runs unrelated AI, automation, or outbound delivery while the general runtime is paused.
   Mitigation: admit only `environment-interview.completed`, keep account and health-data consent gates authoritative, and require a dedicated security and architecture review before deployment.

## Tasks

1. Trace the existing Environment upload, Habitat write, Browser Vault projection, messaging handoff, provider failure, and print-loading paths.
2. Add the narrow Realtime credential and topic-completion boundaries without exposing provider keys or creating product truth in Web state.
3. Build the shared presenter interview component and render real synthetic states in the design catalog.
4. Update the Environment dashboard, messaging fallback, and print skeleton/recovery.
5. Run only narrow local checks needed for a usable preview, then capture inspected desktop and mobile screenshots.
6. Stop for user review with the worktree and local run instructions. Do not commit or open a PR.

## Decisions

- Use option A now: Realtime replaces Environment file recording; `Chat instead` is the fallback.
- Use `gpt-realtime-2.1` initially for better instruction following and function calling.
- Show prompts as text. Do not generate Murph audio.
- Show one topic at a time. Do not show model questions or a next-topic preview. Keep the member in control with the visible checklist, transcript, and Back/Next controls.
- Save any clear future-topic facts the member says early and advance to the first unresolved topic.
- Keep option B as a documented contingency only: restore the file recorder as a failure fallback if measured Realtime connection, latency, recognition, or topic-transition quality is unacceptable.
- Treat an active Environment answer as a foreground product write. AI usage and automation engagement pauses must not block that write, but inactive access and withdrawn health-data consent must block it.

## Verification

- Pending. Before user review, limit checks to directly touched focused tests or type checks plus local desktop and mobile browser proof.
- Deferred until user acceptance: ReviewGPT, broad diff or acceptance suites, commit, push, and PR checks.
- Before deployment, the specialist review must explicitly verify that the foreground Environment mode cannot run model calls, scheduled automation, outbound messages, or any mailbox action other than the allowlisted Environment fact write.
