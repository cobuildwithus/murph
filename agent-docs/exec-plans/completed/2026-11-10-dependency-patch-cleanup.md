# Reduce dependency patches

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Outcome

Delete custom dependency behavior that has no current requirement. Preserve only
patches justified by demonstrated failures, privacy/security, billing accuracy,
or measured latency. Continue the existing browser voice retirement branch.

## Plan

1. Delete unreachable Wrangler 4.90 container patch and migrate ReviewGPT away
   from the redundant Incur 0.4.5 fork.
2. Remove optional committer amendment behavior and custom review duration policy.
3. Challenge each remaining Codex patch against stock 0.167.1 and delete optional
   behavior before considering replacement machinery.
4. Refresh one coherent lockfile; verify affected callers, typechecks and patch
   application; review the resulting diff and create a scoped commit.

## Boundaries

No deployment, upstream publication, PR or production mutation. Keep unrelated
work and the previous voice-retirement commits. Preserve privacy-safe CLI errors,
correct staged-file handling, native ownership and truthful usage accounting.
No new feature announcement is needed for internal dependency/process cleanup.

## Evidence and disposition

- Deleted the unreachable Wrangler 4.90 container-startup patch. Its sole
  dependency parent disables containers; all 19 Workers tests pass unpatched.
- Moved ReviewGPT to stock Incur 0.4.25, which is already used by Frog. Deleted
  the redundant 0.4.5 patch and MCP alpha.2 override/dependency. Native progressive
  MCP discovery, invocation, config precedence and errors are verified; no
  compatibility adapter was added. CLI typecheck and 5 focused tests pass.
- Removed scoped-committer amendment support; kept the three reproduced staging
  correctness fixes. Removed Murph's mandatory review-duration patch and local
  80-second/two-minute overrides. Native model attestation, artifact/turn identity
  and substantive review remain authoritative. Seven tooling suites pass 47
  tests, and three preflight tests pass.
- Retained the small Containers readiness/listener fix, current Wrangler local
  sidecar fix, Frog batch-index cache and Incur 0.5.1 privacy/build fixes. The
  read-only audit demonstrated their active requirements; no version churn or
  replacement layers were introduced merely to erase patch files.
- Codex now has only `patches/codex-websocket-ack.patch`: 20,916 bytes across three
  source/test files, down from 727,183 bytes across 58 files. The first response
  frame has a 15-second bound; acknowledged slow responses keep native idle
  behavior. A measured warm-socket 90-second stall justifies this sole fix.
- Deleted native twelve-hour cache selection, per-schedule lifetime branching,
  lifetime accounting and generated protocol/schema changes. Stock requests use
  default caching and native aggregate write accounting. Existing TS/Web readers
  still handle historical twelve-hour usage and older runners during convergence.
  The composed ordinary/scheduled/compaction request proof passes against stock
  0.167.1; 68 protocol/compaction accounting checks pass.
- Deleted the test-only native config-isolation extension and its launcher/help
  preflight. Provider fixtures keep their already-existing isolated home and
  provide canonical release evidence. Subscription runs keep the existing auth
  home and personal configuration, explicitly documented as developer evidence.
  No credentials are copied and no provider-mode switch is implicit. Six launcher
  and 17 runner/title tests pass against stock Codex.
- Cloudflare egress, image, bundle and patch contracts: 66 passed. Review package
  and native-source context: 33 passed. Engine runtime config: 52 passed. CLI and
  tools typechecks passed; dependency policy and complexity guard passed.
- Reduced native CLI builds successfully. Four Rust acknowledgement tests and
  eight rebuilt-CLI WebSocket recovery tests pass; silent warm recovery occurs
  at 15.01 seconds while acknowledged slow replies remain valid. The same default
  cache journey passes against both stock and reduced native binaries. Exact
  source verification passes and built source matches the three-file patch.
  Stock 0.167.1 fails the same silent-socket regression at its 60-second test
  deadline; the patched candidate recovers at 15.01 seconds. The stock teardown
  reports a busy process because that synthetic turn is still waiting. This is
  expected counterfactual evidence, not a candidate failure. The retained core
  integration test also passes (one selected case, 15.37 seconds). No test-owned
  Codex process remains running.
- Changed-file lint, added-content privacy scan and diff checks pass. No
  real-provider call, production operation or Linux image execution is part of
  this local verification.

## Product and completion

The runtime uses upstream caching defaults; longer-gap cache hits can change and
no net-cost or latency improvement is promised. Historical charges stay unchanged.
Local subscription model runs no longer claim personal-config isolation. No Web
UI or messaging behavior is added. Internal cleanup needs no public changelog.

The native image fingerprint includes the reduced patch, so a matching runner
image must be built and normal Linux permission/egress/continuity gates must pass
before deployment. No migration or new state owner is introduced. Pushed-head CI,
external review and deployment remain separate release work. Parent final diff, privacy, reference and complexity review passed. This plan
closes with the scoped implementation commit.
Completed: 2026-11-10
