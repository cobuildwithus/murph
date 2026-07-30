# Private Image Delivery V2

Status: completed
Updated: 2026-07-30

## Why

PR #1102 correctly identified two concrete failures but expanded into a generic
multi-context outbox ordering protocol with runtime-authored fallback messages.
The replacement must restore the intended image flow without that machinery:
Codex starts detached image generation, acknowledges naturally, remains
responsive to foreground input, and is woken when the image completes.

The observed progress-card failure was narrower. `attach_response_media`
accepted model-relayed vault metadata, while provider entry correctly verified
that metadata against the selected private bytes. A stale descriptor therefore
failed before delivery even though the vault image itself was unchanged.

## Scope

1. At `attach_response_media`, reload every private `vault_image` ref from the
   trusted vault and derive filename, MIME type, SHA-256, and byte length from
   the selected bytes before committing response media.
2. On preparation failure, return a typed tool failure and clear stale response
   media. Do not synthesize user-visible text, force a reply, or add outbox
   ordering state.
3. Preserve and directly verify the existing detached flow: immediate
   model-authored acknowledgement, foreground responsiveness, completion wake,
   and private image delivery. Do not change wake ownership without a failing
   current-main reproduction.
4. Add focused owner-level proof plus one production-shaped hosted proof.

## Invariants

- Private bytes remain in the vault and are reread and verified at provider
  entry.
- The runtime never authors or automatically sends attachment-failure copy.
- Public response media and ordinary vault-file approval behavior are
  unchanged.
- Detached image generation never blocks fresh foreground conversation input.
- No new persisted state, queue, ordering protocol, scheduler, or delivery
  owner is introduced.

## Verification

- Focused assistant-engine private-media tests.
- Existing focused hosted-runtime foreground-wake scenario on current main.
- Hosted-local generated-image delivery proof with intentionally stale relayed
  metadata.
- Assistant-engine and assistant-runtime typechecks.
- Required docs/privacy/drift checks and exact-head GitHub Actions.
- Preliminary completion-specialists ReviewGPT pass, then final ReviewGPT
  concurrently with CI according to the repository workflow.

## Deployment

Runner-only change. If merged, deploy the Cloudflare runner with immediate
container rollout and verify the expected runner source and bundle
fingerprints. No Vercel, Temporal, or database deployment is required.

## Outcome

- Private response-image metadata is now derived from the selected vault bytes
  before response media is committed, while provider entry keeps the existing
  second read-and-verify fence.
- Missing or invalid private media returns a tool failure and clears the media
  batch without adding a forced reply or runtime-authored message.
- The existing detached launch, acknowledgement, foreground priority, and
  completion wake remain unchanged.
- Focused owner tests pass 26/26, all three affected package typechecks pass,
  runner bundle assembly passes, and docs/privacy/diff checks pass.
- The preliminary specialist review found one coverage issue. The hosted proof
  now ends the stale-metadata wake-and-deliver journey before a separate
  saved-image reuse test begins.
- Direct hosted-local retries were blocked before the selected assertion by
  setup and current-main activation timeouts. Exact-head GitHub Actions remains
  the canonical hosted journey proof.
Completed: 2026-07-30
