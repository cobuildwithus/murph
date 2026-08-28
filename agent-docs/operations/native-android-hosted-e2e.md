# Native Android hosted E2E operations

## Ownership

`.github/workflows/native-android-hosted-e2e.yml` is the trusted default-branch
production canary controller. It runs at minute 47 every six hours, after the
iOS controller's minute-17 slot. It admits no pull-request, deployment-status,
or manual event and publishes no required commit status.

The read-only selection job compares the current default-branch SHA with the
latest successful scheduled run of this exact workflow. An equal SHA skips the
paid native journey. A missing checkpoint or changed SHA runs it; a failed run
leaves the previous checkpoint in place, so the next slot retries. An explicit
rerun of the same trusted scheduled run bypasses the skip. Fixed,
non-canceling Android concurrency prevents overlap without creating a waiter
for every commit or deployment event.

The canary checks out `main`, proves that exact SHA is in current protected-main
history, and verifies that the current production alias resolves to it before
dispatching the private Android workflow at an immutable tag. It uses only
`production_canary` with `non_destructive_existing_identity`. It does not enter
the historical shared PR environment, acquire reset authority, create a Vercel
candidate, or mutate the dedicated PR identity.

The dispatcher modules retain deterministic PR-mode support and focused tests,
but no public workflow currently admits that mode. Those helpers are not a
current operator path; reintroduction requires a separate trust and cost review.

## Private Android dispatch contract

The controller resolves the lightweight tag named by
`NATIVE_ANDROID_E2E_ANDROID_REF` and requires it to resolve directly to
`NATIVE_ANDROID_E2E_ANDROID_EXPECTED_SHA`. Annotated tags, branches, mutable
head selection, and source mismatch fail closed. The dispatched public inputs
are:

- contract version `1`;
- `pr` or `production_canary` mode (the public workflow currently dispatches
  only `production_canary`);
- exact hosted Web HTTPS origin and exact Web SHA;
- privacy-safe correlation id;
- a 30-minute epoch-second dispatch expiry;
- explicit identity lifecycle;
- exact Android SHA and immutable Android tag.

The private Android workflow independently checks its event ref, tag name, and
`github.sha` against those inputs before checkout. A successful GitHub Actions
run is accepted only when its run id, `workflow_dispatch` event, and `head_sha`
all match the dispatch receipt and resolved Android tag. The private workflow
rejects an expired lease before checkout and rechecks it in instrumentation; it
accepts no lease more than 35 minutes ahead. If polling, attestation, or the
bounded wait fails while that private run is still nonterminal, the controller
requests cancellation, escalates to force-cancellation when needed, and waits
for the exact run to become terminal. If GitHub cancellation or status itself
cannot be attested, the controller keeps the shared identity/deployment lock
through the dispatch expiry plus the private workflow's 55-minute hard timeout
and a terminal grace window. An unapproved stale run cannot pass its lease, and
a run that passed preflight cannot outlive that fallback fence before cleanup.

## Protected environments

### Dormant shared PR lifecycle

The dispatcher modules and their tests retain PR-mode support for the
historical shared database, Privy, Junction, and Vercel lifecycle. The current
Android workflow never references the `native-ios-hosted-e2e` environment or
its destructive credentials. Those values are not prerequisites for the
scheduled production canary. Reintroducing that path requires a separate
review of its single cleanup authority, cross-platform identity, application
identifier, and provider-isolation contracts.

### `native-android-production-canary`

Required variables:

- the six Android repository/source variables listed above;
- `HOSTED_WEB_PRODUCTION_BASE_URL` (exactly `https://www.withmurph.ai`);
- `HOSTED_WEB_VERCEL_PROJECT_ID`;
- `HOSTED_WEB_VERCEL_TEAM_ID`.

Required secrets:

- `NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY`;
- `HOSTED_WEB_VERCEL_TOKEN`.

This environment must not contain a reset-capable database/Privy/Junction
identity lifecycle. Canary dispatch is
`non_destructive_existing_identity` only.

## Privacy and retention

The backend workflow emits bounded stage/result notices and exact source ids.
It does not print the phone, OTP, tokens, provider payloads, member records, or
Junction user values. It creates no artifact. The scheduled production canary
does not create candidate deployments or mutate identity lifecycle state.

The private Android workflow owns raw instrumentation output handling: raw SDK,
Gradle, provider, and test results stay in runner-temporary storage, are reduced
to one allowlisted stage summary, and are deleted before completion.

## Bootstrap and source rotation

For initial setup, land the backend controller, then land the Android patch,
create a protected lightweight tag pointing directly to its reviewed commit,
and set `NATIVE_ANDROID_E2E_ANDROID_REF` plus
`NATIVE_ANDROID_E2E_ANDROID_EXPECTED_SHA` together. Configure the production
canary environment before enabling the scheduled controller. The canary is
informational and must not become a required commit status.

For every Android revision, create a new protected lightweight tag and update
both variables atomically. Never move or recreate an existing tag. A moved,
annotated, branch-backed, or SHA-skewed ref is rejected independently by the
backend dispatcher and private workflow. The next eligible scheduled slot
tests the new source; rerun that trusted scheduled run for an immediate retry.

## Deterministic verification

From the shared backend repository:

```sh
node --test scripts/native-android-hosted-e2e.test.mjs
```

From the Android repository:

```sh
node --test scripts/validate-native-android-e2e-contract.test.mjs
```

The live runs are intentionally environment-protected. A local invocation is
not deployment or identity attestation.

## Physical-device boundary

The managed Android run proves the production application graph, hosted APIs,
Privy OTP, canonical admission, server-owned onboarding, Health Connect system
handoff/permission state, sign-out, returning login, and a Junction
`health_connect` connection. It does not prove Play signing, OEM-specific
Health Connect UI, physical health-history availability, background collection,
or sensor/provider behavior. Those remain physical-device release checks.
