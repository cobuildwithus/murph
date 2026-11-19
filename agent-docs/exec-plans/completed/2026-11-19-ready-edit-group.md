# Save the full ready edit group

Status: completed
Created: 2026-11-19
Updated: 2026-11-19

## Goal

Save all consecutive ready edits already queued together while bounding concurrent network requests.

## Decisions

- Use the queue observed at the start of the pass as its boundary. Check foreground priority and revalidate each eligible neighbor under the existing claim lock.
- Keep up to four receipt requests in flight after snapshot acceptance. Leave later arrivals and other work to the next pass.

## Verification

- The eight-edit regression built two snapshots under the previous limit. Both runner modes now require one snapshot for that group, with a peak of four concurrent confirmations.
- Recheck interruption, replay, partial failure, unrelated work, foreground priority and the runtime typecheck.
Completed: 2026-11-19
