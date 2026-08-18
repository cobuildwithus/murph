import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  isFrontendUiPath,
  validateFrontendEvidence,
} from "./check-frontend-evidence.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(
  new URL("./check-frontend-evidence.mjs", import.meta.url),
);
const COMPLETE_HTML = `
<h2>Evidence</h2>
<ul>
<li>Direct: Browser walkthrough of the real settings path.</li>
<li>Coverage: Empty and populated states on a narrow phone; desktop structure did not change.</li>
</ul>
`;

test("detects user-facing UI and excludes reference pages", () => {
  assert.equal(isFrontendUiPath("apps/web/app/home/page.tsx"), true);
  assert.equal(isFrontendUiPath("apps/web/src/components/ui/button.tsx"), true);
  assert.equal(isFrontendUiPath("apps/web/public/brand/hero.svg"), true);
  assert.equal(isFrontendUiPath("apps/web/app/globals.css"), true);
  assert.equal(isFrontendUiPath("apps/web/app/api/settings/route.ts"), false);
  assert.equal(
    isFrontendUiPath("apps/web/app/design/components-content.tsx"),
    false,
  );
  assert.equal(isFrontendUiPath("apps/web/app/screenshots/page.tsx"), false);
  assert.equal(
    isFrontendUiPath("apps/web/test/hosted-settings.test.tsx"),
    false,
  );
});

test("accepts direct frontend evidence without a catalog link or screenshot", () => {
  assert.deepEqual(
    validateFrontendEvidence({
      changedPaths: ["apps/web/app/settings/page.tsx"],
      prBodyHtml: COMPLETE_HTML,
    }),
    {
      errors: [],
      required: true,
      uiPaths: ["apps/web/app/settings/page.tsx"],
    },
  );
});

test("rejects missing, pending, or absent proof", () => {
  assert.deepEqual(
    validateFrontendEvidence({
      changedPaths: ["apps/web/app/settings/page.tsx"],
      prBodyHtml: "<h2>Product UX</h2><p>Ready.</p>",
    }).errors,
    ["Add an `## Evidence` section to the pull request body."],
  );

  assert.deepEqual(
    validateFrontendEvidence({
      changedPaths: ["apps/web/app/settings/page.tsx"],
      prBodyHtml: `
<h2>Evidence</h2>
<ul>
<li>Direct: Evidence is pending.</li>
<li>Coverage: Phone and desktop were not checked.</li>
</ul>
`,
    }).errors,
    [
      "The Evidence section must name direct proof matched to the changed frontend claim.",
      "The Evidence section must explain which states and viewports were checked and why that proof is sufficient.",
    ],
  );
});

test("does not borrow proof from another heading", () => {
  const result = validateFrontendEvidence({
    changedPaths: ["apps/web/app/settings/page.tsx"],
    prBodyHtml: `
<h2>Evidence</h2>
<ul><li>Coverage: Phone settings state at the changed width.</li></ul>
<h2>Notes</h2>
<ul><li>Direct: Browser walkthrough.</li></ul>
`,
  });

  assert.deepEqual(result.errors, [
    "The Evidence section must name direct proof matched to the changed frontend claim.",
  ]);
});

test("skips backend, design, and screenshot-study diffs", () => {
  assert.deepEqual(
    validateFrontendEvidence({
      changedPaths: [
        "apps/web/app/api/settings/route.ts",
        "apps/web/app/design/components-content.tsx",
        "apps/web/app/screenshots/page.tsx",
      ],
      prBodyHtml: "",
    }),
    { required: false },
  );
});

test("CLI validates GitHub-rendered evidence", async () => {
  const fixture = await createCliFixture();
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      requests.push({ authorization: request.headers.authorization, payload });
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        payload.text === "valid" ? COMPLETE_HTML : "<p>No heading</p>",
      );
    });
  });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address === "object");
    const endpoint = `http://127.0.0.1:${address.port}`;

    const valid = await runCli(fixture, endpoint, "valid");
    assert.match(valid.stdout, /Frontend evidence passed/u);

    const invalid = await runCli(fixture, endpoint, "invalid");
    assert.equal(invalid.code, 1);
    assert.match(invalid.stderr, /Add an `## Evidence` section/u);
    assert.equal(requests[0].authorization, "Bearer test-token");
    assert.equal(requests[0].payload.mode, "gfm");
    assert.equal(requests[0].payload.context, "example/murph");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(fixture.directory, { force: true, recursive: true });
  }
});

async function createCliFixture() {
  const directory = await mkdtemp(join(tmpdir(), "murph-frontend-evidence-"));
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  execFileSync(
    "git",
    ["config", "user.email", "codex@users.noreply.github.com"],
    { cwd: directory },
  );
  execFileSync("git", ["config", "user.name", "Codex Test"], {
    cwd: directory,
  });
  await writeFile(join(directory, "README.md"), "fixture\n");
  execFileSync("git", ["add", "README.md"], { cwd: directory });
  execFileSync("git", ["commit", "--quiet", "-m", "base"], { cwd: directory });
  const baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();

  await mkdir(join(directory, "apps/web/app/settings"), { recursive: true });
  await writeFile(
    join(directory, "apps/web/app/settings/page.tsx"),
    "export default function Page() { return null; }\n",
  );
  execFileSync("git", ["add", "apps"], { cwd: directory });
  execFileSync("git", ["commit", "--quiet", "-m", "head"], { cwd: directory });
  const headSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();
  return { baseSha, directory, headSha };
}

async function runCli(fixture, endpoint, markdown) {
  try {
    const result = await execFileAsync(process.execPath, [SCRIPT_PATH], {
      cwd: fixture.directory,
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "example/murph",
        MURPH_GITHUB_MARKDOWN_URL: endpoint,
        MURPH_GITHUB_TOKEN: "test-token",
        MURPH_PR_BASE_SHA: fixture.baseSha,
        MURPH_PR_BODY: markdown,
        MURPH_PR_HEAD_SHA: fixture.headSha,
      },
    });
    return { code: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    return {
      code: error.code,
      stderr: error.stderr,
      stdout: error.stdout,
    };
  }
}
