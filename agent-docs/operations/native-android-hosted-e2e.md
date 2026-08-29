# Native Android hosted E2E operations

## Ownership

`.github/workflows/native-android-hosted-e2e.yml` is the trusted default-branch
production canary controller. It runs at minute 47 every six hours, after the
iOS controller's minute-17 slot. It admits no pull-request or deployment-status
event and publishes no required commit status. Authenticated manual recovery is
limited to `refs/heads/main` at the exact current `main` SHA; an arbitrary or
stale branch dispatch fails in the read-only selection job before protected
environment access.

The read-only selection job inspects the latest completed scheduled run of this
exact workflow. It skips paid work only when that run succeeded at the current
protected-`main` SHA. A missing checkpoint, changed SHA, or latest failure runs
the canary; an explicit rerun of the trusted controller attempt bypasses the
skip. Fixed, non-canceling concurrency prevents overlap without creating a
waiter for every commit or deployment event.

The canary checks out that exact `main` SHA and proves it remains in protected
history. Native source pins are versioned in
`.github/native-hosted-e2e-controller.json`, so a source rotation advances the
same checkpoint instead of mutating hidden runtime configuration. The
controller resolves the current production alias and dispatches that deployed
SHA. An alias behind `main` is admissible only when the existing Vercel build
classifier proves the entire intervening diff consists of eligible dated
release notes; any runtime-relevant lag fails before private dispatch and
retries at the next slot.

The public controller is canary-only. It cannot create a Vercel candidate,
reset a database or provider identity, or dispatch PR mode.

## Private Android dispatch contract

The controller resolves the policy's immutable lightweight tag and requires it
to point directly to the policy's reviewed Android SHA. Annotated tags,
branches, mutable head selection, and source mismatch fail closed. The private
workflow receives:

- contract version `1`;
- `production_canary` mode with `non_destructive_existing_identity`;
- exact production Web origin and deployed Web SHA;
- a privacy-safe correlation id and 30-minute dispatch expiry;
- exact Android SHA and immutable Android tag.

The private workflow independently checks its event ref, tag name, and
`github.sha` against those inputs before checkout. The public controller accepts
success only from the exact returned run id, `workflow_dispatch` event, and
resolved Android SHA. If polling or the bounded wait fails while that run is
nonterminal, the controller requests cancellation, escalates to force-cancel,
and waits for the exact run to become terminal. If cancellation or status
cannot be attested, it holds the execution fence through the dispatch expiry,
the private workflow's 55-minute timeout, and a terminal grace window.

## Protected environment

`native-android-production-canary` requires these variables:

- `NATIVE_ANDROID_E2E_ANDROID_REPOSITORY_OWNER`;
- `NATIVE_ANDROID_E2E_ANDROID_REPOSITORY_NAME`;
- `NATIVE_ANDROID_E2E_ANDROID_WORKFLOW`;
- `NATIVE_ANDROID_E2E_GITHUB_APP_ID`;
- `HOSTED_WEB_PRODUCTION_BASE_URL` (exactly `https://www.withmurph.ai`);
- `HOSTED_WEB_VERCEL_PROJECT_ID`;
- `HOSTED_WEB_VERCEL_TEAM_ID`.

Required secrets are `NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY` and
`HOSTED_WEB_VERCEL_TOKEN`. This environment must contain no reset-capable
database, Privy, Junction, or candidate-deployment authority.

## Privacy and retention

The backend emits bounded stage/result notices and exact source ids. It prints
no phone, OTP, token, provider payload, member record, or Junction user value,
creates no artifact, and performs no identity cleanup. Raw private-runner
instrumentation stays in temporary storage, is reduced to an allowlisted stage
summary, and is deleted before completion.

## Bootstrap and source rotation

For each Android revision, create a new protected lightweight tag pointing
directly to its reviewed commit, then update the Android `privateRef` and
`privateSha` together in `.github/native-hosted-e2e-controller.json`. Never move
or recreate an existing tag. Merge the policy update before enabling the
controller; the next scheduled slot sees the new `main` checkpoint. If GitHub
drops that schedule event, dispatch the controller manually against `main`;
the selection job revalidates the exact current SHA before paid work.

The canary is informational and must not become a required commit status.

## Deterministic verification

From the shared backend repository:

```sh
node --test scripts/native-android-hosted-e2e.test.mjs
```

From the Android repository:

```sh
node --test scripts/validate-native-android-e2e-contract.test.mjs
```

The live runs are environment-protected. Local invocation is not deployment or
identity attestation.

## Physical-device boundary

The managed Android run proves the production application graph, hosted APIs,
Privy OTP, canonical admission, server-owned onboarding, Health Connect system
handoff/permission state, sign-out, returning login, and a Junction
`health_connect` connection. It does not prove Play signing, OEM-specific
Health Connect UI, physical health-history availability, background collection,
or sensor/provider behavior. Those remain physical-device release checks.
