# Address-book production unblock

## Outcome

Make the optional iOS contact-sharing flow usable in production and raise the
closed projection limit from 512 to 1,000 contacts.

## Proven root cause

The production Web project has none of the three address-book rollout
variables configured. Status therefore reports replacement disabled and the
iOS app truthfully shows the temporary-unavailability message before reading
or uploading contacts.

## Scope

- Raise the Web and iOS projection cap to 1,000.
- Increase the Web request-body ceiling enough for 1,000 maximum-size rows.
- Keep the existing closed schema, bounded contact inspection, privacy model,
  KMS tokenization, CAS replacement, and deletion lifecycle unchanged.
- Update the current security/product contract and focused tests.
- Provision the documented dedicated production KMS MAC key and open only the
  replacement gate after the compatible Web deployment is live.
- Keep advisory-name reads off until the already-documented end-to-end
  consumer proof is complete.

## Verification

- Focused Web projection and route tests.
- Canonical diff verification and acceptance checks.
- Focused iOS address-book and API client tests plus Release build.
- Production status proof that replacement is enabled without exposing
  configuration values.
- Required preliminary and final ReviewGPT gates for each PR lane.

