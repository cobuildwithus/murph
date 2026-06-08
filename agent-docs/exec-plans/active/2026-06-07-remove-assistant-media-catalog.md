# Remove assistant media catalog lookup

## Goal

Remove the hosted assistant media catalog lookup/config surface so assistants do not try to search an empty/public media catalog during local `pnpm dev`.

Success criteria:

- `vault-cli assistant media list` is no longer a command.
- `MURPH_ASSISTANT_MEDIA_CATALOG_URL` and product-base fallback plumbing are removed from assistant CLI env projection.
- Direct response-media attachment by known public URL remains supported.
- Focused CLI/assistant-engine verification passes.

## Scope

- In: assistant media catalog command, catalog fetch helper/tests, empty web public catalog files, generated CLI command metadata.
- Out: exercise catalog data, Cat-Cow image URLs, `attach_response_media` dynamic tool, outbound media delivery.

## Constraints

- Preserve unrelated active work and ledger rows.
- Avoid new abstraction; delete the unused catalog surface.
- Do not expose local identifiers or secrets in generated files, logs, docs, or commits.

## Plan

1. Remove catalog-list helper and command wiring.
2. Remove catalog URL env forwarding and static empty catalog files.
3. Regenerate/update CLI command metadata.
4. Run focused tests/typecheck.
5. Run required completion review and commit through `scripts/finish-task`.
