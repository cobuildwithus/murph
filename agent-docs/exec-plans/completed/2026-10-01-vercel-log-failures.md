# Vercel failure-boundary corrections

## Outcome and scope

Restore browser navigation's complete execution budget and make rejected SMS
destinations actionable without exposing provider bodies or contact data.
Keep durable retry, stale-workspace, authentication, and lock-order guards intact.

## Owners and evidence

- `computer-use/service.ts` generates navigation followed by a bounded page read,
  but gives Kernel only the navigation budget. Reuse the existing result margin.
- `better-auth/twilio-verify.ts` retains only provider numeric codes and treats
  invalid destinations as service outages. Recognize only Twilio's documented
  exact invalid-parameter labels; keep unknown failures generic and private.
- Linq contention already has bounded preparation and provider replay. Vault
  sharing rejects stale captures under its existing committed-version fence.
  Do not weaken either boundary to eliminate expected transient log entries.

## Product UX

Outcome: Slow successful navigation can return its page state; an explicitly
rejected phone destination prompts correction instead of a service retry.
Reaches: Browser open, SMS sign-in, genuine provider outages, malformed responses.
Proof: Synthetic generated-script timing, provider-shaped responses, existing
authentication and computer tests, Web typecheck, changed-file lint and review.

## Steps

- [x] Add regressions and implement the two boundary corrections.
- [x] Verify focused behavior, typecheck, privacy, and complexity.
- [x] Review the scoped diff for a scoped commit.

## Local verification

- Six focused Web suites pass, covering 236 cases: Twilio transport and request
  admission, computer service/provider/logging, and changelog rendering.
- The new invalid-destination, parameter-diagnostic, and slow-navigation cases
  fail against the original source and pass with the correction.
- Web typecheck, changed-file ESLint, diff whitespace, and complexity pass.
  Existing computer-service complexity hotspots are unchanged; the timeout
  correction does not alter their ownership or transition behavior.
- Product UX: Ready for the bounded correction. Synthetic provider responses
  prove useful invalid-number feedback and unchanged outage behavior. Executing
  the generated navigation script proves a successful page read after slow
  navigation. No live SMS or browser side effects were used for validation.
- Historical generic errors cannot identify a rejected provider parameter or
  an arbitrary browser script's failure. This change improves the proven
  boundaries; it does not claim to eliminate external failures.
- Production rollout and post-deployment provider success remain separate
  verification steps; no production state was changed during diagnosis.

## Deployment

Web-only, no schema or protocol migration. Existing generic provider failures
remain failures. Browser actions are never automatically replayed. Production
provider success must be checked after an authorized deployment.
Status: completed
Updated: 2026-10-01
Completed: 2026-10-01
