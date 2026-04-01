import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { test } from "vitest";

import {
  ensureNextRouteTypeStub,
  extractNextRouteTypesImport,
} from "../../../scripts/ensure-next-route-type-stubs";

test("extractNextRouteTypesImport finds the tracked Next route-types import", () => {
  assert.equal(
    extractNextRouteTypesImport('import "./.next-smoke/dev/types/routes.d.ts";\n'),
    "./.next-smoke/dev/types/routes.d.ts",
  );
  assert.equal(extractNextRouteTypesImport('/// <reference types="next" />\n'), null);
});

test("ensureNextRouteTypeStub materializes the referenced route-types file when it is missing", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "murph-next-route-stubs-"));
  const nextEnvPath = path.join(tempRoot, "next-env.d.ts");
  const expectedStubPath = path.join(tempRoot, ".next-smoke/dev/types/routes.d.ts");
  const expectedRuntimeStubPath = path.join(tempRoot, ".next-smoke/dev/types/routes.js");

  await writeFile(
    nextEnvPath,
    [
      '/// <reference types="next" />',
      '/// <reference types="next/image-types/global" />',
      'import "./.next-smoke/dev/types/routes.d.ts";',
      "",
    ].join("\n"),
    "utf8",
  );

  const actualStubPath = await ensureNextRouteTypeStub(nextEnvPath);

  assert.equal(actualStubPath, expectedStubPath);
  assert.equal(
    await readFile(expectedStubPath, "utf8"),
    "// Auto-generated route-type stub for clean typecheck flows.\nexport {};\n",
  );
  assert.equal(
    await readFile(expectedRuntimeStubPath, "utf8"),
    "// Auto-generated route-type runtime stub for clean typecheck flows.\nexport {};\n",
  );
});
