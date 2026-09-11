# Exercise real authentication through hosted browser persistence

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Prove browser sign-in, consent, a persisted Settings change, reload and logout through production owners; replace selected auth SDK and route mocks with real dependency/HTTP/PostgreSQL proof.

## Success criteria

- Real installed Privy verification rejects invalid signatures, audience and expiry.
- A composed route test uses actual identity, CSRF, consent, session and storage owners.
- A protected sandbox browser lane starts empty, receives the production cookie through HTTP, persists a Settings change and loses access after logout.
- Required sandbox configuration fails closed; no browser or generic build receives management credentials.

## Scope

- In scope: auth contract tests, existing hosted-local E2E registration, a local HTTPS browser adapter, protected-main sandbox workflow and verification documentation.
- Out of scope: production credentials, provider account creation/deletion, new auth bypass endpoints, changes to product auth semantics and Better Auth activation.

## Constraints

- Technical constraints: preserve production owners and the existing seeded rendering smoke. Use ephemeral local TLS keys, isolated migrated PostgreSQL and the existing local KMS boundary. Keep provider identity and token data out of reports.
- Product/process constraints: Privy test accounts are configured in a dedicated development app; the lane tests real provider SDK/token behavior but does not claim actual OTP email delivery. Better Auth migration is additive and disabled by default on this source revision.

## Risks and mitigations

1. Provider credentials could reach untrusted code or artifacts. Restrict the workflow to protected main, partition stage environments and emit fixed metadata-only results.
2. Local HTTP can hide production cookie bugs. Require the built production artifact and drive the journey over local HTTPS through a real reverse proxy.
3. Seeded state can hide authentication. Seed only an active fixture member bound to the real sandbox principal; issue no session or consent. New-member creation is independently proved over real HTTP/PostgreSQL.

## Tasks

1. Add real SDK and composed HTTP/PostgreSQL authentication tests.
2. Add protected sandbox configuration, browser driver and hosted-local scenario with bounded teardown.
3. Add focused environment/proxy/workflow tests; run focused tests and affected typechecks.
4. Update testing owners, inspect privacy/complexity, create scoped commit and draft PR. Original thread owns ready/ReviewGPT.

## Decisions

- Use Privy's supported dashboard test email and OTP through the actual Web login controls. Do not use getTestAccessToken or inject a session.
- Preserve existing rendered-page proof and add a separate explicit live scenario excluded from default credential-free all.

## Verification

- Commands: focused Vitest SDK/route/config/proxy/driver tests; isolated migrated PostgreSQL lane; hosted-local harness typecheck; Web typecheck; relevant complexity and documentation checks.
- Expected outcomes: all credential-free proof passes. If protected sandbox configuration is unavailable locally, record the exact missing names and do not report the live journey as executed.

## Candidate evidence

- Real SDK contract: 11 passing tests. Actual HTTP/PostgreSQL composition: six
  passing tests after 219 migrations in an owned isolated loopback database;
  cleanup verified no remaining fixture members and removed that database.
- Harness/config/workflow: 46 passing checks. Real TLS transport: two passing
  checks. Web and Cloudflare typechecks, harness build, scoped Web ESLint,
  actionlint, documentation drift, diff whitespace and complexity checks pass.
- The actual production Web compiler completed with 733 generated pages using
  an isolated smoke suffix and synthetic public app id, without management
  credentials. The scenario now builds this artifact itself before execution.
- Calling the public auth journey command without its five dedicated fields
  fails with exit 1 before preparation; the diagnostic lists field names only.
- Independent review identified old-cookie replay and missing production
  preparation. Both are fixed, with focused harness regression proof.
- Live Privy browser execution remains unrun: the dedicated development app and
  its five protected environment values are not provisioned in this local
  session. Required names and provider setup are documented in the verification
  owner. No production secrets or provider mutations were used.

## Implementation review closure

- [ReviewGPT round 1](https://chatgpt.com/c/6aa34efd-9bd0-83ea-bbeb-13f55ec6a747)
  passed with no findings at first-reviewed head
  `043b062e3488335ed0c5c6bf5c11316857c8c91c`. The parent verified concrete
  `gpt-6-pro` execution and all 20 reviewed diff-blob hashes.
- This closure changes documentation only and preserves the reviewed code.
  Required current-head CI remains pending; the original thread owns those
  checks and the final PR completion decision.
- Live sandbox browser execution remains unrun. Its five protected Privy
  development-app values and prior test-account initialization remain required;
  no production secrets or provider mutations were used. Closing the
  implementation plan does not claim that external proof has passed.
Completed: 2026-09-10
