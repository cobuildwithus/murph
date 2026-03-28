# Profile Snapshot And Event Authoring Typing

## Goal

Replace opaque profile-snapshot blobs with a more explicit typed profile shape for the stable fields core already reuses, while keeping an extension bag for custom data, and add typed authoring helpers for generic event writes without changing the stored event contract.

Success criteria:

- `profileSnapshotSchema` and core profile types expose stable typed sections instead of `Record<string, unknown>` for the whole profile payload.
- profile snapshots still accept additive custom fields through an explicit extension bag rather than by making the entire profile opaque.
- current-profile materialization reads stable fields directly from typed sections instead of fishing them back out of an untyped blob.
- stored events continue to validate against `eventRecordSchema` exactly as before.
- generic event writes gain typed draft/build helpers per supported public event kind so callers do not start from a raw `Record<string, unknown>` payload.

## Scope

- `packages/contracts/src/{zod.ts,examples.ts,schemas.ts}`
- `packages/core/src/{profile/{types,storage}.ts,domains/events.ts,index.ts,public-mutations.ts,assessment/{types,project}.ts}`
- `packages/query/src/{canonical-entities.ts,overview.ts,health/projections.ts}` only if the new typed snapshot shape needs a direct read-side compatibility update
- targeted `packages/core/test/{profile.test.ts,core.test.ts}`
- minimal follow-up exports/usages only where the new types require direct alignment

## Constraints

- Keep the existing storage layout and ledger/document paths unchanged.
- Keep `profileSnapshotSchema` as the stored profile snapshot truth and `eventRecordSchema` as the stored event truth.
- Do not silently drop typed stable fields into the extension bag during authoring.
- Keep generic event upsert focused on the existing public-write event kinds.
- Run the required verification plus mandatory completion-workflow audit passes before handoff.

## Risks

- Overfitting the profile shape to today’s fields and making future extension awkward.
- Introducing typed event builders that drift from the stored event contract instead of validating through it.
- Accidentally widening this into query or CLI cleanup when the requested work is contracts/core focused.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- focused `packages/core` profile and event tests during iteration
- direct scenario checks through profile snapshot append and generic event upsert paths
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
