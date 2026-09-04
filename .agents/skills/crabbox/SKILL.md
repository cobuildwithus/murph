---
name: crabbox
description: Use Murph's Crabbox dispatcher with a dedicated static macOS SSH worker for finite, CPU-heavy completion checks while keeping edits, audits, commits, and environment-bound development local.
license: Apache-2.0
---

# Murph Crabbox verification

Use the canonical Murph commands. Do not replace them with ad-hoc `crabbox run`
commands:

```bash
pnpm test:diff <changed-path ...>
pnpm verify:acceptance
```

Those commands stay local by default. A configured, dedicated, secret-free Mac
may be selected intentionally with `MURPH_VERIFY_EXECUTOR=ssh`. Within the local
path, the root verifier owns profile selection, scheduling, and worker budgets
and reports the selected profile in its `resources` line.

## Environment and sync boundary

- Static SSH runs use explicit non-secret host, user, and port routing plus the
  local SSH key configuration. They do not use a Crabbox coordinator,
  `crabbox login`, a coordinator token, or environment forwarding.
- Never add `--allow-env`, `--env-from-profile`, broad env globs, `.env` files,
  Vercel tokens, provider tokens, model keys, or product credentials.
- The dispatcher launches the local Crabbox CLI with only non-secret host path,
  account, terminal, and XDG config variables. Do not weaken that allowlist to
  accommodate a credential-bearing local environment.
- Provider transport can sync untracked non-ignored paths, so the dispatcher
  never delegates from the mutable checkout. It first rejects the checkout when
  it contains ordinary untracked, intent-to-add, staged-then-changed additions,
  unmerged, or unsupported Git states. Modified tracked files, tracked
  renames/deletions, ignored files, and new files whose current contents are
  fully staged are eligible.
- The dispatcher freezes one Git candidate and derives its base commit,
  captured index, sensitive-path check, and executed tree from that immutable
  object. New paths must match the captured index. It materializes the original
  base as detached `HEAD` with the frozen candidate staged in its index and
  worktree, preserving implicit no-argument `test:diff` scope without requiring
  a source branch. It verifies and logs that tree before running Crabbox. Later
  checkout writes and late untracked files cannot enter the run. Exact cleanup
  removes the local candidate when the provider exits.
- Fully staged new source and modified tracked content leave the host so the
  remote worker verifies the exact candidate change. Never stage private data
  to bypass the Git-state refusal.
- Canonical completion verification does not need Vercel development variables.
  When a separate direct scenario truly requires Vercel development state, set
  `MURPH_VERIFY_REQUIRES_VERCEL_ENV=1` and keep that command local.
- Static SSH uses only validated local routing from `MURPH_VERIFY_SSH_HOST`,
  `MURPH_VERIFY_SSH_USER`, and `MURPH_VERIFY_SSH_PORT`, a dedicated standard
  macOS account with no personal or product credentials, a run-unique opaque
  workspace below `/Users/Shared/murph-crabbox/runs`, and full resync. The local
  artifact lock protects cooperating local producers and candidate capture
  only; it is neither an editor lock nor the remote capacity authority.
- On the Mac, native `lockf` places one kernel-owned lock on a descriptor
  inherited by the verifier. A busy worker fails closed without waiting or
  falling back. The verifier holds that descriptor while it reaps its exact
  child process groups and uses native `caffeinate` to prevent idle sleep for
  that finite lifetime only.
- Before candidate inspection or install, the locked entrypoint proves `tar`
  plus a `zstd` stdin compression/decompression round trip with the production
  snapshot arguments. Crabbox excludes `.git`, so only after readiness passes
  does the entrypoint reconstruct and verify the detached base plus staged
  candidate from bounded generated transport metadata. The entrypoint stamps
  the `static-ssh` verification profile; caller environment values cannot
  select or tune it. It then removes only the validated outer run directory.

## Controls

```bash
# Default: local shared-host execution.
pnpm test:diff <paths>

# Explicit local execution; capable acceptance still uses its bounded composition.
MURPH_VERIFY_EXECUTOR=local pnpm verify:acceptance

# Use the configured static macOS worker and fail rather than falling back.
MURPH_VERIFY_EXECUTOR=ssh \
MURPH_VERIFY_SSH_HOST=verification-worker.local \
MURPH_VERIFY_SSH_USER=verification-worker \
MURPH_VERIFY_SSH_PORT=22 \
pnpm verify:acceptance
```

Static SSH is host-managed and has no provider TTL. Do not run both remote
`test:diff` and remote acceptance on the same exact head: reserve the remote
check for acceptance when acceptance is required, otherwise use the diff lane.
Retry an unchanged head only for a concrete infrastructure failure and record
why.

Crabbox owns the local claim, static SSH command invocation, timing, and exact
cleanup. Preserve the command, result, timing, successful `tar`/`zstd`
readiness, and the `profile=static-ssh` resources line without recording host,
account, or local-path identifiers. Do not add provider-specific worker
overrides; the root verifier remains the sole authority for scheduling and
worker budgets. Audits, parent final review, plan/ledger closure, commits,
pushes, and PR work remain local.
