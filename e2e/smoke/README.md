# Scenario Integrity

This directory is primarily the fixture/scenario-manifest integrity lane, not an
end-to-end executable smoke suite.

Each scenario manifest maps one documented baseline command to:

- a vault fixture
- any prerequisite input files
- a golden-output directory documenting the current expected contract shape

`verify-scenario-integrity.ts` is the verifier for that contract, exposed as
`pnpm test:scenario-integrity`.

If this directory grows a true executable smoke lane later, keep it separate
from manifest integrity and keep it to a tiny representative command set.
