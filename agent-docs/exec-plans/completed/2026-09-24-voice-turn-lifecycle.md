# Preserve voice across native turn cancellation

Status: completed
Created: 2026-09-24
Updated: 2026-09-24

## Goal

Keep a connected voice call usable when foreground work interrupts a background turn on the resident Codex process. Use native turn ownership without adding a voice scheduler or another process.

## Scope and decisions

- Native turn interruption must not terminate a healthy shared process.
- Interrupted turns still report cancellation and drain host-owned tool effects before releasing their slot.
- Unacknowledged interruption, process failure, and workspace shutdown retain bounded cleanup.
- Preserve canonical foreground priority and existing background work ownership.

## Tasks

1. Reproduce interruption while native media is attached, then verify two subsequent spoken answers.
2. Remove unnecessary process termination after native turn interruption; cover completion races and failed cleanup.
3. Run focused native and host lifecycle tests, typecheck, and a synthetic real-model journey.
4. Update durable documentation and member-facing changelog, review the diff, and complete ReviewGPT and exact-head CI before rollout.

## Product journeys

- A call stays connected while ordinary background work completes.
- Foreground input interrupts background work and its answer is spoken on the same call.
- Another voice input succeeds afterward without duplicate speech or a process restart.
- An unresponsive process is retired within the existing deadline; workspace shutdown closes media once.

## Verification

- Native public-Live regression: 5 tests passed, including interruption during an attached call, two subsequent spoken answers, and exactly one media close at workspace shutdown.
- Focused lifecycle, recovery, tools, steering and realtime bindings: 183 tests passed.
- Assistant-engine typecheck passed.
- Real-model journey `real model foreground answer after native turn cancellation`: passed with gpt-6-sol and local subscription auth. Same process reused; no dynamic tool calls; next reply correct and concise. UX verdict: Ready.
- Complexity guard passed: maximum 76 to 75; debt 183 to 182. Existing recorded termination ownership replaces a duplicate condition.
- Hosted voice and workspace-entrypoint tests: 19 passed; final recovery rerun: 45 passed.
- Changelog generation and production archive rendering: 10 tests passed. Web typecheck passed.
- Parent candidate review: Ready. Privacy checked; no provider input, auth, state, or scheduler changes. No task-owned Frog entry required.
- PR #3693 owns final ReviewGPT, exact-head CI, merge and rollout evidence; these external gates remain pending at archive time.

## Architecture and compatibility

The resident App Server remains the sole process owner; native turn completion is the authority for releasing its existing slot. Interruption reports failure only after pending host effects drain and the healthy process is released. Transport failure and unacknowledged cancellation retain existing process poisoning and timeout behavior. No new scheduler, process, queue, persisted state, provider input, database call, or public protocol is introduced. Existing Web/Worker and native protocol versions remain compatible; rollout only replaces the runtime adapter.

Completed: 2026-09-24
