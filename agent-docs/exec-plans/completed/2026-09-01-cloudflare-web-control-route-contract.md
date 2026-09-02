# Enforce Cloudflare web-control route coverage

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Make every hosted-runtime Cloudflare-to-Web control request derive from the
  same allowlist contract that the Worker proxy enforces, so a newly added call
  cannot compile or pass CI while its method/path remains unavailable in
  production.

## Success criteria

- The currently failing operator-task POST route is admitted while GET and path
  variants remain rejected.
- Runtime-platform calls can no longer supply an arbitrary method/path to the
  shared Web-control transport.
- One policy-owned route descriptor supplies both outbound call metadata and
  proxy allowlist matching, eliminating the duplicated call/allowlist lists.
- Cloudflare typecheck and focused Node tests fail on a synthetic unregistered
  route and pass for every registered route shape.
- The exact PR head passes required CI and the final ReviewGPT gate.

## Scope

- In scope: the Cloudflare hosted-runtime Web-control policy, transport, port
  call sites, focused regression tests, CI documentation, and deployment notes.
- Out of scope: system-mailbox wake ownership, Temporal scheduling, Web route
  implementation, provider behavior, and production deployment.

## Constraints

- Technical constraints: preserve the existing fail-closed proxy boundary,
  write-fence checks, route-specific methods, query strings, dynamic path
  families, and direct/proxy transport behavior; add no dependency or second
  route registry.
- Product/process constraints: isolate this change from the active mailbox
  livelock lane, use a task worktree and draft PR, keep private incident evidence
  out of repository artifacts, and run exact-head CI plus ReviewGPT concurrently.

## Risks and mitigations

1. Risk: centralization accidentally widens a method or dynamic path family.
   Mitigation: derive proxy matching from exact descriptors and preserve
   negative method/path-variant tests.
2. Risk: a broad mechanical call-site migration obscures a behavior change.
   Mitigation: keep request bodies, descriptions, timeouts, authority headers,
   and response parsing untouched; verify the final diff mechanically.
3. Risk: Worker/container rollout skew rejects a route during deployment.
   Mitigation: the route descriptor ships in the same Worker/runner bundle and
   is backward compatible; document Cloudflare-first convergence proof.

## Tasks

1. [x] Trace every shared Web-control transport call and policy matcher.
2. [x] Replace raw method/path request fields with policy-owned route descriptors.
3. [x] Add the operator-task descriptor and top-level compile/runtime regressions.
4. [x] Run focused Cloudflare tests, typecheck, build/import checks, and complexity.
5. [ ] Commit, open the draft PR, run CI and final ReviewGPT, resolve findings,
   and prove current-base mergeability.

## Decisions

- Keep Cloudflare's existing shared policy as the single route owner instead of
  adding a generated manifest or a CI-only duplicate route list.
- Enforce coverage in production types as well as tests: the transport accepts
  only policy-created route descriptors, so every ordinary call site is gated by
  the package typecheck that required CI already runs.
- Add one small source-inventory assertion for Web-control URL construction.
  This is an ownership gate rather than another route list: it admits the shared
  transport, the policy-backed diagnostic writer, and the Worker-local mailbox
  decoder, and fails when a new production file attempts to bypass those owners.

## Verification

- Initial regression proof: the new operator-task policy assertion failed before
  the route registry was corrected.
- Focused final Vitest: 14 passed across the route contract, operator-task
  platform integration, phone-call port, and personalization port; 203 unrelated
  cases were skipped by the name filter.
- Full Cloudflare Node suite: 154 files passed with 2,831 tests passed and two
  skipped; the separate container-helper suite passed all six tests.
- `pnpm --dir apps/cloudflare typecheck`: passed.
- `pnpm --dir apps/cloudflare build`: passed.
- `pnpm complexity:diff`: passed with no new complexity debt; the shared policy
  and transport both reduced their maximum measured complexity.
- `git diff --check`: passed.
- Exact registered routes pass; unregistered or method/path variants fail
  closed; arbitrary raw route calls fail TypeScript; and new Web-control URL
  construction outside the audited owners fails the required Node suite.
Completed: 2026-09-01
