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
  validateFrontendDesignProof,
} from "./check-frontend-design-proof.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(
  new URL("./check-frontend-design-proof.mjs", import.meta.url),
);
const COMPLETE_HTML = `
<h2>Design proof</h2>
<ul>
<li>Design page: <a href="https://preview.example.test/screenshots/settings#settings-model-provider-save-controls">Settings states</a></li>
<li>Evidence: Browser walkthrough of the rendered settings states.</li>
<li>Coverage: Empty and populated states on a narrow phone; desktop structure is unchanged.</li>
</ul>
`;
const UI_PATHS = ["apps/web/app/settings/page.tsx"];
const DESTINATION_ERROR =
  "The Design proof section must include a reviewer-openable link with a fragment to `/design?tab=components`, `/design?tab=consent`, or `/screenshots/<category>`.";

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
  assert.equal(isFrontendUiPath("apps/web/test/hosted-settings.test.tsx"), false);
});

test("requires dedicated proof while accepting an existing live representation", () => {
  assert.deepEqual(
    validateFrontendDesignProof({
      changedPaths: UI_PATHS,
      prBodyHtml: COMPLETE_HTML,
    }),
    {
      errors: [],
      required: true,
      uiPaths: ["apps/web/app/settings/page.tsx"],
    },
  );

  assert.deepEqual(
    validateFrontendDesignProof({
      changedPaths: ["apps/web/app/settings/page.tsx"],
      prBodyHtml: "<h2>Evidence</h2><p>Settings changed.</p>",
    }).errors,
    ["Add a `## Design proof` section to the pull request body."],
  );
});

test("accepts a reasoned walkthrough without a screenshot", () => {
  assert.deepEqual(
    validateFrontendDesignProof({
      changedPaths: [
        "apps/web/src/components/legal/hosted-legal-consent-card.tsx",
      ],
      prBodyHtml: `
<h2>Design proof</h2>
<ul>
<li>Design page: <a href="https://preview.example.test/design?tab=consent#launch-consent">Launch consent states</a></li>
<li>Evidence: Keyboard and screen-reader walkthrough of the existing visual state.</li>
<li>Coverage: Focus order changed; layout and responsive styles did not change.</li>
</ul>
`,
    }).errors,
    [],
  );
});

test("requires an actual anchored destination owned by the current routes", () => {
  const invalidDesignItems = [
    "<code>/design?tab=components#settings</code>",
    "https://preview.example.test/design?tab=components#settings",
    '<a href="https://preview.example.test/not-design">/design?tab=components#settings</a>',
    '<a href="https://preview.example.test/design?tab=components">Components</a>',
    '<a href="https://preview.example.test/design?tab=sections#settings">Stale sections tab</a>',
    '<a href="/design?tab=components#settings">Relative GitHub destination</a>',
  ];

  for (const designItem of invalidDesignItems) {
    const result = validateFrontendDesignProof({
      changedPaths: UI_PATHS,
      prBodyHtml: COMPLETE_HTML.replace(
        /<a href="[^"]+">Settings states<\/a>/u,
        designItem,
      ),
    });
    assert.deepEqual(result.errors, [DESTINATION_ERROR]);
  }

  const componentsProof = COMPLETE_HTML.replace(
    "https://preview.example.test/screenshots/settings#settings-model-provider-save-controls",
    "https://preview.example.test/design?tab=components#assistant-provider-picker",
  );
  assert.deepEqual(
    validateFrontendDesignProof({
      changedPaths: UI_PATHS,
      prBodyHtml: componentsProof,
    }).errors,
    [],
  );
});

test("rejects missing, pending, or misplaced proof", () => {
  assert.deepEqual(
    validateFrontendDesignProof({
      changedPaths: UI_PATHS,
      prBodyHtml: `
<h2>Design proof</h2>
<ul>
<li>Design page: <code>/settings</code></li>
<li>Evidence: Evidence is pending.</li>
<li>Coverage: Phone and desktop were not checked.</li>
</ul>
`,
    }).errors,
    [
      DESTINATION_ERROR,
      "The Design proof section must include evidence matched to the changed visual, state, interaction, or responsive risk.",
      "The Design proof section must explain which states and viewports were checked and why that evidence is sufficient.",
    ],
  );

  assert.deepEqual(
    validateFrontendDesignProof({
      changedPaths: UI_PATHS,
      prBodyHtml: `
<h2>Design proof</h2>
<ul>
<li>Design page: <a href="https://preview.example.test/screenshots/settings#settings-model-provider-save-controls">Settings states</a></li>
<li>Coverage: Settings states at the changed width.</li>
</ul>
<h2>Evidence</h2>
<ul><li>Evidence: Browser walkthrough.</li></ul>
`,
    }).errors,
    [
      "The Design proof section must include evidence matched to the changed visual, state, interaction, or responsive risk.",
    ],
  );
});

test("skips backend, catalog, and screenshot-study diffs", () => {
  assert.deepEqual(
    validateFrontendDesignProof({
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

test("CLI validates GitHub-rendered design proof", async () => {
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
    assert.match(valid.stdout, /Frontend design proof passed/u);

    const invalid = await runCli(fixture, endpoint, "invalid");
    assert.equal(invalid.code, 1);
    assert.match(invalid.stderr, /Add a `## Design proof` section/u);
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
  const directory = await mkdtemp(join(tmpdir(), "murph-design-proof-"));
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], {
    cwd: directory,
  });
  execFileSync("git", ["config", "user.name", "Test Fixture"], {
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
