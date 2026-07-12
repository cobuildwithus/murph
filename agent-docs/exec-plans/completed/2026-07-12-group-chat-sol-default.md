# Group-chat container Sol default

## Goal

Make hosted synthetic thread-container runtimes for group chats use GPT-5.6 Sol by default instead of inheriting the fleet Terra model.

Success criteria:

- A thread-container member resolves an explicit `gpt-5.6-sol` runtime override.
- Ordinary members keep the existing Terra default and Edge-only Sol preference behavior.
- Thread-container members do not gain access to the member-facing model preference mutation.
- Focused tests and the required completion workflow pass.

## Scope

- In: hosted member assistant-model resolution, focused regression coverage, and the durable hosted model-choice product spec.
- Out: fleet-wide model defaults, deploy smoke model, billing eligibility, model preference storage, and runner invocation protocol changes.

## Constraints

- Keep the existing web-owned workspace projection and Cloudflare override consumer unchanged.
- Add no persisted state, compatibility shim, queue, or second model-selection owner.
- Preserve unrelated worktree and coordination-ledger changes.

## Plan

1. Add a focused failing regression for thread-container model resolution.
2. Resolve thread-container members to the existing Sol runtime override while leaving Sol preference eligibility false.
3. Update the hosted plan model-choice spec to describe the special group-chat default.
4. Run scoped verification, required completion audits, parent final review, and a scoped finish-task commit.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
