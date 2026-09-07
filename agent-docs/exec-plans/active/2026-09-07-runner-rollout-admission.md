# Runner rollout admission and architecture correction

## Outcome

Complete safe runner releases without deployment-induced foreground waits or an
incidental reduction in supported serving capacity. Prefer native Cloudflare
ordering and existing runtime owners over extra allocation or retry machinery.

## Evidence and open questions

- The preceding change separated serving and candidate image targets and proved
  the original image-fingerprint mismatch in the actual readiness owner.
- Native creation of the inactive application failed quota admission before
  promotion. Local tests and previous reviews did not cover that constraint.
- An application creation quota error does not establish whether application
  ceilings reserve additive quota. Verify actual account limits and native
  behavior before deciding the capacity or architecture correction.
- The uploaded staging controller retains the existing serving release. Use a
  safe forward migration; do not change live ceilings or roll back implicitly.

## Work

1. Obtain the requested ReviewGPT architecture consultation against the guarded
   full snapshot; independently verify its relevant platform claims.
2. Read authoritative native account admission metadata through protected CI.
3. Implement the smallest supported correction, deleting superseded machinery.
4. Reproduce failed admission, delayed image availability, retained sessions,
   warm inventory, and repeated deployments at the composed owners.
5. Run relevant tests, typecheck, complexity checks, exact-head CI and final
   ReviewGPT; merge with the approved commit identity and deploy.
6. Verify live release state and bounded runtime health before claiming success.

## Product and verification

Journeys: a message during image preparation; an existing session during release;
an idle or new member after promotion; failed publication/admission; and the next
release reusing retained state. Readiness is Hold until the chosen implementation
has direct local proof and production release verification. No provider input or
assistant behavior change is intended.

## Progress

- Architecture consultation running. No live capacity reductions applied.
