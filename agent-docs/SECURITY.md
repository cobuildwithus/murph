# Security

Last verified: 2026-04-03

## Non-Negotiable Rules

- Treat `.env` and `.env.*` files as secret inputs. Murph's CLI may load local `.env.local` and `.env` files at runtime for operator credentials, but agents and runtime logs must never print, fixture, package, or commit their contents.
- Do not share raw filesystem archives of a repo clone for review or support. Ignored local `.env` files and build output such as `.next/` can leak through a clone/archive even when git has no tracked secret diff; use the guarded `scripts/package-audit-context.sh` / `pnpm zip:src` path instead, because it stages git-visible files and filters blocked local residue from the bundle.
- Redact sensitive identifiers from logs, fixtures, examples, and screenshots.
- Treat all auth, wallet, payment, and health-related data flows as high-sensitivity until documented otherwise.
- Do not echo model API keys, base headers, or other provider credentials in CLI output, fixtures, or persisted artifacts.
- Treat AgentMail inbox ids, message metadata, attachment download URLs, and outbound email thread bindings as high-sensitivity operator data; never log or fixture real mailbox details or API keys.

## Dependency Supply Chain Rules

- Keep `pnpm-lock.yaml` committed and update it in the same change as every manifest edit; setup, onboarding, deploy, and reproducibility docs/scripts should install with `pnpm install --frozen-lockfile` unless the task is intentionally editing dependencies.
- Do not introduce third-party dependencies via `git:`, `git+`, `github:`, `http:`, `https:`, `file:`, `link:`, `portal:`, or `npm:` alias specs. Internal workspace packages must use the `workspace:` protocol.
- Keep the root pnpm supply-chain controls enabled: exact package-manager pinning, `packageManagerStrictVersion`, `managePackageManagerVersions`, `minimumReleaseAge`, `trustPolicy`, `blockExoticSubdeps`, and explicit `allowBuilds` review. Do not bypass them with `dangerouslyAllowAllBuilds: true`.
- Prefer repo-local helpers or built-in platform APIs over one-off utility packages when the replacement is small, stable, and auditable.
- When adding or updating dependencies, review the manifest and lockfile together, run `pnpm deps:guard`, run `pnpm deps:audit`, and review blocked install scripts with `pnpm deps:ignored-builds` / `pnpm deps:approve-builds` before handoff. Keep any `allowBuilds`, `minimumReleaseAgeExclude`, or `trustPolicyExclude` exceptions as narrow and reviewable as possible.

## Bootstrap Security Posture

- No runtime trust boundary is implemented yet.
- Before adding external APIs, auth, wallets, storage, or webhooks, document the trust boundary in `ARCHITECTURE.md` and the concrete rules here.
- Prefer least-privilege defaults and explicit validation at system boundaries.
- `vault-cli inbox model route` sends only the normalized text bundle plus tool catalog to the configured model backend, but that bundle can still contain sensitive health data and must be treated as high-sensitivity operator input.
- Persist only audited bundle/plan/result artifacts for inbox model routing; never persist provider secrets alongside those artifacts.
- Web-search provider credentials must stay in environment variables only, and `web.search` results remain untrusted external content rather than canonical Murph truth. Search result snippets, URLs, and provider response bodies may be returned to the model at turn time, but they must not be persisted as secret-bearing runtime artifacts or treated as validated health facts without canonical import/write steps.
- `web.fetch` may retrieve public webpages over outbound HTTP(S), but it must stay a guarded read-only surface: block loopback/private-network targets before fetch, keep redirects bounded and revalidated, enforce timeout and byte limits, and treat fetched page bodies as untrusted external context rather than canonical Murph data. `web.fetch` does not imply browser automation, cookie/session replay, or private-network reachability.
- AgentMail-backed email polling and delivery must keep API keys in environment variables only, must not write raw Authorization headers to vault/runtime artifacts, and must limit assistant auto-reply to direct email threads.
- Assistant-state is high-sensitivity local runtime data: directories under `assistant-state/**` must be `0700`, files under `assistant-state/**` must be `0600`, secret-bearing provider headers must never remain inline in persisted session JSON, and operator-facing repair flows should use `assistant doctor --repair` so legacy inline headers are migrated into private sidecars under `assistant-state/secrets/**` before wider diagnostics continue.
- Runtime observability writes under `assistant-state/diagnostics/**`, `assistant-state/journals/**`, quarantine metadata, and persisted delivery errors must redact inline bearer tokens, cookies, API keys, and similar secret material before the artifact is committed.
- Device-sync account metadata is internal diagnostic state only. Hosted and local storage writes must sanitize it down to a compact shallow scalar record instead of persisting provider profile payloads, nested JSON blobs, or oversized string fields.
- Codex is a privileged local adapter, not a sandbox boundary. Assistant turns should rely on the bound Murph runtime/tool surface and normal canonical write ownership in `packages/core`, not a second provider-workspace or canonical-write-guard safety model.
- Assistant turns may execute the same canonical local assistant/vault tool catalog shape through the active vault's per-turn Murph runtime context. Message-triggered assistant auto-reply now has the same full Murph autonomy as other assistant turns, including assistant memory/state/cron and canonical vault write surfaces, so any accepted inbound channel message is effectively an operator-authorized action for that bound user and vault. Provider family still changes the transport mechanism for reaching that authority, but Codex CLI is now an explicitly privileged local adapter: it may run with normal local CLI/filesystem/env authority when selected, while other backends may remain tool-mediated. That privileged Codex posture still does not grant hosted-control-plane authority outside the local runtime boundary.
