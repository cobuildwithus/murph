# Automatic approved vault-file delivery

Status: completed
Created: 2026-07-21
Updated: 2026-07-22

## Why

A production approval committed its payload-free
`runtime.pending-effects-reconcile-requested` mailbox wake within one second,
but a dirty warm runtime fetched only the conversation lane. The system wake
then remained pending until a later conversation message arrived. The approval
was consumed and the file was delivered immediately after that message, proving
that authorization and delivery were healthy while the pre-checkpoint wake
admission policy was not.

The approval page currently masks this delay by pre-filling `I approved the
secure request.`. The delivered attachment also carries a redundant `Here it
is: <filename>` text part. Once the causal wake resumes automatically, neither
extra message is needed.

## Goal

- Let an exact pending-effects reconciliation wake resume an approved parked
  delivery during the dirty warm-runtime window without waiting for another
  member message or the ordinary idle checkpoint delay.
- Preserve the checkpoint gate for unrelated system work such as device sync
  and maintenance.
- Return from approval through the bare originating-conversation link.
- Deliver vault-file attachments without a redundant text part.

## Implementation

1. Add a focused warm-runtime regression that starts dirty state, appends a
   system-only pending-effects wake, and proves the causal delivery pass starts
   before the idle checkpoint delay. Keep the existing source-blind/device-sync
   checkpoint-ordering coverage green.
2. Extend pre-checkpoint wake admission only when the already-fetched system
   prefix consists of `runtime.pending-effects-reconcile-requested` items;
   continue to defer mixed or unrelated system prefixes.
3. Store vault-file delivery intents with an empty message and allow Linq
   attachment sends to omit the text part when media is present. Keep text-only
   sends non-empty.
4. Remove the approval confirmation prefill from fresh decisions and approved
   revisits, then update the member-facing protocol documentation.

## Verification

- Focused assistant-runtime warm-wake tests, including the new causal approval
  case and existing system checkpoint-gate cases.
- Assistant-engine vault-file tests and prompt behavior tests.
- Linq provider serialization tests for media-only and text-only sends.
- Web approval page and decision-route tests.
- `pnpm test:diff ...` for the touched source and test paths.
- `pnpm verify:acceptance`.

## Deployment

Web can deploy before Cloudflare: approval returns through the bare link while
the durable wake remains unchanged. Cloudflare should then deploy the runner
change and provider serialization together. During the window, old runners may
still require the idle checkpoint but no approval or authorization invariant is
weakened. Verify one approved vault-file send completes without a foreground
reply after the Cloudflare rollout.
Completed: 2026-07-22
