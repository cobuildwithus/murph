Goal (incl. success criteria):
- Remove frontend-heavy and platform-irrelevant production dependencies from the Cloudflare hosted runner bundle.
- Success means the generated runner bundle does not carry hosted-web importers, `next`, hosted-web wallet/auth packages, or non-linux/x64/glibc platform variants, while preserving the hosted runtime and smoke-proof CLI surfaces that are still required.

Constraints/Assumptions:
- Do not touch the unrelated active hosted-runner destroy-timeout files.
- Preserve hosted runner smoke coverage unless a smaller direct proof replaces it.
- Runner app image targets linux/amd64 on a glibc base.
- `@murphai/assistant-runtime` remains the runtime owner; the public `@murphai/murph` package is not the hosted runtime owner.

Key decisions:
- Keep `@murphai/murph` in the full hosted runner bundle because hosted Codex/vault smoke paths still need a CLI surface.
- Use the root lockfile only as a package-resolution seed with workspace importers stripped before pnpm generates the runner artifact lockfile.
- Normalize the installed artifact to the linux/x64/glibc image target after install, because pnpm's hoisted linker can still materialize incompatible optional native packages.

State:
- Active.

Done:
- Read repo routing docs, hosted runtime docs, Cloudflare deploy docs, and current bundle assembly scripts/tests.
- Confirmed generated runner bundle previously installed hosted-web importers, `next`, Privy React auth, wallet SDKs, and non-linux/non-glibc platform packages.
- Patched bundle install to strip workspace importers from the seeded lockfile, assert only the bundle importer remains, pin platform policy to linux/x64/glibc, prune incompatible installed packages, and reject web-only install artifacts.
- Rebuilt `runner:bundle:hosted-local`; artifact is 62 MB and no longer contains hosted-web, Next, Privy React auth, wagmi, WalletConnect, or linux-musl Sharp packages.
- Re-ran `pnpm hosted-local e2e linq-delivery --no-bundle`; 8 passed, 1 skipped.

Now:
- Run final verification and prepare scoped handoff.

Next:
- Close/commit the scoped bundle dependency fix without disturbing unrelated active work.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/scripts/runner-bundle-contract.ts`
- `apps/cloudflare/scripts/runner-bundle/dependency-install.ts`
- `apps/cloudflare/scripts/runner-bundle/workspace-artifacts.ts`
- `apps/cloudflare/scripts/runner-bundle/runtime-shape.ts`
- `apps/cloudflare/test/runner-bundle-*.test.ts`
- `apps/cloudflare/DEPLOY.md`
