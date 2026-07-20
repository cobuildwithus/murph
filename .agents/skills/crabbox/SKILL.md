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
local shared-host path. `MURPH_VERIFY_EXECUTOR=crabbox` explicitly requests a
fresh one-shot Testbox without another target variable.

## Environment and sync boundary

- Authenticate once with `blacksmith auth login`. This direct provider does not
  use a Crabbox coordinator, `crabbox login`, or a coordinator token.
- Never add `--allow-env`, `--env-from-profile`, broad env globs, `.env` files,
  Vercel tokens, provider tokens, model keys, or product credentials. Blacksmith
  Testbox deliberately rejects Crabbox environment forwarding.
- Blacksmith syncs only Git-tracked and untracked non-ignored paths. The
  dispatcher independently inspects that exact managed set and refuses known
  credential, vault, runtime-state, private-document, and local-artifact paths
  before delegation. Matching local paths are also ignored in `.gitignore`.
- The remote bootstrap independently discards its process environment before
  reconstructing deterministic test-only values for pnpm and the verifier.
- Canonical completion verification does not need Vercel development variables.
  When a separate direct scenario truly requires Vercel development state, set
  `MURPH_VERIFY_REQUIRES_VERCEL_ENV=1` and keep that command local.

## Controls

```bash
# Default: remote only for configured Codex; otherwise local.
MURPH_CRABBOX_BLACKSMITH=1 pnpm test:diff <paths>

# Force the existing local shared-host lane.
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
Audits, parent final review, plan/ledger closure, commits, pushes, and PR work
remain local.
