## Title

Wire Cloudflare run-phase advancement into web-owned `HostedRunLog`.

## Goal

Make hosted Cloudflare runner phase transitions append best-effort redacted `HostedRunLog` entries so operators can debug stuck hosted execution from Postgres-backed `HostedRun` + `HostedRunLog` instead of Durable Object state or Cloudflare logs.

## Scope

- `apps/cloudflare/src/user-runner/runner-wake-processor.ts`
- focused Cloudflare tests or proof scaffolding required for this slice

## Constraints

- Keep `HostedRunLog` writes explicitly non-blocking and best-effort.
- Do not move correctness/recovery truth out of `HostedRun`; logging stays lossy observability only.
- Preserve unrelated dirty-tree edits and overlapping hosted-run / hosted-wake work.
- Avoid broad contract or schema changes unless the existing internal signed log route makes them directly necessary.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-wake-processor.ts apps/cloudflare/test/runner-wake-processor.test.ts`
- planned: `git diff --check`

## Notes

- The internal signed log route already accepts token-optional writes, so this slice keeps `runToken` optional instead of threading it through the broader run-drain flow.
- Use a small callback timeout and swallow/log failures locally so phase writes never block state-store progression.
