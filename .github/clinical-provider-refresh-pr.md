## Why and outcome

Update the public facilities members can find when connecting medical records.

## Product UX

- Effort: Patch
- Result: Ready
- Walkthrough: Search uses the refreshed registry and the existing portal flow.

## Evidence

- Direct: The importer parsed the source bundle and the candidate artifact.
- Coverage: Count floors compare brands, facilities and geocoded facilities with the prior snapshot.

## Non-obvious affected surfaces

Existing entries keep their published FHIR endpoints, so existing connections still reconnect. Endpoint changes, removals and new-host entries wait in the "Clinical directory changes need review" issue.

## Hot reply path impact

- Path status: Not applicable. The directory serves explicit searches.
- Database calls: None.
- Network/provider calls: None.
- Other awaited latency: None.
- Before/after proof: Only the public directory artifact changes.

## Murph initial provider input impact

Not applicable for individual and group conversations. The directory supplies no model input.

## Deployment concerns

- Deployment: applicable
- Supported skew: Each Web deployment bundles its validated directory.
- Safe order: Protected merge followed by ordinary Web deployment.
- Rollback floor: The previous directory and its bundled reader.
- Expected exposure: Results can change as facilities join or leave.
- Reversibility: Revert the directory update.
- Convergence proof: The importer validates the committed shape.
- Post-deploy checks: Verify a public facility resolves in provider search.

## Changelog

- Changelog: not applicable
- Reason: Routine source-data refresh within the existing search feature.

ReviewGPT context sensitivity: sensitive
