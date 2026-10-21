# Use Luna for routine live deployment smoke

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Goal

Use GPT-6 Luna for the bounded live deployment probe while preserving GPT-6 Sol as the managed member default.

## Success criteria

The canonical smoke model selects Luna across the container command, Worker fence, and smoke result validation. Focused checks preserve exact model admission, one-request consumption, and final OK validation. Required CI and final review pass before merge.

## Scope and constraints

Change the existing model constant, its focused assertions, and current deployment documentation. Preserve the prompt, request budget, auth injection, member routing, and production workflow gates. No model selector, fallback, dependency, or new owner is needed.

## Risks and deployment

Worker and smoke-container model constants must agree. Deploy through the protected full image path after the in-flight Sol rollout; do not independently switch a Worker against a stale smoke image. The existing artifact smoke proves the candidate before serving promotion. Luna proves the shared provider path, not availability of every member-selectable model. Keep the in-flight Sol proof as launch evidence.

## Tasks

1. Update the canonical constant and existing model-admission test.
2. Run focused smoke, route, egress, and result-validation checks plus Cloudflare typecheck and complexity guard.
3. Parent review, close this plan, scoped commit, exact-head CI and final ReviewGPT.
4. Merge and deploy through the protected workflow; verify a real Luna turn and existing convergence gates.

## Verification

474 focused tests passed across live model parsing, Worker routes, egress interception, and deployed-result validation. Cloudflare typecheck passed. Complexity guard passed with zero hotspots and unchanged maximum complexity of 8. Parent review confirmed one shared constant drives the container command, fence validation, and expected result; Luna is already present in the pinned launch catalog. Exact-head CI, final ReviewGPT, and production rollout outcomes will be recorded in PR evidence.
Completed: 2026-09-22
