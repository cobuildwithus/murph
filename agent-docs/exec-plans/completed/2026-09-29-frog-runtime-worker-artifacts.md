# Prepare isolated capture workers for focused runtime tests

Status: completed
Created: 2026-09-29
Updated: 2026-09-29

## Goal

Make the existing prepared test-runtime command prepare the actual isolated
vault-share worker consumed by focused assistant-runtime entrypoint tests.

## Scope and constraints

Extend the existing build, clean, and artifact-smoke lists. Preserve production
source, worker isolation, imports, and outcome assertions. No new runtime owner,
dependency, or provider access. Internal tooling only; Product UX is not applicable.

## Root cause and decisions

The worker uses its published compiled package entrypoint in a separate Node
thread. Vitest aliases only cover the parent process. The test-runtime project
list omitted assistant-runtime, and the prepared artifact checks did not include
its capture worker, so preparation falsely reported success.

## Verification

Baseline from a fresh checkout: frozen install; prepared build passed; published
worker absent and real worker startup returned MODULE_NOT_FOUND. The reported
system-mailbox selection failed six cases and passed three. The full foreground
entrypoint file failed the reported five cases and passed fifteen.

Candidate preparation and public-worker import passed. The full foreground
entrypoint suite passed all twenty cases; all nine selected system-mailbox cases
passed; all nine Environment recording scenarios passed. Both script syntax
checks, cleanup print inspection, docs drift, diff hygiene, and complexity guard
passed with no new complexity debt or hotspots. Parent candidate review passed.

## Completion

The scoped implementation and focused proof are complete. Exact-head ReviewGPT,
required CI, and guarded landing are tracked by the PR completion owner.
Completed: 2026-09-29
