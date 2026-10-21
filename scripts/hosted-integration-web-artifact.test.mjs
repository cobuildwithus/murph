import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { webArtifactIdentity } from "./hosted-integration-web-artifact.mjs";

const env = { GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "101", GITHUB_RUN_ATTEMPT: "2",
  GITHUB_REPOSITORY: "cobuildwithus/murph", GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" };

test("binds the artifact to a public main-push source and attempt", () => {
  assert.deepEqual(webArtifactIdentity(env), { contract: "hosted-integration-web-v1", sha: env.GITHUB_SHA,
    runId: 101, runAttempt: 2, platform: "linux", arch: "x64", nodeMajor: 24 });
});

for (const [field, value] of Object.entries({ GITHUB_SHA: "main", GITHUB_RUN_ID: "0", GITHUB_RUN_ATTEMPT: "-1",
  GITHUB_REPOSITORY: "example/fork", GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/heads/feature" })) {
  test(`rejects publication with invalid ${field}`, () => {
    assert.throws(() => webArtifactIdentity({ ...env, [field]: value }));
  });
}

test("publishes only public integration output before creating private credentials or dispatching paid proof", async () => {
  const workflow = await readFile(new URL("../.github/workflows/temporal-web-deployment-admission.yml", import.meta.url), "utf8");
  const build = workflow.indexOf("      - name: Build public hosted integration Web dist");
  const upload = workflow.indexOf("      - name: Publish public hosted integration Web dist");
  const mint = workflow.indexOf("      - name: Mint private compatibility token");
  const dispatch = workflow.indexOf("      - name: Prove exact public main against private Temporal and hosted runtime");
  assert.ok(build > 0 && upload > build && mint > upload && dispatch > mint);
  const producer = workflow.slice(build, mint);
  assert.doesNotMatch(producer, /secrets\.|vars\.|materialize\.mjs/u);
  assert.match(producer, /NEXT_DIST_DIR_MODE: smoke/u);
  assert.match(producer, /NEXT_DIST_DIR_SUFFIX: murph-cloud-integration/u);
  assert.match(producer, /NEXT_PUBLIC_PRIVY_APP_ID: cm_app_smoke_placeholder1/u);
  assert.match(producer, /pnpm --dir packages\/hosted-execution build/u);
  assert.match(producer, /pnpm --dir apps\/web build/u);
  assert.match(producer, /retention-days: 1/u);
  assert.match(producer, /compression-level: 0/u);
  assert.match(producer, /if-no-files-found: error/u);
  assert.match(producer, /name: hosted-integration-web-v1-\$\{\{ github.sha \}\}-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/u);
});

test("optional setup failures and timeouts leave mandatory private proof reachable", async () => {
  const workflow = await readFile(new URL("../.github/workflows/temporal-web-deployment-admission.yml", import.meta.url), "utf8");
  const step = (name) => workflow.split(`      - name: ${name}\n`)[1]?.split("\n      - name:")[0];
  const optional = ["Setup pnpm for public integration Web build", "Cache public integration dependencies", "Build public hosted integration Web dist", "Publish public hosted integration Web dist"];
  let optionalMinutes = 0;
  for (const name of optional) {
    const declaration = step(name);
    assert.match(declaration, /continue-on-error: true/u, `${name} must not abort admission`);
    optionalMinutes += Number(declaration.match(/timeout-minutes: ([0-9]+)/u)?.[1]);
  }
  assert.equal(optionalMinutes, 15);
  // A failed pnpm bootstrap skips both dependent setup and compilation. A
  // cache failure still permits compilation; a failed/timed-out build skips upload.
  for (const name of optional.slice(1, 3)) {
    assert.match(step(name), /if: steps.public-pnpm.outcome == 'success'/u);
  }
  assert.match(step(optional[3]), /if: steps.public-web-build.outcome == 'success'/u);
  let requiredMinutes = 0;
  for (const name of ["Publish pending Web admission status", "Check out exact public main revision", "Setup Node", "Execute exact production wire projection"]) {
    const declaration = step(name);
    requiredMinutes += Number(declaration.match(/timeout-minutes: ([0-9]+)/u)?.[1]);
    assert.doesNotMatch(declaration, /continue-on-error|\n        if:/u);
  }
  for (const name of ["Execute exact production wire projection", "Mint private compatibility token", "Prove exact public main against private Temporal and hosted runtime"]) {
    assert.doesNotMatch(step(name), /continue-on-error|\n        if:/u);
  }
  const jobMinutes = Number(workflow.match(/    timeout-minutes: ([0-9]+)/u)?.[1]);
  assert.equal(requiredMinutes + optionalMinutes + 58 + 2, jobMinutes);
});
