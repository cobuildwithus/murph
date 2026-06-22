# Single Kernel Profile

## Goal

Remove hosted computer-use's per-user `profileKey` split so each hosted member has one persistent Kernel profile for browser auth state.

Success criteria:

- `murph.computer_start_run` no longer asks the model to choose a browser profile.
- Hosted computer-use stores and reuses one active Kernel-backed run per member.
- Kernel profile names are derived from deployment namespace plus member id only.
- Tests prove cookies/auth state cannot be split by `default`/`commerce`/`appointments`.
- The old DB `profile_key` column is not an authority surface; new rows write one legacy compatibility value only so this rollout does not need an unsafe column drop.

## Constraints

- Keep `KERNEL_API_KEY` and live-view URLs web-owned and secret-safe.
- Preserve signed Cloudflare-to-web computer-use callbacks.
- Preserve human handoff for login, payment, CAPTCHA, and other sensitive browser steps.
- Prefer deletion over compatibility shims unless a persistence rollout needs a narrow transition.

## Scope

- `packages/hosted-execution/src/computer-use.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/skills/computer-use/SKILL.md`
- `apps/web/src/lib/computer-use/**`
- Hosted computer-use persistence call paths, keeping the existing DB compatibility column inert
- Focused hosted computer-use tests and account export/deletion tests
- Durable docs that describe the hosted computer-use model

## Non-Goals

- Kernel managed auth connections (`auth.connections`) integration.
- Changing manual handoff semantics.
- Changing Kernel profile namespace env requirements.
- Changing unrelated review-gpt/browser profile tooling.

## Plan

1. Remove `profileKey` from shared computer-use request/schema/tool surfaces.
2. Collapse web store/service lookup and cleanup from member+profile to member-only.
3. Remove profile-key exposure from runtime records/export views while writing one legacy DB compatibility value for new rows.
4. Update tests/docs/skill guidance to describe one persistent profile per member.
5. Run focused verification, security/privacy review, coverage pass, deep review if still warranted, then finish with a scoped commit.

## Verification

- Pending.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
