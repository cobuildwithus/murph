# Non-blocking hosted image generation

Status: active
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Keep Murph conversationally available while a requested hosted image is generated.
- Prevent image work from starting unless Web-owned allowance has enough unreserved capacity for the estimated image cost.
- Let a completed image wake an ordinary Murph turn so Murph—not the background operation—chooses the reply, reaction, media batch, or no-reply outcome.
- Reuse the existing runtime, pending-input, response-media, and usage owners without adding another queue, scheduler, or service.

## Success criteria

- A hosted image request receives an immediate truthful admission-pending tool result, so the current Murph turn can acknowledge the check or finish before the slow provider call and upload.
- New conversation messages can reach the model while the image operation runs.
- Image completion or failure becomes a trusted input on the exact originating conversation and wakes a normal Murph turn.
- Completion never sends an exact or automatic message. Murph may use `murph.attach_response_media` and compose any ordinary reply allowed in that turn.
- A deterministic replay cannot start the same image operation twice. Distinct tool calls in one accepted turn remain distinct operations.
- After the originating turn's usage is durably recorded, Web atomically admits and reserves estimated image allowance before provider dispatch. Insufficient capacity starts no image call and returns a structured result that routes through the existing hosted-low-usage and group-funding behavior.
- Usage finalization consumes or releases the matching reservation exactly once. Usage-limit notices truthfully distinguish paused new work from already-started work that may still arrive.
- Focused tests and one production-faithful hosted-local scenario prove non-blocking conversation, allowance denial, dispatch idempotency, normal-turn completion, and truthful limit-notice semantics.

## Scope

- In scope: interactive hosted image dynamic-tool execution, invocation-local runtime operation control, Web-owned allowance admission/reservation, image usage finalization, trusted pending-input completion, group low-usage guidance, focused tests, hosted-local proof, and matching durable architecture/runtime docs.
- Out of scope: a generic background-job framework, a new queue or scheduler, non-hosted image behavior, unrelated media tools, image-model selection, pricing changes, frontend UI, and arbitrary cancellation UX.

## Constraints

- Web remains the owner of product, billing, allowance, and reservation truth. It never owns image prompts, references, bytes, provider execution, completion, or delivery.
- The assistant runtime remains the image-operation owner. The existing Murph image adapter continues to resolve references, call GPT Image, save captures, and upload generated media.
- Temporal receives no image operation, prompt, image bytes, reference media, transcript, or secret.
- The foreground conversation stays ahead of image work, maintenance, sync, and checkpoint cleanup.
- Persist only the minimum general allowance-reservation facts needed for atomic admission and settlement. Keep prompt, references, bytes, and completion state invocation-local.
- Keep one source of truth for allowance pricing and one transaction for admission plus reservation.
- Do not depend on the model voluntarily checking usage or voluntarily sending progress.
- Do not use manipulative funding language; reuse the existing hosted-low-usage policy and current Web-authorized group funding facts.
- Preserve current direct/local `generate_image` behavior unless the hosted detached path is explicitly available.

## Risks and mitigations

1. Risk: detaching provider work creates duplicate provider spend after replay.
   Mitigation: derive one reservation and runtime operation id from the accepted input plus tool call, fence provider dispatch in Web, and never redispatch an already-dispatched reservation.
2. Risk: a soft usage check races concurrent model or image work.
   Mitigation: reserve the estimated image cost in the same Web transaction that admits the operation; count active reservations in every gate read and settle only the exact reservation.
3. Risk: background work competes with foreground turns or is lost across a routine checkpoint.
   Mitigation: keep provider I/O as a pure in-memory operation while foreground turns proceed; before snapshot or workspace release, drain ready results through a canonical assistant phase and wait for still-active provider work while continuing to service conversation wakes.
4. Risk: repeated execution of one tool call creates duplicate image spend.
   Mitigation: use accepted-input plus tool-call identity for exact replay while preserving separate legitimate image calls in the same turn.
5. Risk: quota/funding notices contradict already-accepted replies.
   Mitigation: preserve the crossing turn's existing post-checkpoint-before-accounting order and state truthfully that new work is paused while already-started work may still arrive. Strict global ordering across concurrently admitted turns is out of scope because Web does not own their runtime state.
6. Risk: runtime loss after provider dispatch tempts an unsafe automatic retry.
   Mitigation: retain the dispatched reservation through its captured usage period and fail closed. GPT Image has no usable idempotency/status recovery contract, so never retry an ambiguous dispatched call automatically.
7. Risk: completion bypasses Murph and produces a rigid or contextually wrong message.
   Mitigation: stage only a trusted conversation-scoped input containing the validated completion result. The normal Murph turn remains the sole reply and media-composition owner.

## Tasks

