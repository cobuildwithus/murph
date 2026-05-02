# Final Hosted Crypto Cleanup Patch

## Goal

Land the supplied final hosted crypto cleanup patch without widening beyond the returned intent.

## Scope

- Runtime data-key envelope unwrap semantics and tests.
- Cloudflare browser-vault session key-id wrapping.
- Hosted-web runtime crypto context cache/versioning and Cloudflare automation recipient selection.

## Constraints

- Treat the patch as intent, not overwrite authority.
- Preserve unrelated dirty-tree edits, including generated Next type stubs and other active hosted rows.
- Do not log or fixture secrets, raw health data, local identifiers, or absolute local paths.
- Keep the behavior fail-closed for malformed crypto rows, missing wraps, and stale browser-vault replicas.

## Verification Target

- Focused runtime-state hosted crypto tests.
- Focused apps/web hosted crypto tests.
- Focused apps/cloudflare browser-vault/session tests if available.
- Root typecheck after focused checks unless an unrelated dirty-tree blocker is proven.

## Outcome

- Ported the supplied cleanup patch onto current source manually because the hosted-web domain-root-store hunk was stale.
- Added focused coverage for hosted data-key multi-wrap unwrap and Cloudflare browser-vault session key-id consistency.
- Focused runtime-state, apps/web, and apps/cloudflare tests passed.
- Owner typechecks, root typecheck, and apps/cloudflare verify passed.
- Scoped diff verification reached apps/web verify and remained red only on unrelated hosted-web `study-card` and `sidebar-chat-action` expectations.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
