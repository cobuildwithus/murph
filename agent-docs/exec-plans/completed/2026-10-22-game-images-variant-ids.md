# Use provisionable private game image variants

## Outcome and invariant

Use provider-accepted `gameavatar` and `gamephoto` variants consistently in
private image signing and deployment admission. Preserve dimensions, metadata
stripping, five-minute signatures, authorization, and account-wide privacy checks.

## Cause and implementation

Cloudflare rejected the previous hyphenated variant identifier with error 5400.
The existing Worker mapping and deploy preflight both required those identifiers.
Change only their provider IDs, adjacent delivery fixtures, and the live
ARCHITECTURE/DEPLOY owners. No new state, abstraction, migration, or dependency.
Conceptual `avatar` and `photo` client inputs remain unchanged.

## Verification

- 37 Cloudflare tests pass, including actual store signing composed with deploy
  admission. The new regression fails with the original literals and passes with
  the corrected IDs.
- Six Web media tests and 78 hosted-control client tests pass.
- Cloudflare typecheck passes after generating the fresh checkout's Prisma client.
- Complexity guard passes: two changed source files, no functions above 20.
- Documentation drift/gardening, whitespace checks, and final diff/privacy review pass.

## Rollout and completion boundary

Provision both private variants before deploying the corrected Worker. Keep Web
writers held until the compatible Worker is live. No persisted pointer format or
client protocol changes; old encrypted routes remain. Old Workers still signing
the invalid provider IDs cannot deliver new Images content, so convergence must
precede writer activation. The original session owns independent review,
exact-head CI, merge, protected deploy, and runtime convergence proof.
Status: completed
Updated: 2026-10-22
Completed: 2026-10-22
