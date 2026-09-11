# Provision the snapshot fixture workspace

## Outcome

Repair the accepted background review finding in #3227: fresh hosted-local members need an empty workspace before the runtime crypto-context request. Keep encrypted object upload and locator creation before checkpoint publication.

## Scope and decisions

- Reuse the existing public Web testkit and idempotent workspace store; pass the scenario Web environment from all twelve callers.
- Keep production auth, key access, snapshot publication, and restore owners unchanged.
- Model an absent workspace in the cryptographic round-trip test and prove provisioning failures stop before key or object access.
- User authorized merge/deploy while ReviewGPT runs in the background and retroactive fixes.

## Verification

- Shared snapshot helper: 6 tests passed, including real encryption/restore, absent-workspace ordering, and provisioning/upload failure boundaries.
- Actual Web crypto route and workspace store: 32 tests passed, retaining the 403 guard and idempotent empty-workspace owner.
- Cloudflare typecheck passed; complexity guard passed with test-only scope; docs drift and diff checks passed.
- Parent reviewed the full diff and all twelve callers. Checkpoint publication remains after successful encrypted upload and locator creation. No production source or configuration changed.
- Exact-head CI and background ReviewGPT will run on the follow-up PR; managed production admission remains the end-to-end release proof.

## Progress

- Confirmed the actual crypto-context route returns 403 without a hosted workspace, while the later checkpoint test seed currently creates it.
- Added the prerequisite at the shared fixture owner and retained the existing post-upload publication order.

Implementation and local proof are complete. Release completion is tracked on the follow-up PR and managed admission runs.
Status: completed
Updated: 2026-09-10
Completed: 2026-09-10
