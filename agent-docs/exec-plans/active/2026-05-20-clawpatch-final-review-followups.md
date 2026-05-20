# Clawpatch Final Review Follow-Ups

## Goal

Fix the final issues found by the four review subagents after the medium Clawpatch package-finding cleanup:

- keep the importers staged build simple, explicit, and resistant to partial `dist` publishes
- move built-package boundary assertions out of ordinary concurrent package test lanes
- preserve the previous clean dependency/package architecture with no sibling-internal imports

## Scope

- `packages/importers/**`
- package manifests and boundary tests for `packages/inboxd` and `packages/messaging-ingress`
- root build/clean scripts and TypeScript project references needed by that package boundary
- durable verification docs if command semantics change

## Constraints

- Preserve unrelated dirty hosted-runner, hosted snapshot, web, hosted-execution, and Murph Age work.
- Do not add new dependencies.
- Avoid hidden build coupling and broad special cases.
- Keep package entrypoints public and composable.

## Verification Plan

- focused package typecheck/build/test lanes for importers, inboxd, and messaging-ingress
- root workspace build/typecheck/smoke/doc checks required by repo policy
- four-agent review already identified the follow-up findings; run a final scoped review after patching if time permits