1. Map the current blocking image, usage, mailbox/outbox, detached-work, and Temporal paths and select the smallest existing owner seam.
2. Add the general Web-owned allowance reservation and settlement seam; add no persisted image job.
3. Split the current image adapter into preparation, provider, and finalization phases while preserving its synchronous composition.
4. Detach interactive hosted provider generation from the foreground turn and re-enter by staging an existing-format trusted pending input for a normal Murph turn.
5. Add structured insufficient-capacity behavior and integrate the existing hosted-low-usage/group-funding contract.
6. Add focused unit, concurrency, replay, ordering, and hosted-local scenario coverage.
7. Update current architecture/runtime/reliability docs for the new owner and deployment contract.
8. Run canonical verification, direct scenario proof, product review, preliminary specialist review, parent final review, final ReviewGPT with CI, and close the plan through `scripts/finish-task`.

## Initial evidence

- Production on 2026-07-25 showed one image-bound turn occupy the conversation for about four and a half minutes. A later input waited behind it for roughly one and three-quarter minutes before it could reach the model.
- That turn recorded two image-provider calls before usage accounting completed. The allowance block and proactive limit notice then raced an already-staged conversational reply, so the notice arrived first.
- `executeGenerateImageTool` currently awaits the image provider and hosted upload inline before returning media to the model turn.
- Current progress guidance is model-invoked and therefore cannot report while that awaited provider call holds control.

## Decisions

- Treat the failure as head-of-line blocking plus late allowance accounting, not as a provider-latency-only problem.
- Make image admission/reservation server-enforced. Prompt guidance may explain the result but is never the authority to spend.
- Keep the existing Murph-owned image provider adapter. Codex 0.145's native image tool is unavailable to Murph's production API-key provider, omits required controls and usage metadata, saves only locally, and still awaits generation inline.
- Use one image operation per accepted-input and tool-call identity. Distinct requested images remain composable without a revision/workstream manager.
- Keep image operation state invocation-local. Persist only the general allowance reservation because that is the cross-runtime billing invariant.
- On completion, enqueue a trusted input on the originating conversation and wake the normal assistant lane. Never send automatically or prescribe exact response copy/media.
- Reuse the existing hosted-low-usage skill for user-facing funding behavior; no new commercial policy owner.
- Keep scheduled-automation, local, and group-avatar generation on their current synchronous path in this change; the incident and new durable admission path are scoped to interactive hosted `generate_image`.

## Architecture retrospective

The original requirement is one cross-plane invariant: keep Murph responsive
during hosted image generation, reserve enough server-owned allowance before
provider dispatch, and return completion to an ordinary Murph turn without
automatic delivery.

The implementation exceeds the repository's 3,000-line authored-source review
threshold. That shape is explicitly accepted as one indivisible feature rather
than a generic framework:

- Web must atomically own reservation and settlement; a runtime-only change
  would still permit overspend.
- The live runtime must release the foreground turn and retain invocation-local
  provider state; a reservation-only change would preserve the production
  stall.
- Completion must re-enter through trusted pending input and the ordinary
  Murph lane; direct background delivery would violate reply authority.
- The Worker/runtime transport must carry signed reservation state without
  exposing provider credentials.

Splitting those boundaries would ship unsafe partial behavior or require
temporary compatibility machinery. The implementation deliberately adds no
image queue, scheduler, Temporal workflow, persisted image job, replay manager,
or second sender. It persists only the cross-runtime billing claim, keeps image
state invocation-local, reuses existing pending-input/wake/outbox owners, and
leaves unaffected image paths synchronous. Duplicate admission/replay state was
removed and the controller was reduced during implementation. Decision:
continue as one coordinated feature; review remediation must not add another
owner or lifecycle without production-path proof.

## Verification

- Real PostgreSQL reservation concurrency/lifecycle: 4/4 passed after all 122
  migrations applied to a fresh database; schema diff was clean.
- Hosted provider/foreground/upload/fresh-turn interleaving scenario: 1/1
  passed.
- Hosted workspace runner: 113/113 passed.
- Image controller and completion authority: 25/25 passed.
- Assistant Engine full suite: 2,681 passed.
- Assistant Runtime full suite: 1,875 passed.
- Focused Web usage/reservation/status/funding suites: 331/331 passed.
- Web signaling regression after the final test-fixture correction: 28/28
  passed.
- Web verification, production build, Cloudflare verification, workspace
  typechecks, Prisma validation/generation, ESLint, privacy scan, and
  `git diff --check` passed.
- Canonical `pnpm test:diff` and `pnpm verify:acceptance` each reached the same
  unchanged baseline failure in
  `packages/cli/test/release-script-coverage-audit.test.ts`: the test expects a
  sentence absent from the unmodified ReviewGPT prompt on the branch base. The
  task diff does not touch either side of that assertion. Remote acceptance ran
  in one fresh Testbox and otherwise completed the full app/package aggregate.
