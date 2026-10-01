# Use built CLI for runner manifest generation

Status: completed
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Remove runner assembly's contention-sensitive dependency on the workspace
  TypeScript CLI launcher while preserving the runtime reader's 60-second
  timeout and source-first development behavior.

## Success criteria

- Runner assembly defers only the assistant-engine CLI-surface artifact substep
  until the complete workspace CLI build exists.
- The deferred substep explicitly selects the built workspace CLI, with a
  source fallback only when that artifact is genuinely absent.
- Normal assistant-engine builds and runtime manifest reads keep their current
  source-first selection and 60-second timeout.
- The exact four-way production runner bundle succeeds and the generated
  assistant CLI surface remains present and valid.

## Scope

- In scope: runner workspace build orchestration, assistant CLI launcher
  selection for build-time generation, and focused regression coverage.
- Out of scope: raising the runtime timeout, release packaging, provider calls,
  generated-contract content changes, and the related unmerged timeout PRs.

## Constraints

- Technical constraints: preserve topological package builds, generate before
  package packing, and keep the existing artifact owner and runtime reader.
- Product/process constraints: no production behavior, provider, secrets, or
  new persistent state; use only repository-owned build seams.

## Risks and mitigations

1. Risk: deferral could omit the artifact from the packed assistant-engine.
   Mitigation: regenerate immediately after the workspace build and retain the
   existing pack/runtime artifact checks plus the exact bundle proof.
2. Risk: preferring a stale built CLI in normal development could hide source
   changes.
   Mitigation: make built preference explicit and runner-only; ordinary callers
   remain source-first.
3. Risk: a process-wide mode could leak into the post-build generation step.
   Mitigation: pass the defer mode only as an explicit child-build overlay and
   run post-build generation from the sanitized process owner without it.

## Tasks

1. [x] Reproduce and time the exact runner bundle and manifest owner.
2. [x] Add failing launcher-selection and two-phase build-plan regressions.
3. [x] Implement runner-only defer-and-built generation.
4. [x] Run focused tests, affected typechecks, exact bundle, and artifact proof.
5. [x] Commit the verified candidate and prepare its exact Draft PR handoff.

## Decisions

- The exact current bundle passed in 302.94 seconds and direct source-manifest
  generation passed in 18.68 seconds, but current code still starts the source
  launcher under concurrent package build work with a fixed 60-second bound.
  Prior contended evidence reached 40.8 seconds, so a single healthy run does
  not remove the supported-host race.
- Defer only the artifact substep during runner workspace assembly, then use
  the already-built CLI. Do not reuse the timeout changes in related Draft PRs.
- Keep the public changelog unchanged because this only alters repository-local
  runner bundle assembly and cannot change member-visible product behavior.
- Preliminary coverage and final cross-cutting ReviewGPT remain PR landing
  gates because the patch adds regression coverage and coordinates package
  build ordering across the hosted runner boundary.

## Verification

- Commands to run: focused assistant-engine launcher/generator tests, focused
  runner workspace-artifact tests, both affected package/app typechecks, the
  exact four-way `runner:bundle`, generated artifact validation, and required
  completion audits.
- Expected outcomes: focused tests and typechecks pass; the runner build plan
  proves defer-then-built ordering; the production bundle exits zero without a
  source-launcher manifest subprocess during concurrent package builds.
- Focused assistant-engine bootstrap tests: passed, 25 tests.
- Focused Cloudflare runner workspace-artifact tests: passed, 16 tests.
- Assistant-engine and Cloudflare package typechecks: passed.
- Exact four-way runner bundle: passed in 337.94 seconds.
- Built CLI generation: passed in 4.88 seconds; source-first generation passed
  in 16.47 seconds and produced the identical artifact SHA-256.
- Generated artifact schema remained `murph.assistant-cli-surface-prebuilt.v3`
  with a non-empty contract.
Completed: 2026-08-29
