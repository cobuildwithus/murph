import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { test } from "vitest";

interface HostedWebPackageJson {
  scripts?: Record<string, string>;
}

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as HostedWebPackageJson;

test("viewport overflow prepares generated inputs before Playwright readiness", () => {
  const viewportScript = packageJson.scripts?.["test:viewport-overflow"] ?? "";
  const prerequisites = [
    "pnpm legal:pdf",
    "pnpm changelog:generate",
    "pnpm health-commons:generate",
    "pnpm prisma:generate",
  ];
  let previousIndex = -1;

  for (const prerequisite of prerequisites) {
    const prerequisiteIndex = viewportScript.indexOf(prerequisite);
    assert.equal(
      viewportScript.split(prerequisite).length - 1,
      1,
      `${prerequisite} must run exactly once`,
    );
    assert.ok(
      prerequisiteIndex > previousIndex,
      `${prerequisite} must stay in prerequisite order`,
    );
    previousIndex = prerequisiteIndex;
  }

  const preparedMarkerIndex = viewportScript.indexOf(
    "MURPH_PLAYWRIGHT_GENERATED_INPUTS_PREPARED=1",
  );
  assert.ok(
    preparedMarkerIndex > previousIndex,
    "the prepared-input marker must be set only after generation completes",
  );
  assert.ok(
    viewportScript.indexOf("playwright test") > preparedMarkerIndex,
    "Playwright must start only after generated prerequisites complete",
  );

  const playwrightConfig = readFileSync(
    new URL("../playwright.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    playwrightConfig,
    /MURPH_PLAYWRIGHT_GENERATED_INPUTS_PREPARED === "1"[\s\S]*?\? "dev:prepared-local-env"[\s\S]*?: "dev:local-env"/u,
  );
  assert.match(
    playwrightConfig,
    /command: `pnpm \$\{devCommand\} --hostname \$\{host\} --port \$\{port\}`/u,
  );
  assert.match(playwrightConfig, /timeout: 240_000/u);

  const preparedDevScript = packageJson.scripts?.["dev:prepared-local-env"] ?? "";
  for (const prerequisite of prerequisites) {
    assert.equal(
      preparedDevScript.includes(prerequisite),
      false,
      `${prerequisite} must stay outside the Playwright readiness timer`,
    );
  }
});

test("calendar overflow proof retains its cold first-compile allowance", () => {
  const viewportSpec = readFileSync(
    new URL("../e2e/viewport-overflow.spec.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    viewportSpec,
    /test\("calendar links wrap maximum unbroken event text"[\s\S]*?test\.setTimeout\(240_000\);/u,
  );
});
