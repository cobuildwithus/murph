# Native Android hosted E2E operations

## Ownership

`.github/workflows/native-android-hosted-e2e.yml` is the trusted shared-backend
controller. It never executes candidate workflow code. For a trusted same-repo
pull request that passed Repo Hygiene, it checks out the protected default
branch, revalidates the exact PR head, creates a dedicated public Vercel
candidate from that exact Web SHA, resets the one protected non-production
identity, dispatches the private Android workflow at an immutable tag, verifies
terminal hosted/Junction state, and retires the candidate and identity.

Android reuses the existing hosted-native database, Privy, Junction, and Vercel
lifecycle modules. This is deliberate: there is one cleanup authority and one
set of live rows. The Android and iOS workflows share the historical
`native-ios-hosted-e2e-live` concurrency group, so they cannot reset or attest
the shared identity concurrently. The Android postcondition is platform
specific and requires Junction provider slug `health_connect`; the existing iOS
postcondition remains `apple_health_kit`.

Production deployment events run a separate non-destructive canary. The
controller proves the deployment SHA is protected-main history and that the
current production alias still resolves to that exact SHA before dispatching.

## Private Android dispatch contract

The controller resolves the lightweight tag named by
`NATIVE_ANDROID_E2E_ANDROID_REF` and requires it to resolve directly to
`NATIVE_ANDROID_E2E_ANDROID_EXPECTED_SHA`. Annotated tags, branches, mutable
head selection, and source mismatch fail closed. The dispatched public inputs
are:

- contract version `1`;
- `pr` or `production_canary` mode;
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

### `native-ios-hosted-e2e` (shared PR lifecycle)

The Android controller deliberately uses the existing historical
`native-ios-hosted-e2e` environment. Both native lanes operate the same
dedicated Vercel deployment, database, Junction namespace, and Privy identity,
so those non-exportable credentials have one protected owner rather than
platform-named copies that can drift.

Android adds these variables to the shared environment:

- `NATIVE_ANDROID_E2E_GITHUB_APP_ID`
- `NATIVE_ANDROID_E2E_ANDROID_REPOSITORY_OWNER`
- `NATIVE_ANDROID_E2E_ANDROID_REPOSITORY_NAME`
- `NATIVE_ANDROID_E2E_ANDROID_WORKFLOW`
- `NATIVE_ANDROID_E2E_ANDROID_REF`
- `NATIVE_ANDROID_E2E_ANDROID_EXPECTED_SHA`

Android adds this secret to the shared environment:

- `NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY`

The shared lifecycle remains configured through the existing
`NATIVE_IOS_E2E_*` database, Junction, Privy, and Vercel variables and secrets.
The Android workflow maps those values into the shared lifecycle module without
copying them to another GitHub environment.

The GitHub App installation must be limited to the private Android repository
and grant only Actions write and Contents read. The trusted controller mints
and refreshes repository-scoped installation tokens itself so the documented
dispatch lease and private-run timeout cannot outlive a credential minted
before deployment. It removes the App id and private key from its process
environment immediately after constructing that ephemeral supplier; child
commands and summaries never receive either value. The protected phone must be the
same reusable E.164 identity configured in the Android repository's protected
workflow environment. The shared `NATIVE_IOS_E2E_PRIVY_APP_ID` must identify
the same Privy application as the private Android environment's public app id,
and that Android environment's client id must belong to it. The fixed OTP
remains only in the private Android repository; the shared backend neither
receives nor stores it.

The database URLs name the same explicit E2E/test database. The shared Vercel
custom environment and Junction namespace remain the existing hosted-native
E2E target and namespace; do not provision a second live-row owner for Android.

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
Junction user values. It creates no artifact. Candidate deployments and the
dedicated PR identity are retired in fail-closed finalization even after a
primary failure. Production canaries do not mutate identity lifecycle state.

The private Android workflow owns raw instrumentation output handling: raw SDK,
Gradle, provider, and test results stay in runner-temporary storage, are reduced
to one allowlisted stage summary, and are deleted before completion.

## Bootstrap and source rotation

Apply and land this backend patch first. Its bootstrap pull request cannot run
the new trusted controller from candidate code, so review it independently and
run the deterministic backend tests. Land the Android patch next, create a
protected lightweight tag pointing directly to its reviewed commit, and set
`NATIVE_ANDROID_E2E_ANDROID_REF` plus
`NATIVE_ANDROID_E2E_ANDROID_EXPECTED_SHA` together. Configure the Android
repository environments before enabling the required commit status or
production event canary. Observe one manually approved protected dispatch end
to end before making the status required.

For every Android revision, create a new protected lightweight tag and update
both variables atomically. Never move or recreate an existing tag. A moved,
annotated, branch-backed, or SHA-skewed ref is rejected independently by the
backend dispatcher and private workflow.

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
