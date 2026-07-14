# Foreground System-Note Starvation Fix

## Goal

Ensure generated system-note work cannot displace a newly accepted conversation message from its foreground assistant turn.

## Evidence

- Mailbox import currently places conversation messages and group-newsletter system notes in the same foreground input list.
- Foreground selection intentionally processes one causal input, sorted oldest-first.
- An older newsletter note imported with a new Linq message can therefore take the foreground slot while the user message remains pending.

## Constraints

- Keep one causal input per assistant turn.
- Keep newsletter notes durable and process them through the existing pending-input background path.
- Add no state, queue, scheduler, service, dependency, or new input classification.

## Plan

1. Stop promoting newsletter system notes into the fresh conversation input list.
2. Add a mixed-import regression proving the conversation input is foreground and the newsletter note is not.
3. Run focused tests and typecheck, commit to `main`, and immediately redeploy.

## Verification

- Focused hosted mailbox-import tests.
- Focused hosted turn-input tests.
- Assistant-runtime typecheck and `git diff --check`.
- Production trace for a fresh message after deploy.

## State

Active.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
