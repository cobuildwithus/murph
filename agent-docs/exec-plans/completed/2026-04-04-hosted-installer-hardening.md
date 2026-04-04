# 2026-04-04 Hosted Installer Hardening

## Goal

Harden the hosted `install.sh` entrypoint so it works reliably on stock macOS and Linux shells, including macOS system Bash 3.2, while preserving the current install surface and keeping the implementation simple.

## Why

- The current hosted installer fails on stock macOS `/bin/bash` because it uses `local -n`, which is a Bash 4.3+ feature.
- The installer currently overrides an explicit `--git-dir` with a detected checkout in `PWD`, which makes isolated testing and operator intent unreliable.
- The public `curl ... | bash` entrypoint should be resilient across common host defaults instead of assuming a newer shell than the system provides.

## Scope

- `apps/web/public/install.sh`
- Focused regression coverage for the hosted installer under the existing repo test surface
- Coordination updates only; no product-surface expansion

## Constraints

- Preserve the public hosted installer contract and existing supported install flows.
- Do not require a newer shell, Homebrew-installed Bash, or a shell switch just to run the installer.
- Keep the implementation dependency-free and readable for a `curl | bash` entrypoint.
- Preserve unrelated dirty-tree edits and active lanes already in progress.

## Planned Shape

1. Remove Bash 4-only usage from the hosted installer and keep it compatible with macOS system Bash.
2. Make explicit git checkout targets take precedence over autodetected `PWD` checkouts.
3. Add small robustness improvements to downloader/execution helpers where they materially improve install reliability.
4. Add regression tests that execute the installer under `/bin/bash` with isolated temp directories.
5. Run focused installer verification plus repo typecheck.

## Outcome

- `apps/web/public/install.sh` now documents and honors macOS system Bash 3.2 compatibility constraints instead of relying on Bash 4 namerefs.
- Empty forwarded-argument handling is now safe under `set -u`, including the `--no-onboard` path that appends `--format md`.
- Explicit `--git-dir` targets now win over autodetected checkout reuse, and `auto` install mode resolves directly to `git` when an explicit git target was provided.
- The install plan now reports the effective git target and whether it came from explicit configuration or checkout detection.
- Added hosted-web regression coverage that runs the real installer under `/bin/bash` with isolated temp `HOME`, fake git cloning, and stub `setup-host.sh` handoff checks.
- Verification passed: focused installer Vitest, `pnpm --dir apps/web test`, `pnpm --dir apps/web lint` (warnings only), `bash -n apps/web/public/install.sh`, and `pnpm typecheck`.

## Verification

- Focused hosted-web Vitest coverage for the installer regression tests
- `pnpm typecheck`
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
