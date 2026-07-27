# Async Image Completion Wake

Status: active
Updated: 2026-07-26

## Why

Hosted image generation currently blocks the assistant tool call until the
provider and upload finish. Murph should start that work, continue the current
conversation, and receive the uploaded image URL as fresh trusted input as soon
as it is ready.

## Contract

- Hosted `generate-image` starts one invocation-local background operation and
  returns immediately.
- Completion is staged as a trusted assistant input bound to the original
  accepted conversation route.
- The existing runtime wake signal interrupts idle checkpointing and runs the
  completion before checkpoint when the invocation remains live.
- If another foreground turn is admitted first, the completion joins the next
  available assistant-input pass instead of mutating an in-flight provider
  request.
- Local/non-hosted image generation remains synchronous.
- In-flight image work is not durable across runner loss. Durability, replay,
  retries, and persisted image-job state are out of scope until product evidence
  requires them.
- No image allowance, reservation, quota, funding, or usage lifecycle is added.
  The async path does not create or depend on an image usage record.

## Smallest architecture

1. Add one narrow hosted launcher port to the assistant execution context.
2. Let the dynamic image tool hand the launcher a provider/upload promise and
   immediately return a truthful started response.
3. Keep completed results in a small invocation-local list.
4. At the existing foreground pass boundary, stage one trusted input copied from
   the original route and notify the existing runtime wake signal.
5. Feed the staged input through the ordinary assistant-input selection and
   delivery path.

## Verification

- Focused engine test: hosted launch returns before the held image provider
  resolves; local behavior remains synchronous.
- Focused runtime test: completion is route-bound, staged once, and selected as
  assistant input.
- Hosted-local E2E: Murph replies while generation is held, accepts intervening
  conversation work, then wakes on completion before the idle checkpoint and
  receives the uploaded image URL.
- Canonical diff tests and acceptance verification.

## Completion

- Run the preliminary completion-specialists ReviewGPT pass.
- Resolve findings, perform the parent final review, push the exact head, and
  run the final ReviewGPT gate concurrently with required CI.
- Open a replacement PR with a source/test/docs/config line breakdown and retire
  the closed PR's worktree once its detached local processes are explicitly
  authorized for termination.
