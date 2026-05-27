# Wearable Composed Source Health

## Goal

Make multi-provider/all-provider runtime wearable summaries report source health from the recomposed provider dataset instead of reusing single-provider source-health rows.

## Scope

- `packages/query/src/projection/wearable-summary-compose.ts`
- `packages/query/src/projection/wearable-summary-projector.ts`
- `packages/query/src/projection/wearable-summary-store.ts`
- Focused provider-scope wearable projection regression test

## Constraints

- Keep provider-scoped projection rows as the stored primitive.
- Compose multi-provider/all-provider summaries at read time.
- Do not replace recomposed source-health rows with single-provider source-health rows.
- Preserve only diagnostic notes that cannot be recomputed from projected rows.
- Do not expose raw wearable payloads, local paths, secrets, or direct identifiers.

## Verification

- Focused query projection regression for providers with different last dates.
- Package/diff verification required by workflow.
