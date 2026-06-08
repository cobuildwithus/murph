# Bird Dog Exercise Images

## Goal

Add Murph-style instructional image assets for the existing `Bird Dog` exercise catalog row and ensure generated exercise-library artifacts include the new image metadata.

## Scope

- Generate a small Bird Dog instructional carousel with consistent subject, camera angle, annotations, and correct opposite arm/leg positioning.
- Upload the generated images to Cloudflare Images.
- Update the `EX288` CSV `Images` cell.
- Regenerate exercise-library artifacts and add focused runtime coverage for the new image entries.

## Verification

- `pnpm --dir packages/exercise-library verify`
- Read back the generated `EX288` detail item and confirm image step names and HTTPS Cloudflare delivery URLs.

## Notes

- Do not expose local paths, secrets, account IDs, or token values.
- Preserve unrelated working tree changes.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
