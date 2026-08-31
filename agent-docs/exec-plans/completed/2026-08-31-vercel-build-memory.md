# Restore stable Vercel production builds

Status: completed
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Restore reliable hosted Web production builds on the existing Vercel Standard
  machine by removing the behavior-preserving assistant-planner source growth
  that first pushed the cold Webpack compile into OOM and compile stalls.

## Success criteria

- The assistant route planner returns the same characterized outputs and passes
  its focused deterministic suite after the rollback.
- The retained production-derived real-Codex planner journey passes and its
  synthetic member-visible reply is manually judged Ready.
- The assistant-engine package typecheck and build pass.
- An exact pushed candidate head completes a real Vercel Standard build without
  OOM, timeout, or an opaque compile stall.
- Required PR review and CI gates resolve with no accepted finding left open.

## Scope

- In scope: restore the last proven planner implementation shape while keeping
  the characterization and live-journey coverage introduced with the refactor;
  focused package and deployment proof; normal PR completion gates.
- Out of scope: Vercel machine-size upgrades, weakening production validation,
  re-enabling the previously unsafe restored Webpack cache, changing assistant
  product behavior, or broad build-system redesign.

## Constraints

- Technical constraints: production must continue to fit the 4-vCPU/8-GB
  Standard builder and retain the existing cold Webpack cache policy, isolated
  build worker, generated route/type checks, and static-generation bounds.
- Product/process constraints: preserve assistant behavior exactly; use the
  guarded worktree/PR lane; keep production evidence private and out of durable
  artifacts; run the required assistant journey and ReviewGPT gates.

## Risks and mitigations

1. Risk: restoring the prior source shape accidentally drops later behavior.
   Mitigation: restore only the file from the immediately preceding successful
   production head, retain the later characterization/live tests, and run them.
2. Risk: a local build pass does not prove the Vercel memory boundary.
   Mitigation: require a real exact-head Vercel Standard preview as acceptance.
3. Risk: a single remote pass hides intermittent pressure.
   Mitigation: pair the exact-head result with the adjacent production history
   that isolates the regression and retain all existing cold-build safeguards.

## Tasks

1. [done] Restore the planner source from the last successful production head.
2. [done] Inspect the diff for exact scope and privacy-safe contents.
3. [done] Run deterministic planner tests plus package typecheck and build.
4. [done] Run and review the focused real-Codex planner journey.
5. [done] Commit, push, open the PR, and require an exact-head Vercel Standard
   build.
6. [done] Run preliminary specialist and final ReviewGPT gates with CI, resolve
   any accepted findings, complete parent review, and close the plan.

## Decisions

- Keep the cold Webpack policy. Repository history proves restored warm caches
  caused the same OOM kills and silent compile wedges.
- Do not buy a larger builder as the first fix. The regression is isolated to a
  behavior-preserving source refactor immediately after a successful Standard
  build, so deleting that growth is the smallest durable correction.
- Retain the refactor's characterization and live-journey tests so the rollback
  has stronger behavior proof than the original implementation did.

## Verification

- Passed: focused planner Vitest suite, 102 tests, with unchanged characterized
  route-plan digests.
- Passed: assistant-engine package typecheck and build.
- Passed: focused real-Codex direct-route planning journey on the target model
  using a local subscription. The synthetic scenario made exactly one provider
  request, retained the early detail across 60 committed messages, produced the
  expected user and assistant effects, and the reply-review verdict is Ready.
- Proven regression: the first production head containing the planner refactor
  was the first adjacent head to exceed the Standard builder's 8-GB memory
  boundary; subsequent heads either OOM-killed or stalled in Webpack compile,
  while the immediately preceding production head completed on the same machine
  and cold-cache policy.
- Passed: three independent Standard-builder deployments completed without OOM,
  timeout, or compile stall. The final forced-cache-bypass build was explicitly
  bound to the rebased candidate head: Webpack compiled in 5.2 minutes, all 284
  static pages generated in 42 seconds, and the full deployment reached Ready
  in 10 minutes. The two preceding source-identical forced passes compiled in
  6.1 and 7.4 minutes.
- Passed: preliminary specialist review. Its one accepted coverage finding was
  resolved by the repeated forced-cache-bypass deployment evidence above;
  Product UX and frontend were not applicable, and prompt review found no issue.
- Passed: final ReviewGPT round 1 with no qualifying findings.
- Passed: all required GitHub checks on the rebased candidate head, including
  release app verification, assistant/platform/CLI coverage, release build and
  typecheck, production runner bundle budget, and the scoped invariant gates.
- Passed: final parent review, including exact historical blob comparison,
  whitespace validation, scope/LOC review, and privacy scan.

## Changelog decision

- Not applicable. This restores the production build's prior source shape and
  deliberately preserves all member-visible assistant behavior; it is internal
  deployment reliability work rather than a shipped member capability or UX
  change.
Completed: 2026-08-31
