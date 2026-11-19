# Save queued member edits together

Status: completed
Created: 2026-11-19
Updated: 2026-11-19

## Goal

Reduce repeated workspace snapshot construction for queued member edits while preserving mutation order and durable per-action outcomes.

## Decisions

- Use the existing single writer and select up to four consecutive ready actions through ordinary admission. A foreground wake can end the batch early.
- Publish independent outcomes concurrently after the shared snapshot. Reuse the checkpointed handled sequence to retire confirmed journals on restore.
- Save the remaining queue normally when a retry or a pinned sequence prevents metadata-only completion. No new durable format or migration is required.

## Verification

- A two-edit reproduction built two archives in default mode and four in blocked system mode before batching.
- End-to-end coverage counts one archive for two edits and two for eight, checks bounded concurrent confirmations, and restores the final edit to the same record.
- Exercise shutdown after snapshot acceptance, restore after receipt publication, lost responses, partial failure with a future retry, and mixed work with a pinned sequence.
Completed: 2026-11-19
