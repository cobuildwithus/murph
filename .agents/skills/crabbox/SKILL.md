---
name: crabbox
description: Use Murph's Crabbox dispatcher with a dedicated static macOS SSH worker or the direct Blacksmith Testbox provider for finite, CPU-heavy completion checks while keeping edits, audits, commits, and environment-bound development local.
license: Apache-2.0
---

# Murph Crabbox verification

Use the canonical Murph commands. Do not replace them with ad-hoc `crabbox run`
or `blacksmith testbox run` commands:

```bash
pnpm test:diff <changed-path ...>
pnpm verify:acceptance
```

Those commands stay local by default. A configured, dedicated, secret-free Mac
may be selected intentionally with `MURPH_VERIFY_EXECUTOR=ssh`; use
`MURPH_VERIFY_EXECUTOR=crabbox` only under the paid-executor decision rule in
`agent-docs/operations/verification-and-runtime.md`: ordinary escalation follows
a 10-minute local admission wait, while a workflow or trusted-entrypoint change
requires one post-landing trust-root proof without that wait. Within the local
path, canonical acceptance intentionally selects the bounded composed profile
on hosts with at least 12 logical CPUs; ordinary commands and smaller hosts keep
their conservative shared-host caps. Every explicit Blacksmith check creates a
fresh one-shot Testbox whose hydration route is pinned by the dispatcher.
Reusable lease IDs are rejected because the available lease metadata does not
prove the Blacksmith organization that installed the root-owned trust
entrypoint.

## Environment and sync boundary

- Blacksmith runs require one-time `blacksmith auth login`; static SSH runs use
  the configured SSH alias and require no Blacksmith authentication. Neither
  direct provider uses a Crabbox coordinator, `crabbox login`, or a coordinator
  token.
- GitHub can dispatch the hydration workflow only after its configured path
  exists on the default branch. A PR that adds or moves
  `.github/workflows/crabbox-bounded.yml` must finish on local verification;
  after it lands, feature branches can use the remote lane.
- Keep the retired `.github/workflows/crabbox.yml` path absent. That hard cut
  makes pre-cost-control worktrees fail before a paid Blacksmith job can start;
  do not add a compatibility workflow at the old path.
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
- Both remote providers can sync Git-tracked and untracked non-ignored paths.
  The dispatcher admits only modified tracked files, tracked
  renames/deletions, ignored files, and new files whose current contents are
  fully staged. Ordinary untracked, intent-to-add, staged-then-changed
  additions, unmerged, and unsupported Git states fail before delegation. It
  then rejects known credential, vault, runtime-state, private-document, and
  local-artifact paths from the cached/tracked set. Matching local paths are
  also ignored in `.gitignore`.
- After admission, the dispatcher materializes one process-owned, immutable
  Git candidate, verifies its tree, logs that tree id, and runs Crabbox from
  the candidate rather than the editable checkout. Later checkout writes and
  late untracked files cannot enter the run. Exact cleanup removes the
  candidate when the provider exits.
- Fully staged new source and modified tracked content leave the host so the
  Testbox verifies the exact candidate change. Never stage private data to bypass
  the Git-state refusal.
- The default-branch workflow installs a root-owned verification entrypoint
  outside the synced workspace before opening the delegated session. That
  trusted copy erases ambient Actions/Blacksmith state before candidate code
  starts; the candidate bootstrap then independently reconstructs deterministic
  test-only values for pnpm and the verifier and fails closed without the
  trusted-entry marker.
- Changes to `.github/workflows/crabbox-bounded.yml` or the trusted entrypoint
  use local verification until the exact trust root lands on the default branch.
  Run a post-landing remote proof afterward; do not claim the pre-landing
  Testbox exercised the new boundary.
- Canonical completion verification does not need Vercel development variables.
  When a separate direct scenario truly requires Vercel development state, set
  `MURPH_VERIFY_REQUIRES_VERCEL_ENV=1` and keep that command local.
- Static SSH uses only a safe alias from `MURPH_VERIFY_SSH_HOST`, a dedicated
  standard macOS account with no personal or product credentials, a
  per-worktree opaque workspace below `/Users/Shared/murph-crabbox`, full
  resync, and the existing local artifact lock. The lock serializes cooperating
  artifact producers and reuse of that workspace; it is not an editor lock.
  The dispatcher and remote verifier retain ownership through `SIGHUP`, reap
  their exact child process groups, and only then release the lock and
  candidate. Static SSH never forwards an SSH agent or environment allowlist.
  Follow the one-time host setup and doctor command in the verification guide.

## Controls

```bash
# Default: local shared-host execution.
pnpm test:diff <paths>

# Explicit local execution; capable acceptance still uses its bounded composition.
MURPH_VERIFY_EXECUTOR=local pnpm verify:acceptance

# Use the configured free static macOS worker and fail rather than falling back.
MURPH_VERIFY_EXECUTOR=ssh \
MURPH_VERIFY_SSH_HOST=murph-worker \
pnpm verify:acceptance

# Force a fresh one-shot Blacksmith Testbox and fail rather than falling back.
MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance
```

Blacksmith one-shot runs automatically stop every newly acquired Testbox when
the command exits because the dispatcher never requests either keep mode. The
provider receives a 10-minute idle timeout, and the hydration workflow has a
50-minute last-resort ceiling. Static SSH is host-managed and has no provider
TTL. Do not run both remote `test:diff` and remote acceptance on the same exact
head: reserve the one remote check for acceptance when acceptance is required,
otherwise use the diff lane. Retry an unchanged head only for a concrete
infrastructure failure and record why.

Blacksmith owns machine provisioning, workflow hydration, Git-managed sync,
command transport, and idle expiry. Crabbox owns provider selection, the local
claim, command invocation, timing, and one-shot cleanup. Preserve the printed
Testbox ID, Crabbox timing summary, and linked Actions run in Blacksmith
verification evidence. For static SSH, preserve the command, host alias, result,
and timing without recording account or local-path identifiers.
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
