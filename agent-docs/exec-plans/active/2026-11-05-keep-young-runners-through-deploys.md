# Keep recently connected runners through deploys

Status: active
Created: 2026-11-05
Updated: 2026-11-05

## Goal

Routine runner deploys should stop interrupting members in the middle of a
conversation. Do it with the smallest change that existing owners support.

## Evidence

Seven days to 2026-11-05 in production:

- **Deploys:** 59 runner deploys, each a native 10/25/50/100 rollout with zero
  connection-age grace.
- **Shutdowns:** rollouts stopped 33 running member shells with a `shutdown_signal`
  checkpoint. All 33 were under 20 minutes old (p50 187 s).
- **Member impact:** in 7 cases the member's next message arrived within the
  10-minute idle TTL. That message ran cold instead of warm.
- **Alerts:** 5 of 9 cold typing alerts over 8 s fell inside deploy windows,
  including runtime-typing c500a791 (9.35 s).
- **Why grace was zero:** e2363665f9 (2026-09-13) set grace to zero because of a
  standby pause. e8a5db79a1 removed that pause the same day.
- **Rollout duration:** with grace zero, a four-step rollout took about 10 minutes
  (deploy run 42067944733).

## Decisions

From the ReviewGPT architecture review on the apollo lane, 2026-11-05. Each
finding was accepted with evidence.

- Stopping warm shells on compatible deploys is not required for correctness.
  Runtime ownership and write fencing do not depend on container lifetime.
- One owner for the rollout plan:
  - The deploy CLI previously hardcoded `[10, 25, 50, 100]` separately from the
    rendered config. Wrangler `versions upload` never used the config's steps.
  - The provider now always requests one 100-percent step.
  - Wrangler config carries no step plan, and the CLI's duplicate literal is
    deleted.
- Member grace is 1,200 s.
  - The deploy-smoke application stays at zero.
  - Grace is set once, not per step, because each native step can wait out the
    grace again.
- Immediate mode stages zero member grace, so hotfix and first-writer releases
  still retire old shells quickly.
  - The pending-identity guard is unchanged.
  - A pending candidate can only be retried in the mode that staged it.
- The convergence wait is a time deadline: grace plus 25 minutes. It replaces
  `150 × steps` polls.
  - The private workflow's 65-minute setup/deploy deadline still bounds the job.
  - A timeout there leaves the same recoverable state as a convergence failure.
- Rejected: post-rollout re-warming. Deferred: the `durable_object` scheduling
  policy (sandbox parity gate) until this change is measured.

## Risks

- **Slower deploys:** gradual deploys take up to about 20 minutes longer
  whenever a young shell or fresh standby is running.
- **Grace value:** Cloudflare documents no maximum. If the API rejected 1,200,
  the serving PATCH would fail after the compatible Worker is live. Recover
  through an exact retry or an immediate-mode follow-up.
- **Long conversations:** a shell in continuous use past 20 minutes is still
  replaced, as before.

## Verification

- Cloudflare deploy suite: 279 tests across config, staging, provider, CLI and
  namespace retirement. It includes the immediate-grace staging, mode-pinned
  retry and deadline tests.
- `pnpm --dir apps/cloudflare typecheck` and `pnpm complexity:diff` pass.
- Post-deploy checks:
  - The serving application shows grace 1200.
  - `shutdown_signal` checkpoints followed by a member message within the TTL
    drop against the 7-in-7-days baseline.
  - Rollout duration is recorded.
