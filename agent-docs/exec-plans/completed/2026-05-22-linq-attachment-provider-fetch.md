# Hosted Linq Attachment Provider Fetch

## Goal

Fix production hosted Linq image attachment downloads so metadata-only Linq media parts use the hosted provider fetch path and can be stored as raw inbox bytes for multimodal assistant input.

## Evidence

- Production hosted runtime logs show Linq `image/png` attachment downloads reaching metadata lookup with API config and attachment keys present, but ending as `not_downloaded` with metadata HTTP 401/403.
- The multimodal model path already attaches raw image bytes when attachment evidence exists.
- The Linq metadata fetch currently calls `globalThis.fetch`, bypassing the Cloudflare hosted provider fetch wrapper that injects the bound-user and runtime write-fence headers required by provider egress interception.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/events/linq.ts`
- `packages/assistant-runtime/test/hosted-runtime-linq-event.test.ts`

## Verification

- Focused Linq runtime attachment tests.
- Typecheck or scoped repository verification selected from the verification routing doc.
- Required security/privacy and finish review passes for hosted provider egress changes.
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
