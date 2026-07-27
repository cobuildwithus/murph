# Static macOS verification worker

Status: review candidate
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Let local agents run Murph's canonical verification commands on a dedicated
  spare Mac through Crabbox's existing static SSH provider, without forwarding
  secrets, sharing one mutable remote checkout across worktrees, or adding a
  coordinator or scheduler.
- Correct the Blacksmith invocation contract exposed by PR #1021's required
  post-landing proof: delegated one-shot runs own cleanup and reject
  `--stop-after`; their real bounds are automatic stop, a 10-minute provider
  idle timeout, and the 50-minute hydration-workflow ceiling.

## Success criteria

- `MURPH_VERIFY_EXECUTOR=ssh` selects only Crabbox's static `ssh` provider,
  requires an explicit safe host alias, targets macOS, and fails closed when
  configuration or the Crabbox CLI is unavailable.
- Automatic verification remains local and the paid Blacksmith executor remains
  explicit.
- Every local worktree receives a deterministic, non-identifying remote lease
  id and work root, while the existing per-worktree artifact lock prevents two
  syncs from the same checkout from racing.
- The SSH command uses the existing Git-state/sensitive-path admission boundary,
  performs a clean Crabbox sync, forwards no environment allowlist, and enters a
  synthetic test-only environment on the remote host.
- Blacksmith one-shot invocation no longer passes unsupported or ineffective
  generic lifecycle flags; focused tests prove its automatic cleanup contract
  and retained idle/workflow ceilings.
- Setup and operational guidance requires a dedicated non-admin, secret-free
  macOS account with Remote Login restricted to that account, a neutral shared
  work root, SSH-key auth, and the repository Node/pnpm/tool prerequisites.
- Canonical local verification, completion reviews, final ReviewGPT, and PR CI
  pass.

## Scope

- In scope:
  - `scripts/verification-dispatch.mjs` executor selection and invocation.
  - A minimal static-host entrypoint that reuses the existing sanitized
    verification implementation.
  - Focused dispatcher, entrypoint, prompt-policy, and documentation changes.
  - Corrected Blacksmith lifecycle documentation and the one required
    post-landing proof retry.
- Out of scope:
  - Provisioning or remotely configuring the user's second Mac without its host
    details and explicit access.
  - GitHub self-hosted runners, queues, coordinators, databases, reusable cloud
    leases, remote editing, or distributed test sharding.
  - Automatic executor health selection or silent fallback.

## Constraints

- Technical constraints:
  - Reuse Crabbox v0.40.0's first-party static SSH provider and sync protocol.
  - Preserve the canonical `pnpm test:diff` / `pnpm verify:acceptance` command
    semantics and existing verification owner.
  - Keep all source environment values, credentials, `.env*`, local artifacts,
    and private paths out of the remote sync/command boundary.
  - Multiple local worktrees must never sync into the same remote workspace.
- Product/process constraints:
  - Prefer deletion and direct data flow; add no service or persisted product
    state.
  - Use the worktree/PR lane, preliminary completion specialists, parent review,
    final ReviewGPT, canonical verification, and a scoped commit.

## Risks and mitigations

1. Risk: concurrent worktrees overwrite a persistent static-host checkout.
   Mitigation: derive a separate opaque lease id and work root from each local
   worktree; serialize same-worktree sync through the existing artifact lock.
2. Risk: a remote account exposes credentials to tested code.
   Mitigation: require a dedicated non-admin account with no product credentials,
   forward no environment values, and rebuild the command environment from a
   fixed synthetic test set.
3. Risk: a stale static checkout changes verification results.
   Mitigation: request Crabbox's full resync before every canonical run while
   retaining only host-level package-manager caches outside the checkout.
4. Risk: generic lease flags appear to bound Blacksmith but are rejected or
   ignored by its delegated provider.
   Mitigation: use only the provider-supported idle timeout; rely on the
   provider's tested one-shot stop and the workflow's 50-minute ceiling.

## Tasks

1. Refactor the remote verification runner so Blacksmith keeps its trusted
   entrypoint assertion while static SSH can reuse only the sanitized execution
   core.
2. Add explicit `ssh` executor selection, host validation, per-worktree remote
   identity/work root, source-side artifact locking, and first-party Crabbox SSH
   arguments.
3. Remove unsupported/ineffective Blacksmith lifecycle flags and update focused
   contracts.
4. Update the canonical verification owner docs, Crabbox skill, root routing,
   and test map with setup, security, precedence, and failure behavior.
5. Run focused and canonical verification, then retry the required post-landing
   Blacksmith proof exactly once after the concrete pre-provisioning failure.
6. Complete specialist review, parent review, final ReviewGPT, commit, push, PR,
   and CI loop.

## Decisions

- Use Crabbox's existing `provider=ssh`; do not build an SSH transport.
- Keep `auto` local. `ssh` and `crabbox` are explicit, fail-closed executors.
- Use `/Users/Shared/murph-crabbox/<opaque-worktree-id>` as the neutral static
  work root and a matching opaque static lease id.
- Use full resync plus the existing per-worktree artifact lock instead of a new
  cross-host scheduler.
- A static Mac is the preferred free offload lane when configured; Blacksmith
  remains the paid fallback under the existing admission rule.

## Verification

- Focused dispatcher and remote-entrypoint suites: 30 tests passed.
- Canonical forced-local `test:diff` for the complete touched surface: 30 files
  and 440 repo-tool tests passed.
- The required corrected post-landing Blacksmith `test:diff` proof passed on
  Testbox `tbx_01kyh3ksz0y7ja5sjcs1ssf99c` in 56 seconds; Crabbox stopped the
  one-shot Testbox after success. The first pre-correction attempt failed before
  provisioning because the delegated provider rejected `--stop-after`.
- Automatic/local, SSH, and Blacksmith paths select deterministically in focused
  coverage. SSH construction proves per-worktree isolation, full resync,
  source-side locking, safe host validation, and secret-free process
  environments. A real lock-contention regression proves remote admission runs
  after lock acquisition and refuses candidate changes made while waiting. A
  real static-host smoke remains operator setup work because no SSH alias or
  dedicated worker account was supplied to this task.

## Preliminary specialist review

- Coverage finding (high): accepted. Admission previously ran before the
  artifact lock, so a worktree change could race the snapshot. The dispatcher
  now re-enters itself under the lock before admission, and the real
  lock-contention regression proves the provider is not called when a late
  untracked file appears.
- Coverage finding (medium): confirmed as an external validation gap. A
  production-faithful static-host smoke requires the dedicated account and SSH
  alias that this task intentionally does not invent or provision. The
  configuration, transport construction, trust boundary, and lock ordering are
  covered locally; the first live smoke remains an operator setup step.
- Prompt finding (low): accepted. The Crabbox skill now states separately that
  only Blacksmith requires Blacksmith authentication; static SSH uses its
  configured alias.
- Parent review: passed after inspecting the full patch, checking the static SSH
  and doctor flags against Crabbox v0.40.0, and clarifying that prerequisites
  must be visible to non-interactive SSH. No additional architecture or state
  owner was needed.
- Final canonical verification and the final ReviewGPT/CI gate remain before
  completion.
