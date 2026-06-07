Goal (incl. success criteria):
- Add exercise catalog support for multiple public image references so Cloudflare Images URLs can be attached to catalog movements.
- Success means Cat-Cow carries four image links with step labels and alt text in the CLI exercise catalog, without committing image binaries or secrets.

Constraints/Assumptions:
- Use Cloudflare Images for binary image hosting.
- Repo files must not contain local account identifiers, home-directory paths, API tokens, or secret values.
- Use a single `images[]` field; do not keep the old singular `image` field.
- Store image entries directly in the exercise seed CSV to avoid a second source of truth.
- Existing unrelated dirty work must be preserved.

Key decisions:
- Store catalog image entries directly in the exercise seed CSV.
- Keep assistant response media URLs as public HTTPS image URLs with no credentials, query strings, or fragments.

State:
- Verification in progress.

Done:
- Confirmed `packages/exercise-library` exists and currently generates `image: null` for every item.
- Confirmed assistant response media catalog and staging/delivery support already exist.
- Added CSV-backed `images[]` support and removed the singular exercise `image` field.
- Added four Cloudflare Images URLs to Cat-Cow (`ST170` / `stretch-cat-cow`).
- Regenerated exercise catalog artifacts.

Now:
- Finish verification and review.

Next:
- Commit scoped changes if verification/review is acceptable.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/exercise-library/**`
- `packages/operator-config/src/vault-cli-contracts.ts`
- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/cli/test/exercise-command-coverage.test.ts`
- `apps/web/public/assistant-media/README.md`
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
