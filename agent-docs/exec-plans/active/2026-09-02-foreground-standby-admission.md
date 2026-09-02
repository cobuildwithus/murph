# Protect standby shells for foreground starts

Status: active
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Reserve fresh shared standby claims for trusted Web-direct foreground starts,
  while preserving ordinary exact-user startup and existing-container reuse for
  background work and retries.

## Success criteria

- A trusted Web-direct default request may claim the ready standby.
- Temporal/default, `system_mailbox`, retention, and spoofed-direct requests do
  not call the standby coordinator and instead use the exact-user container.
- An already pending or bound standby remains the exact retry target regardless
  of the retry caller, so late binding cannot split one member across targets.
- Existing active exact-user or bound-standby containers continue to be reused.
- Focused Cloudflare tests and typecheck pass, exact-head CI is green, final
  ReviewGPT is resolved, and production proof shows claimed allocations are
  trusted Web-direct default attempts only.

## Scope

- In scope: fresh standby admission in the Cloudflare runtime-processing
  controller; focused admission and retry-race coverage; owning runtime docs;
  a safe public changelog decision; protected Cloudflare rollout and bounded
  live verification.
- Out of scope: increasing the one-slot ready pool, changing the 100-instance
  capacity ceiling, adding a scheduler or queue, changing Temporal contracts,
  or guaranteeing standby use when Temporal wins the existing startup race.

## Constraints

- Technical constraints: reuse the OIDC-derived `triggeredByWebDirect` flag,
  validated `web-ingress-<UUID>` identity, normalized default mode, existing
  pending-target recovery, and ordinary exact-user fallback. Add no persisted
  state, database work, network call, or deploy variable.
- Product/process constraints: preserve foreground priority, background
  recovery, member/container ownership, private evidence boundaries, exact-head
  review/CI, and protected deploy verification.

## Risks and mitigations

1. Risk: a caller could assert foreground eligibility without trusted identity.
   Mitigation: require both the route-authored direct flag and the existing
   validated direct attempt id.
2. Risk: a Temporal retry could abandon a late-bound standby and create a
   duplicate exact-user target.
   Mitigation: evaluate pending/retained targets before fresh-claim eligibility
   and preserve the existing fence convergence path.
3. Risk: the direct foreground request can lose the existing race to Temporal.
   Mitigation: retain ordinary exact-user startup and measure the resulting
   claimed/fallback cohort before considering any pool expansion.

## Tasks

1. Confirm exclusive ownership on current `origin/main` and map the exact
   admission/race tests.
2. Add the smallest trusted foreground eligibility rule after pending-target
   recovery and before a new coordinator claim.
3. Update focused tests, runtime documentation, and the changelog decision.
4. Run focused proof, Product UX walkthrough, complexity guard, and parent diff
   review.
5. Commit, open the draft PR, mark the exact candidate Ready, and run CI plus
   final ReviewGPT concurrently.
6. Resolve gates, merge, deploy through the protected Cloudflare workflow, and
   verify live claimed allocations before retiring the worktree.

## Decisions

- Product UX effort: Patch.
- Outcome: foreground messages get first access to the existing ready shell.
- Reaches: fresh hosted Linq and Assistant Ask Web-direct starts; members with
  an existing exact-user or bound-standby container continue on that container.
- Proof: focused admission/race tests plus post-deploy allocation and latency
  evidence.
- Keep one ready shell. Raising `max_instances` alone does not create a pool and
  a multi-shell coordinator would not remove background priority inversion.

## Verification

- Commands to run: focused `hosted-runner-container-identity` tests, route
  authorization tests already covering direct diagnostics, Cloudflare
  typecheck, `pnpm complexity:diff`, `git diff --check`, exact-head required CI,
  current-base merge-tree, protected deploy smoke, and a bounded live log tail.
- Expected outcomes: only trusted Web-direct default fresh requests claim; all
  ineligible fresh starts use the exact-user target; late-bound retry retention
  remains intact; no new hot-path await or provider-input change; live claimed
  events carry trusted direct identity and background work no longer drains the
  shared ready slot.
