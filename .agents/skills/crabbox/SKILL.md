---
name: crabbox
description: Use Murph's Crabbox dispatcher with the direct Blacksmith Testbox provider for finite, CPU-heavy completion checks while keeping edits, audits, commits, and environment-bound development local.
license: Apache-2.0
---

# Murph Crabbox verification

Use the canonical Murph commands. Do not replace them with ad-hoc `crabbox run`
or `blacksmith testbox run` commands:

```bash
pnpm test:diff <changed-path ...>
pnpm verify:acceptance
```

For a local Codex parent, those commands automatically use Crabbox's direct
`blacksmith-testbox` provider when `MURPH_CRABBOX_BLACKSMITH=1` or an existing
`MURPH_CRABBOX_LEASE_ID` is configured and both CLIs are available. CI,
non-Codex callers, and unconfigured or unavailable CLIs retain the existing
local shared-host path. Within that path, canonical acceptance intentionally
selects the bounded composed profile on hosts with at least 12 logical CPUs;
ordinary commands and smaller hosts keep their conservative shared-host caps.
`MURPH_VERIFY_EXECUTOR=crabbox` explicitly requests a fresh one-shot Testbox
without another target variable.

## Warm one task lease by default

When a task is likely to need CPU-heavy remote verification and Blacksmith is
already authenticated, start the task's Testbox warmup as soon as the scope is
known so provisioning and hydration can overlap local editing and review:

```bash
crabbox warmup --profile murph-verification --provider blacksmith-testbox
```

Keep the printed Testbox ID or Crabbox slug in the current task context, then
reuse that exact lease for every canonical remote check the task needs:

```bash
MURPH_CRABBOX_LEASE_ID=<testbox-id-or-slug> pnpm test:diff <paths>
MURPH_CRABBOX_LEASE_ID=<testbox-id-or-slug> pnpm verify:acceptance
```

Use one lease per agent/worktree. Never share a lease concurrently across
worktrees because Blacksmith sync mirrors the invoking checkout and can replace
another task's files. Reuse the task lease through final verification, then stop
the exact lease created by this task even if no remote command ultimately ran:

```bash
crabbox stop --provider blacksmith-testbox <testbox-id-or-slug>
```

Only stop a lease whose ownership by the current task is proven. The profile's
idle timeout is fallback cleanup, not the normal task-completion path. Use a
fresh one-shot run only when the user requests independent clean-machine proof,
the existing lease is unusable, or the task has no owned warm lease. Warmup is
lifecycle setup only; verification still runs through the canonical `pnpm`
commands above, never an ad-hoc remote command.

## Environment and sync boundary

- Authenticate once with `blacksmith auth login`. This direct provider does not
  use a Crabbox coordinator, `crabbox login`, or a coordinator token.
- GitHub can dispatch the hydration workflow only after it exists on the default
  branch. The PR that first adds `.github/workflows/crabbox.yml` must finish on
  local verification; after it lands, feature branches can use the remote lane.
- Never add `--allow-env`, `--env-from-profile`, broad env globs, `.env` files,
  Vercel tokens, provider tokens, model keys, or product credentials. Blacksmith
  Testbox deliberately rejects Crabbox environment forwarding.
- Blacksmith can sync Git-tracked and untracked non-ignored paths. The dispatcher
  admits only modified tracked files, tracked renames/deletions, ignored files,
  and new files whose current contents are fully staged. Ordinary untracked,
  intent-to-add, staged-then-changed additions, unmerged, and unsupported Git
  states fail before delegation. It then rejects known credential, vault,
  runtime-state, private-document, and local-artifact paths from the
  cached/tracked set. Matching local paths are also ignored in `.gitignore`.
- Fully staged new source and modified tracked content leave the host so the
  Testbox verifies the exact candidate change. Never stage private data to bypass
  the Git-state refusal.
- The remote bootstrap independently discards its process environment before
  reconstructing deterministic test-only values for pnpm and the verifier.
- Canonical completion verification does not need Vercel development variables.
  When a separate direct scenario truly requires Vercel development state, set
  `MURPH_VERIFY_REQUIRES_VERCEL_ENV=1` and keep that command local.

## Controls

```bash
# Default: remote only for configured Codex; otherwise local.
MURPH_CRABBOX_BLACKSMITH=1 pnpm test:diff <paths>

# Force local execution; capable acceptance still uses its bounded composition.
MURPH_VERIFY_EXECUTOR=local pnpm verify:acceptance

# Force a fresh one-shot Blacksmith Testbox and fail rather than falling back.
MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance

# Reuse an already-warmed Testbox ID or Crabbox slug.
MURPH_CRABBOX_LEASE_ID=<testbox-id-or-slug> pnpm test:diff <paths>
```

Blacksmith owns machine provisioning, workflow hydration, Git-managed sync,
command transport, and idle expiry. Crabbox owns provider selection, the local
claim, command invocation, timing, and cleanup. Preserve the printed Testbox ID,
Crabbox timing summary, and linked Actions run in verification evidence.
On the standard 16-vCPU Testbox, `verify:acceptance` automatically selects the
same bounded composed-parallel profile as a capable local host; confirm the
printed `resources` line rather than adding provider-specific worker overrides.
The sanitized remote bootstrap deliberately leaves `MURPH_VERIFY_STEP_PARALLEL`
unset so the root verifier remains the sole owner of Web-parallel versus
Cloudflare-serial composed app scheduling.
The protected CLI phase uses four CLI workers with one two-worker package peer;
CLI completion releases the two heavy app steps and lets package coverage refill
to five two-worker processes. The scheduled Vitest total stays below the host's
CPU count.
Audits, parent final review, plan/ledger closure, commits, pushes, and PR work
remain local.
