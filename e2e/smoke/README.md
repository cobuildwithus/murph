# Scenario Integrity

This directory is primarily the fixture/scenario-manifest integrity lane, not an
end-to-end executable smoke suite.

Each scenario manifest maps one documented baseline command to:

- a vault fixture
- any prerequisite input files
- a golden-output directory documenting the current expected contract shape

`verify-scenario-integrity.ts` is the real verifier for that contract.
`verify-fixtures.ts` remains as a compatibility wrapper for older call sites,
and the current root command surface still exposes the historical
`pnpm test:smoke` alias for this lane.

If this directory grows a true executable smoke lane later, keep it separate
from manifest integrity and keep it to a tiny representative command set.
