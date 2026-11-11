# Retire browser live voice

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Outcome and invariant

Retire browser live voice and its native Codex customizations. Preserve ordinary
assistant chat, voice memos, historical usage, and canonical mailbox records.

## Owners and evidence

The Web voice page and POST API admit browser calls. Dedicated browser components,
design studies and provider proofs serve only that feature. The native patch also
contains non-voice config isolation, websocket timeout and token-accounting changes;
the user explicitly requested preserving those non-voice fixes. Upgrade the pinned
CLI to the latest stable version, 0.167.1, verified from the npm dist-tag.

## Product UX

- Outcome: browser live calls are no longer offered.
- Entry: old voice URLs become not found; historical changelog links no longer
  advertise a removed route. Design pages retain their remaining studies.
- People: signed-in and signed-out visitors, on desktop and phone.
- Exclusions: messaging voice memos and historical billing remain supported.
- Proof: route removal, surviving design rendering, changelog and telemetry tests,
  affected typechecks, native compatibility checks for the selected patch scope.
- Verdict: Ready for the local change. Browser 404 and remaining design-page
  rendering were verified at phone and desktop widths; release gates remain.

## Plan

1. Remove Web call admission, UI, assets and obsolete browser proofs.
2. Resolve and remove the native patch dependency within the authorized scope.
3. Update owner docs and proof inventories; verify surviving paths.
4. Review the final diff and create a scoped commit; report unavailable proof.

## State, failure and rollout

No canonical data migration or deletion. Removed public admission prevents new
calls; retained historical records stay readable. Native and Web changes need
normal release gates before deployment. No production mutation is authorized.

## Verification

- Removed browser pages, call admission, media assets/studies, native voice adapter,
  call-control bridge, runtime retention and provider Live forwarding. Existing
  voice mailbox/usage readers and optional wire fields remain for old records and
  mixed-version parsing; none can establish a media session. Historical queued
  voice delivery fails terminally without entering a provider.
- Pinned registry package, allow-build policy, lockfile, image source/helper
  checksums and egress inventory to Codex 0.167.1, upstream commit
  `0a94398fa60c4fac0e7659e4213a0a36e613dd46`. Replaced the public-live patch with
  `patches/codex-runtime.patch`, retaining config isolation, WebSocket first-frame
  timeout, hosted prompt-cache options and 12-hour cache-write accounting.
- The patch applies to the exact upstream source. Native macOS CLI build succeeds
  and reports 0.167.1. Stable and experimental protocol exports were regenerated
  with the upstream generators; both schema tests pass. Upstream acknowledgement
  tests: 4 passed. The source provenance check validates all 16 reviewed owners.
- Rebuilt-binary WebSocket recovery: 8 passed, including the 15-second native
  deadline and acknowledged-response recovery. Scheduled-turn/cache-retention
  compatibility: 3 selected tests passed; 145 unrelated cases skipped by filter.
- Assistant engine helpers: 92 passed, 2 native-only skips subsequently covered
  by the rebuilt-binary run. Runtime callbacks/config: 379 passed, 6 skipped.
  Runtime checkpoint/scheduling: 98 initially passed; four preemption cases
  needed the package's compiled test worker. After `pnpm --dir
  packages/assistant-runtime build`, the complete preemption file passed all 44.
- Cloudflare egress/version/route checks: 208 passed. Container image, deployment
  artifact, runner lifecycle and invocation checks: 378 passed. Mailbox/control
  and container-entrypoint focused checks also passed. Shared contract: 10 passed;
  Cloudflare control client/routes: 85 passed.
- Web changelog/telemetry: 15 passed. Chromium retirement journey passed: removed
  pages and POST admissions return 404; former voice design tab falls back to
  Brand at 390px and 1440px. Screenshots inspected locally.
- Typechecks passed for Web, Cloudflare, assistant engine/runtime, hosted
  execution, Cloudflare control client and hosted-local harness. Runtime build
  passed. Changed-file lint passed with existing warnings; newly orphaned imports
  were removed. Complexity guard passed; no complexity increase requires new
  machinery. Review context tooling: 10 passed; container CI guard: 9 passed.
- Changelog decision: retain historical announcements, annotate retirement and
  remove their dead call-to-action links. No new marketing announcement for an
  unused feature removal. Current architecture/security/state-machine/deploy
  owners describe the retirement; historical execution plans stay untouched.
- Native mixed-lifetime cache-write accounting passed (1 test). App-server
  config-isolation passed (2 tests): preserves auth and managed requirements,
  excludes personal configuration and global instructions, retains project
  instructions.
- Dependency policy verification passed for all 26 manifests.

## Completion boundary

No provider-backed model journey, Linux image/sandbox execution, hosted continuity
run, pushed-head CI or external final review was performed locally. Those remain
release gates; macOS native and synthetic provider checks do not substitute for
exact-image Linux proof. No PR, push, merge, image publication or deployment is
part of this local change. Roll out Web admission removal first, then the matching
Worker/runner image and verify warm-container convergence. Historical data and
voice memos are unchanged. Parent diff, route references and added-content privacy
review passed. This plan closes with the scoped implementation commit.
Completed: 2026-11-10
