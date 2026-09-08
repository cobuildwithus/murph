# Deliver approved effects alongside queued device work

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Outcome and invariants

Approved delivery continuations must run during the dirty foreground window
when their mailbox batch also contains device-sync wakes. Keep mailbox import
ordered, retain background work, and preserve exact approval and delivery owners.

## Architecture

The runtime pre-checkpoint prefetch classifier currently requires an entirely
foreground-safe batch. The existing mixed-prefix test reproduces the resulting
delay. Device-sync import only enqueues an existing system-mailbox record;
execution is separately selected by the foreground-causal phase.

Extend that classifier to admit queue-only device wakes alongside at least one
already-supported foreground continuation. Reuse the same ordered importer and
foreground-causal execution selector. Device-only batches and imports that can
mutate canonical data remain checkpoint-gated. No new queue, state, schema,
dependency, scheduler, selective cursor, or approval authority is needed.

## Product UX: Patch

- Outcome: Approved attachments resume without another conversation message.
- Reaches: Dirty warm runtimes with a mixed device/continuation mailbox batch;
  existing direct-route, approval-generation, denial, expiry, and retry checks remain.
- Proof: Real bridge import and causal execution before idle checkpoint, one
  delivery, queued device work retained, no background/provider-model execution.

## Tasks

1. Add failing mixed-batch delivery proof and preserve unsafe-import gates.
2. Extend the existing classifier and update its protocol contract.
3. Run focused runtime tests, typecheck, complexity guard, and parent review.
4. Add a concise member-facing changelog; finish the scoped change and review.

## Failure and deployment

Existing bounded prefix, import failure, mailbox watermark, and retry behavior
remain authoritative. Older runners retain the delay; newer runners accept the
same persisted shapes. Deploy the runner through the normal Cloudflare release;
no Web or Temporal protocol change or data migration is required.

## Verification

- Baseline: the new mixed-device regression fails before import/delivery at the
  idle checkpoint; the existing active-import and canonical-write cases pass.
- Runtime: full causal-input suite passed (41 tests), then final parameterized
  approval/gate and callback selection passed (29 tests).
- Changelog: production archive rendering passed (9 tests).
- Final runtime and Web typechecks passed.
- Complexity guard passed with unchanged debt and maximum. Existing large
  orchestration functions are unchanged apart from one derived flag read.
- Parent review: ordered import, bounded work, unchanged decoded authority,
  causal-only execution, retained unattempted device item, single delivery,
  and no model/provider-model entry are covered. Product UX: Ready for review.
- Live model proof is not applicable: this continuation performs no model turn
  and changes no prompt, tool availability, or authored reply.
- Independent round-one review passed on f76684246bb37accdadb8997b2761d63f33e709a;
  verified model metadata matches the requested model. No qualifying bugs or
  material Complexity Collapse findings. Initial browser staging failed before
  submission; the alternate configured lane completed the same review round.
- Required CI passed on the reviewed code head (32 successes, three expected skips).
- Parent final review passed. The refreshed base merges without conflicts.
- The final plan-closure commit changes documentation only; source, tests, and
  changelog are identical to the reviewed candidate. No new substantive review
  is needed under the explanatory-docs exemption. Required final-head CI will
  be verified in the PR rather than creating another plan-only closure commit.
- No production mutation performed. Deployment remains a separate step.
Completed: 2026-09-06
