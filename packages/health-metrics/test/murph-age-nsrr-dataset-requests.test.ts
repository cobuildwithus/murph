import assert from "node:assert/strict";

import { test } from "vitest";

import {
  MURPH_AGE_NSRR_DATASET_REQUEST_SCHEMA_VERSION,
  listMurphAgeNsrrDatasetRequests,
  resolveMurphAgeSourceRoute,
} from "@murphai/health-metrics/murph-age-source-routes";

test("lists NSRR dataset requests as model-unblocker checklist without authorizing row parsing", () => {
  const requests = listMurphAgeNsrrDatasetRequests();

  assert.deepEqual(requests.map((request) => request.datasetId), [
    "mesa-sleep",
    "hchs-sol",
    "shhs",
    "mros-sleep",
    "sof-sleep",
    "wsc",
    "haassa",
  ]);
  assert.deepEqual(
    requests.filter((request) => request.includeInLeanRequest).map((request) => request.datasetId),
    ["mesa-sleep", "hchs-sol", "shhs", "mros-sleep", "sof-sleep"],
  );
  assert.deepEqual(requests.slice(0, 3).map((request) => request.requestTier), [
    "primary",
    "primary",
    "primary",
  ]);

  for (const request of requests) {
    assert.equal(request.schemaVersion, MURPH_AGE_NSRR_DATASET_REQUEST_SCHEMA_VERSION);
    assert.equal(request.productAuthorized, false);
    assert.equal(request.rowParsingAuthorized, false);
    assert.equal(resolveMurphAgeSourceRoute(request.sourceRouteId)?.productAuthorized, false);
    assert.ok(request.modelUnblockerRoles.length >= 2);
    assert.ok(request.recommendedDownloadTargets.every((target) => /^[a-z0-9-]+\/[a-z0-9-]+$/u.test(target)));
    assert.equal(request.nextLocalCheckCommand.includes("r1076-current-autoresearch-loop-executor"), true);
  }

  const mesa = requests[0];
  assert.equal(mesa?.requestCheckboxLabel, "Multi-Ethnic Study of Atherosclerosis");
  assert.deepEqual(mesa?.recommendedDownloadTargets, ["mesa/datasets", "mesa/actigraphy"]);
  assert.equal(mesa?.sourceRouteId, "nsrr-mesa-sleep-autonomic");

  const hchs = requests[1];
  assert.equal(hchs?.requestCheckboxLabel, "Hispanic Community Health Study / Study of Latinos");
  assert.deepEqual(hchs?.recommendedDownloadTargets, ["hchs/datasets", "hchs/actigraphy"]);

  if (requests[0]) {
    requests[0].modelUnblockerRoles.push("mutated");
    requests[0].recommendedDownloadTargets.push("bad/target");
  }
  const freshRequests = listMurphAgeNsrrDatasetRequests();
  assert.equal(freshRequests[0]?.modelUnblockerRoles.includes("mutated"), false);
  assert.equal(freshRequests[0]?.recommendedDownloadTargets.includes("bad/target"), false);
});
