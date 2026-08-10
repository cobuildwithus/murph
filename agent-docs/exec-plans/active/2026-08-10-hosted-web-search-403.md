# Hosted web-search 403

Status: active
Updated: 2026-08-10

## Goal

Restore Codex-native web search for hosted Murph turns after the pinned Codex
runtime began issuing standalone search requests that the Cloudflare provider
egress boundary rejects.

Success means:

- a production-shaped regression proves the current `403 Forbidden` at the
  exact hosted OpenAI search route;
- the Worker admits only the required authenticated method and path, replaces
  the runner credential with the Worker-owned OpenAI credential, and strips
  runtime authority headers before upstream egress;
- unrelated OpenAI methods and paths remain fail-closed;
- the hosted runtime keeps Codex as the search owner without adding another
  search provider, tool, queue, or state owner; and
- focused tests, Cloudflare typecheck, required review, exact-head CI, and
  deployment proof complete before merge.

## Scope

- In scope: Cloudflare OpenAI egress policy, focused regression coverage, and
  the durable hosted provider-boundary documentation.
- Out of scope: changing search providers, enabling search for Venice or custom
  inference, changing Codex prompts or tool selection, persisting search
  results, or production data mutation.

## Invariants

- Codex App Server remains the single owner of native web-search behavior.
- OpenAI credentials remain Worker-owned; the runner carries only its scoped
  provider credential and cannot select a different upstream host or path.
- The new route is exact-method and exact-path allowlisted and preserves the
  existing provider/user/runner authorization check.
- Runtime authority, cookie, proxy, and caller-supplied provider headers never
  cross the Worker boundary.
- Search failure may fail the requested lookup, but it does not create durable
  work, another retry owner, or a fallback provider.

## Implementation

1. Reproduce the failure against the exact Codex 0.147 standalone search path
   and verify that the existing Worker policy returns 403 before upstream.
2. Extend the existing OpenAI provider policy at the narrow owning boundary.
3. Add focused success and rejection regressions for method, path,
   authorization injection, and authority-header stripping.
4. Update the hosted architecture/security/reliability/provider docs to match
   the shipped route and deployment behavior.
5. Run focused Cloudflare proof, typecheck, exact-head review and CI, then close
   the plan through the normal scoped commit path.

## Verification

- Focused `apps/cloudflare` Vitest coverage for OpenAI egress.
- `pnpm --dir apps/cloudflare typecheck`.
- Direct production-shaped request proof for `POST /v1/alpha/search` plus a
  disallowed-method/path check.
- Preliminary coverage ReviewGPT lens and final sensitive ReviewGPT gate.
- Exact-head PR CI and clean merge proof against current `main`.

## Progress

- [x] Trace the screenshot symptom to Codex 0.147 `web.run` with
  `search_query`.
- [x] Prove Codex sends `POST /v1/alpha/search` with the configured provider
  credential while the Worker allowlist omits that route and returns 403.
- [x] Add the narrow route, regression coverage, and matching durable docs.
- [ ] Complete focused verification, review, exact-head CI, plan closure, and
  merge readiness.
