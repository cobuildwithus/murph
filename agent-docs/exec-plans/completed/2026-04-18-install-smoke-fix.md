## Goal (incl. success criteria):
- Make the public `install.sh` path succeed end to end when an older `murph` binary is already present on `PATH`.
- Prove the advertised install flow can reach setup and `murph chat` from an isolated temp environment without falling back incorrectly.

## Constraints/Assumptions:
- Scope stays narrow to the public installer and direct regression proof.
- Avoid unrelated hosted web, onboarding, or package-runtime changes.
- Validate against the real hosted installer flow in an isolated temp home.

## Key decisions:
- Treat the stale-binary resolution as the primary blocker.
- Prefer the active npm global prefix binary over an arbitrary existing `murph` on `PATH`.
- Add a repo-tools regression test for the installer rather than relying only on manual repro notes.
- Strip install-time dependency metadata from bundled private workspace package manifests in staged release tarballs so npm does not materialize empty placeholder dependency directories for them.

## State:
- ready_to_close

## Done:
- Reproduced the public install flow in an isolated temp home.
- Confirmed npm install succeeded, but the installer invoked a stale existing `murph` from `PATH`.
- Confirmed the incorrect npm failure forced an unnecessary git fallback.
- Patched `apps/web/public/install.sh` to prefer the active npm global prefix binary before falling back to arbitrary `PATH` resolution.
- Added `scripts/install-script.test.ts` to lock the stale-PATH regression.
- Confirmed the patched installer keeps the npm path in an isolated temp environment with an older `murph` already on `PATH`.
- Confirmed the current published npm package still falls back because the published tarball has a broken bundled dependency shape.
- Patched `scripts/pack-publishables.mjs` so bundled private workspace packages stop advertising their own install-time dependency metadata inside staged tarballs.
- Built a local release tarball, installed it into a fresh temp prefix, completed `murph onboard`, and got a successful one-turn `murph chat` smoke response.
- Ran the installer regression test successfully.

## Now:
- Close out verification notes and commit the scoped installer/package-shape fix.

## Next:
- Publish a follow-up npm release so the hosted installer stops needing the git fallback on current `latest`.

## Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: none for the scoped code changes; the remaining gap is release timing for the fixed tarball.

## Working set (files/ids/commands):
- `apps/web/public/install.sh`
- `scripts/**/*.test.ts`
- `scripts/pack-publishables.mjs`
- Real repro command used via isolated temp `HOME` and `curl https://www.withmurph.ai/install.sh | bash`
- Local tarball proof via `node scripts/pack-publishables.mjs` then `npm install -g /tmp/murph-pack-local/murphai-murph-0.2.13.tgz`
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
