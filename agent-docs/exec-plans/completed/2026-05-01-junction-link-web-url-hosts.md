# Junction Link web URL host validation

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

Make Junction `link_web_url` validation accept the documented Link domains without opening redirects to arbitrary hosts.

## Scope

In scope:

- Junction client `link_web_url` validation.
- Explicit allowed Link host config/defaults.
- Focused Junction client/provider tests using documented sandbox-style Link URL fixtures.

Out of scope:

- Live Junction API smoke tests with real credentials.
- API base URL override policy changes.
- Broader Junction polling/import behavior.

## Decisions

- Use a sandbox fixture rather than a live smoke because local test credentials are synthetic.
- Default allowed Link hosts to `junction.com` and `tryvital.io`, accepting exact hosts or subdomains only over HTTPS.
- Keep arbitrary host, deceptive suffix, and non-HTTPS Link URLs rejected.

## State

Now:

- Junction docs for Generate Link Token show `link_web_url` examples on `link.tryvital.io`.
- Link URL validation now defaults to `junction.com` and `tryvital.io`.
- Explicit `allowedLinkHosts` config can narrow the host set, while empty host lists fail closed.
- Host matching requires HTTPS plus exact configured domains or valid non-empty-label subdomains; arbitrary hosts, deceptive suffixes, leading-dot hosts, and HTTP URLs reject.
- Focused tests cover the documented `link.tryvital.io` fixture, configured narrowing, serializable config round-trip, and rejection cases.
- Required security/privacy, coverage, and final reviews completed. Low findings from security/final review were fixed and covered.

Verification:

- Passed: `pnpm --dir packages/device-syncd exec vitest run test/junction-provider.test.ts test/provider-manifests.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/device-syncd typecheck`
- Passed: `pnpm test:smoke`
- Passed: `pnpm typecheck`
- Passed: scoped `git diff --check` on task files.
- Blocked: `pnpm --dir packages/device-syncd test:coverage` and scoped `bash scripts/workspace-verify.sh test:diff <task files>` stop on the unrelated existing `packages/device-syncd/test/store.test.ts` webhook trace retention failure.

Next:

- No live Junction smoke in this lane because local credentials are synthetic.
- No scoped commit because the touched Junction files overlap other active dirty work in the shared checkout.

## Working Set

```txt
packages/device-syncd/src/providers/junction-client.ts
packages/device-syncd/src/providers/junction.ts
packages/device-syncd/src/index.ts
packages/device-syncd/test/junction-provider.test.ts
agent-docs/exec-plans/completed/2026-05-01-junction-link-web-url-hosts.md
agent-docs/exec-plans/active/COORDINATION_LEDGER.md
```
Completed: 2026-05-01
