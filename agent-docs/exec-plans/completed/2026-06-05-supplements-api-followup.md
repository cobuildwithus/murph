Goal:
- Fix post-review issues in the supplements API PR before merge.

Success criteria:
- Hosted runtime receives only the platform-owned hosted web base URL needed for `supplement search-labels`.
- `MURPH_DATA_API_KEY` remains Worker-owned and never enters hosted user/container runtime env.
- Deploy/preflight handling fails early when the Worker data API secret is missing for configured hosted data API usage.
- Focused tests cover the fixed runtime/deploy contracts.
- Changes are verified, committed, and pushed back to the PR branch.

Constraints:
- Keep the architecture minimal: one web route, one DB table, one Worker intercept, no extra service.
- Do not expose secrets or local paths.
- Preserve unrelated active ledger rows and worktree changes.

Plan:
1. Patch Cloudflare hosted runtime platform env projection for hosted web data API base URL.
2. Patch deploy secret/preflight behavior for `MURPH_DATA_API_KEY`.
3. Check Pro review output for additional concrete findings.
4. Run focused verification and required checks.
5. Close this follow-up plan through the normal commit path.

State:
- Pro review request sent in the existing ChatGPT thread using Extended Pro.
- Local deep review already found a hosted web base URL propagation gap and a late-failing optional Worker data API secret.
- Pro/local follow-up fixes are implemented for hosted web base URL propagation, required Worker data API secret metadata, CLI exact id/upc lookup, exact off-market filtering, duplicate UPC ordering, and injected data API redirect handling.
- Live supplements DB schema/import proof is blocked by the configured DB role lacking `CREATE` on schema `public`; the role can connect but cannot create the table/indexes yet.

Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
