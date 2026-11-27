# GitHub App signing in CI

`scripts/github-app-token.mjs` owns GitHub App JWT signing and scoped installation
token acquisition. Trusted GitHub jobs request an OIDC subject for the
`github-actions/github` WIF provider in Google project `murph-495013` (number
`662258957089`), exchange it at Google STS, and sign a SHA-256 digest through KMS.
There is no service-account impersonation, local PEM signing, or static-key
fallback. Each installation-token mint reacquires the subject and Google bearer;
neither credential is captured for an entire long-running controller.

All credential requests have a 20-second deadline, reject redirects, and suppress
provider error bodies. Signing checks the digest verification flag, exact key
version, signature CRC32C and 2048-bit RSA signature length. App JWTs use RS256,
backdate `iat` by 60 seconds, and expire nine minutes after that `iat`. Existing
numeric App IDs and Frog's client ID remain in their existing Actions variables.

The renewable supplier discovers the installation once, mints only explicit
repository names and permissions, and refreshes two minutes before `expires_at`.
Android and wearable controllers call it for each private GitHub request, so
observation and Android cancellation can continue beyond one hour. Wearable's
private execution and cleanup ownership remain unchanged; the public controller
does not cancel its private run.

Short consumers use `.github/actions/github-app-token`, a dependency-free Node 24
action using that same supplier. Its inputs are `app-id`, `key-version`, `owner`,
`repositories` (comma or newline separated names), and `permissions` (JSON).
The action masks the installation token, writes it to output and action state,
then revokes it with `DELETE /installation/token` in an `always()` post step.
If output/state persistence fails after minting, it attempts immediate revocation.
Runner loss can prevent any post step; GitHub's issued token expiry still applies.

## Provisioning and rollout

The global `github-apps` keyring uses these import-only
`RSA_SIGN_PKCS1_2048_SHA256` keys. Workflows commit the full version-1 resource;
update that resource explicitly if an import creates a different version.

| Key | Workflow on `refs/heads/main` | Minting job |
| --- | --- | --- |
| `frog-app` | `friction-log.yml` | `friction-log` |
| `frog-app` | `clinical-provider-directory.yml` | `publish`, `merge` |
| `temporal-compatibility-app` | `temporal-compatibility.yml` | `compatibility` |
| `temporal-compatibility-app` | `temporal-web-deployment-admission.yml` | `admission` |
| `temporal-compatibility-app` | `junction-wearable-canary.yml` | `connect` |
| `native-android-e2e-app` | `native-android-hosted-e2e.yml` | `production-canary` |
| `native-ios-e2e-app` | `native-ios-hosted-e2e.yml` | `production-canary` |

Grant `roles/cloudkms.signer` on each key to each listed workflow's exact member:
`principalSet://iam.googleapis.com/projects/662258957089/locations/global/workloadIdentityPools/github-actions/attribute.workflow_ref/cobuildwithus/murph/.github/workflows/<file>@refs/heads/main`.
No repository-wide or pull-request-ref grant is needed. `workflow_run`, issues,
and schedules use the default branch; push is main-only, and manual dispatch is
guarded to main. Only minting jobs have `id-token: write`. These jobs execute
trusted main controllers; Temporal receives PR fixtures as data, never PR code.

Before merging, the owner must import the correct GitHub-issued key for each App
and grant those IAM bindings. Missing versions or bindings fail closed, blocking
Frog, native/wearable canaries, Temporal compatibility and Web production admission.
Keep existing App IDs, installations, repository permissions and protected
environments. No Vercel or runtime deployment is needed for this tooling change.

After hosted verification and draining older workflow runs, remove the now-unused
GitHub secrets `FROG_APP_PRIVATE_KEY`,
`TEMPORAL_COMPATIBILITY_GITHUB_APP_PRIVATE_KEY`,
`NATIVE_ANDROID_E2E_GITHUB_APP_PRIVATE_KEY` and
`NATIVE_IOS_E2E_GITHUB_APP_PRIVATE_KEY`. Importing a key changes custody, not its
GitHub identity: do not revoke the GitHub key that KMS uses. For rotation, import
a newly generated GitHub key, verify it, then revoke only the distinct old key.

## Owner import helper

Run `bash scripts/import-signing-key-to-kms.sh KMS_KEY_RESOURCE ALGORITHM PEM_PATH`
once per key, from encrypted local storage. The resource excludes the version;
the algorithm is `rsa-sign-pkcs1-2048-sha256` or `ec-sign-p256-sha256`.
The helper reuses an active, matching-protection import job or creates one with
`rsa-oaep-3072-sha1-aes-256`, converts the PEM to PKCS#8 DER in a private temporary
directory, and imports it. It prints only the created version name and state.
Wait for `ENABLED` before switching a consumer. Temporary DER is overwritten and
unlinked on exit; SSD/COW storage cannot guarantee physical overwrite. The owner
retains responsibility for the original PEM, which the helper does not delete.

`gcloud --target-key-file` requires pyca/cryptography in the Python interpreter
gcloud uses. The helper checks for `aes_key_wrap_with_padding` and enables
`CLOUDSDK_PYTHON_SITEPACKAGES=1`; it does not install packages. Set
`CLOUDSDK_PYTHON` explicitly if necessary. See Google's
[import guide](https://docs.cloud.google.com/kms/docs/importing-a-key) and
[cryptography setup](https://docs.cloud.google.com/kms/docs/crypto).

## Verification

`node --test scripts/github-app-token.test.mjs scripts/native-android-hosted-e2e.test.mjs scripts/github-wearable-canary.test.mjs`
uses fake OIDC, STS, KMS and GitHub endpoints. It verifies real RSA signatures from
an ephemeral test key, integrity failures, refreshed Google subjects during
59/62-minute journeys, scoped issuance, authorized Android cancellation, and
action revocation on success and failure. Repo Hygiene runs these tests. Local
tests do not prove deployed IAM or imported key identity.
