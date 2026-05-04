# Cloudflare Artifact Cache Revert

## Goal

Remove the hosted runner artifact write lease cache added in the recent Cloudflare deploy and restore per-request Durable Object lease checks for artifact `PUT` requests.

Success criteria:

- Artifact `PUT` authorization no longer reuses cached cross-request RPC promises.
- Existing active invocation lease enforcement remains intact.
- Focused Cloudflare tests/typecheck pass.

## Scope

- `apps/cloudflare/src/runner-outbound.ts`
- `apps/cloudflare/test/runner-outbound.test.ts` only if the removed test reset hook is referenced.

## Notes

- Do not change artifact encryption, R2 object layout, or runner outbound authorization semantics beyond removing the cache.
- Production symptom observed before this plan: mailbox append succeeded while Cloudflare runner artifact writes failed with cross-request I/O errors.

## Verification

- Pending: focused Cloudflare verification after patch.
