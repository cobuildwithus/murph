# Repair hosted-local admission fixtures

## Outcome and decisions

- Remove the duplicate object-store loopback assertion after canonical R2 validation; retain the Web loopback guard and local/production isolation checks.
- Use the existing authenticated fetch convention for the retired shell-prewarm route's expected 404, preserving the status, JSON and no-active-fence assertions.
- Production runtime, crypto, release admission and stored data contracts are unchanged.

## Evidence

- The Linux MinIO owner explicitly selects and marks its private Docker bridge gateway; the canonical R2 parser already validates that exact host.
- Snapshot helper and R2 presign suites: 36 passing tests, including real crypto/upload/restore through loopback and marked bridge configurations and rejection before I/O for unsafe settings.
- Cloudflare typecheck passed. Scoped complexity check against main `6e9550065cd1260e1edd0f04af9a86d4d42b7857` passed with no authored source changes; all TypeScript edits are test infrastructure.
- Parent reviewed the full diff and actual request helper semantics. Synthetic authenticated 404 request proof passed.
- Full hosted-local checkpoint and priority journeys remain required managed admission evidence. This local proof does not replace them.
Status: completed
Updated: 2026-09-10
Completed: 2026-09-10
