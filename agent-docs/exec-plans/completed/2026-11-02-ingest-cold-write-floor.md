# Cold-history write and receipt-replay floor

Status: completed
Base: origin/main `9a1e841715` (includes step 1, `01a25ae130`).

Move the four reviewed core/restore source files from producer `fa4d412bc3`
unchanged: verified materialization, locked reference detachment before append,
materialize-first append/truncate policy, scoped receipt replay, and retryable
cold-store failures that never enter last-known-good receipt-log fallback.
Keep device-sync retention and active-month compression. Candidate discovery
remains absent: this floor does not create cold references.

The new regression publishes an explicit sparse snapshot and two newer durable
receipts through the canonical receipt-log publisher, without replacing the
snapshot: ordinary journal first, historical ingest second. It clears local
roots before restore. Both available/unavailable cases fail on the base (fallback
reported; missing expected rejection), then pass with the moved source. Success
recovers both writes; unavailability preserves receipt-log SHA/size/bytes, clears
local partial replay, and retries successfully when storage returns.

Verification: five-package build/typecheck PASS (runtime-state, core,
hosted-execution, device-syncd, assistant-runtime). Typecheck initially caught
missing metadata fields in the new synthetic references; fixtures corrected.
Core cold-storage/ingests/device-import: 237 tests / 3 files. Device-syncd
service/store: 268 / 2. Assistant device-sync service/runtime, cold-ingests,
runner, idle, restore Codex continuity/memory, entrypoint restore/receipts,
restore preparation and canonical receipt-log: 486 / 11. Total 991 / 16.
Focused restore regression: 2 fail before, 2 pass after (15 skipped).
`pnpm complexity:diff --base origin/main` PASS; no added debt. Source diff:
37 insertions, 10 deletions (net +27). Privacy and whitespace checks PASS.

Deploy this floor fully and drain older runners before enabling externalization.
After sparse snapshots exist, this floor or a descendant is the rollback floor;
step 1 (`01a25ae130`) is unsafe for sparse snapshots with newer append receipts.
The producer follow-up contains only candidate discovery and snapshot/rollover
tests. No new schema, encryption contract, flag, or deploy-plane change.
No push or deployment performed. Existing completed plans remain untouched.
