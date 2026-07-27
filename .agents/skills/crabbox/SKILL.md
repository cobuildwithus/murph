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

Those commands stay local by default. Use
`MURPH_VERIFY_EXECUTOR=crabbox` only under the decision rule in
`agent-docs/operations/verification-and-runtime.md`: ordinary escalation follows
a 10-minute local admission wait, while a workflow or trusted-entrypoint change
requires one post-landing trust-root proof without that wait. Within the local
path, canonical acceptance intentionally selects the bounded composed profile
on hosts with at least 12 logical CPUs; ordinary commands and smaller hosts keep
their conservative shared-host caps. Every explicit remote check creates a
fresh one-shot Testbox whose hydration route is pinned by the dispatcher.
Reusable lease IDs are rejected because the available lease metadata does not
prove the Blacksmith organization that installed the root-owned trust
entrypoint.

## Environment and sync boundary

- Authenticate once with `blacksmith auth login`. This direct provider does not
  use a Crabbox coordinator, `crabbox login`, or a coordinator token.
- GitHub can dispatch the hydration workflow only after it exists on the default
  branch. The PR that first adds `.github/workflows/crabbox.yml` must finish on
  local verification; after it lands, feature branches can use the remote lane.
- Never add `--allow-env`, `--env-from-profile`, broad env globs, `.env` files,
  Vercel tokens, provider tokens, model keys, or product credentials. Blacksmith
  Testbox deliberately rejects Crabbox environment forwarding.
- The dispatcher launches the local Crabbox and Blacksmith CLIs with only
  non-secret host path, account, terminal, and XDG config variables. Do not
  weaken that allowlist to accommodate a credential-bearing local environment.
- Canonical delegation pins the Blacksmith organization, `main` ref, workflow,
  and hydration job before the Testbox is created and hydrated. Do not warm a
  lease separately or replace those arguments with mutable local profile or
  config routing.
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
- The default-branch workflow installs a root-owned verification entrypoint
  outside the synced workspace before opening the delegated session. That
  trusted copy erases ambient Actions/Blacksmith state before candidate code
  starts; the candidate bootstrap then independently reconstructs deterministic
  test-only values for pnpm and the verifier and fails closed without the
  trusted-entry marker.
- Changes to `.github/workflows/crabbox.yml` or the trusted entrypoint use local
  verification until the exact trust root lands on the default branch. Run a
  post-landing remote proof afterward; do not claim the pre-landing Testbox
  exercised the new boundary.
- Canonical completion verification does not need Vercel development variables.
  When a separate direct scenario truly requires Vercel development state, set
  `MURPH_VERIFY_REQUIRES_VERCEL_ENV=1` and keep that command local.

## Controls

```bash
# Default: local shared-host execution.
pnpm test:diff <paths>

# Explicit local execution; capable acceptance still uses its bounded composition.
MURPH_VERIFY_EXECUTOR=local pnpm verify:acceptance

# Force a fresh one-shot Blacksmith Testbox and fail rather than falling back.
MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance
```

Explicit remote runs request `--stop-after always`, a 10-minute idle timeout,
and a 45-minute maximum lease lifetime. The hydration workflow has a 50-minute
last-resort ceiling. Do not run both remote `test:diff` and remote acceptance on
the same exact head: reserve the one remote check for acceptance when acceptance
is required, otherwise use the diff lane. Retry an unchanged head only for a
concrete infrastructure failure and record why.

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
