# Hosted Computer OS Controls

## Goal

Add one bounded fallback tool for hosted computer-use OS-level mouse/keyboard actions, backed by Kernel computer controls and reachable only through the existing signed web-control boundary.

Success criteria:

- Models can call a structured `murph.computer_os_control` tool only when hosted computer tools are available.
- The tool does not expose Kernel API keys, live-view URLs, raw JavaScript, cookies, storage, screenshots, clipboard APIs, typed sensitive text, or broad browser capabilities.
- Web owns Kernel OS-control execution and validates owned/runnable runs before action.
- Cloudflare continues to proxy only allowlisted signed `/api/internal/computer/**` routes.
- Focused schema, assistant-tool, web-service, and egress-policy tests cover the new path.

## Constraints/Assumptions

- Preserve existing dirty edits in the computer-use area; do not revert unrelated work.
- Keep this as a fallback primitive, not the default website automation path.
- Prefer existing computer-use route/store/service patterns over a new control plane.
- No new persisted state unless existing run state needs cached URL/title updates.

## Key Decisions

- Add a separate structured tool instead of widening `computer_act`, so Playwright actions remain the normal path and OS controls remain visibly fallback-only.
- Keep the API action vocabulary aligned with Kernel computer mouse/keyboard controls but cap durations, coordinates, text length, key names, and scroll/drag ranges.
- Exclude screenshot and clipboard capabilities from this pass.
- Exclude clipboard-affecting and browser/tab-management keyboard shortcuts, including decomposed modifier forms, and preflight OS `typeText` against the focused element's sensitivity before calling Kernel.

## State

- Implemented, verified, and ready for handoff. Scoped commit is blocked by overlapping pre-existing dirty edits in the same files.

## Done

- Required routing/security/reliability docs read.
- Existing overlapping dirty diff inspected.
- Shared OS-control schema, signed web route, web service method, Kernel adapter, assistant dynamic tool, prompt/skill guidance, and focused tests added.
- Accepted audit findings fixed: clipboard-affecting key combos removed; OS `typeText` now runs a focused-element sensitive-input preflight before Kernel execution.
- Final security audit finding fixed: `pressKey` no longer accepts decomposed modifier `holdKeys`, blocking tab-management shortcuts such as Ctrl+Tab and Ctrl+Shift+Tab regardless of encoding.
- Focused tests and package/app typechecks pass after fixes.
- Final static checks pass: `git diff --check`, forbidden-capability scan, and added-line privacy scan.

## Now

- Handoff complete.

## Next

- Coordinate with the owner of the overlapping computer-use/resume edits before creating a scoped commit.

## Open questions

- Paused-run resume behavior is affected by overlapping pre-existing computer-use edits and was flagged by deep review; treat it as out of scope for the OS-control fallback unless the owner of that lane coordinates a fix here.

## Working set

- `packages/hosted-execution/src/computer-use.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/skills/computer-use/SKILL.md`
- `apps/web/src/lib/computer-use/kernel-client.ts`
- `apps/web/src/lib/computer-use/service.ts`
- `apps/web/src/lib/computer-use/http.ts`
- `apps/web/src/lib/computer-use/runtime-log.ts`
- `apps/web/app/api/internal/computer/runs/[runId]/os-control/route.ts`
- `apps/cloudflare/src/runner-outbound/shared-web-control-policy.ts`
- focused computer-use tests
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
