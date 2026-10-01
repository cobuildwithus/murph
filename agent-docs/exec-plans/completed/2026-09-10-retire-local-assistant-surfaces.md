# Retire the local HTTP daemon and terminal chat UI

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and protected behavior

Remove the optional assistant HTTP daemon and custom Ink terminal chat UI.
Retain the shared vault CLI, direct local assistant ask/deliver/run/status/session
and scheduling operations, onboarding, and hosted messaging. Custom inference,
Clinical Records, and group missions remain unchanged.

## Ownership and evidence

Assistant CLI currently forwards eligible calls to assistantd or the existing
in-process assistant-engine owner. Delete the duplicate remote branch and reuse
that engine directly. Preserve the local Linq restriction, explicit operator
authority, and legacy local Linq automation cleanup. Device-syncd and inbox
process lifecycles are separate retained capabilities, including startDaemon
options referring to the inbox runtime.

The dedicated assistant UI owns only terminal composition, rendering, model
switching, and interactive chat commands. Remove both root chat and assistant
chat commands. Keep run-terminal-logging and its redaction tests.

## Product UX

Product change: terminal chat and HTTP daemon invocation are retired. Direct
one-shot assistant commands and messaging retain their behavior. Existing
canonical files and session transcripts are not deleted. Package README and
release notes explain the retained commands; no compatibility daemon is added.

## Tasks and proof

1. Delete UI and daemon packages, exports, command registration, dependency and
   build/test/release inventory entries; simplify direct wrappers.
2. Retain focused proof for ask/delivery authority, local routing restrictions,
   automation cleanup, cron/store/outbox behavior, command registration, logging,
   package boundaries, and shared vault CLI packaging.
3. Run affected tests, typechecks, build/generation checks, and complexity.
4. Review full diff/privacy, close plan, commit, push PR, run required review and CI.

## Deployment

Local package changes; no hosted protocol or database migrations. Previously
installed packages retain their behavior until upgraded. Existing sessions and
vault files remain readable. No live process is stopped by this task.

## Verification

Implementation and parent candidate review complete. Assistant CLI 56 tests,
setup package 110 tests, and 166 focused CLI tests pass after correcting the
retired setup auto-chat expectation. Assistant CLI, setup, and CLI typechecks
pass; assistant CLI and setup emitted builds pass. CLI generation completed
through its prepared package build and regenerated schema, types, and skill hash.
Changelog generation passes. Complexity passes with seven existing hotspots:
the direct engine turn owner is comment-only; command dispatch and import-policy
inventory shrink; setup, contract validation, and release-plan validation keep
their existing control flow. No further unrelated refactor is justified.
Release inventory tooling verification passed (3 tests). Final exact-head CI and ReviewGPT remain pending.
The first tooling test invocation used the wrong runner, then root Vitest
excluded scripts; the scripts-specific Vitest config is the correct proof lane.

The deleted package left only ignored install/build files in this task checkout; removing those task-owned artifacts restored release discovery, matching a fresh checkout.
Completed: 2026-09-10
