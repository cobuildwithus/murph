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
<li>Design page: <code>/design?tab=sections#group-usage-funding</code></li>
<li>Evidence: <a href="https://example.test/phone.png"><img src="https://example.test/phone.png" alt="Phone group usage"></a></li>
<li>Coverage: Narrow phone populated and empty states; desktop layout is unchanged because the component keeps its existing width.</li>
</ul>
`;
const UI_PATHS = [
  "apps/web/app/settings/page.tsx",
  "apps/web/app/design/components-content.tsx",
];

test("detects user-facing app and shared component UI paths", () => {
  assert.equal(isFrontendUiPath("apps/web/app/home/page.tsx"), true);
  assert.equal(
    isFrontendUiPath("apps/web/app/(dashboard)/home/home-page-client.tsx"),
    true,
  );
  assert.equal(
    isFrontendUiPath("apps/web/src/components/ui/button.tsx"),
    true,
  );
  assert.equal(
    isFrontendUiPath("apps/web/src/components/charts/chart.css"),
    true,
  );
  for (const extension of [
    "avif", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp",
  ]) {
    assert.equal(isFrontendUiPath(`apps/web/public/brand/hero.${extension}`), true);
  }
  assert.equal(isFrontendUiPath("apps/web/public/robots.txt"), false);
  assert.equal(isFrontendUiPath("apps/web/app/globals.css"), true);
  assert.equal(isFrontendUiPath("apps/web/app/api/settings/route.ts"), false);
  assert.equal(
    isFrontendUiPath("apps/web/app/design/components-content.tsx"),
    false,
  );
  assert.equal(
    isFrontendUiPath("apps/web/test/hosted-group-funding-page.test.tsx"),
    false,
  );
});

test("passes design-page proof with risk-based rendered evidence", () => {
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
});

test("accepts a reasoned walkthrough without a screenshot", () => {
  const result = validateFrontendDesignProof({
    changedPaths: [
      "apps/web/src/components/legal/hosted-legal-consent-card.tsx",
      "apps/web/app/design/consent-content.tsx",
    ],
    prBodyHtml: `
<h2>Design proof</h2>
<ul>
<li>Design page: <code>/design?tab=consent#launch-consent</code></li>
<li>Evidence: Keyboard and screen-reader walkthrough of the existing visual state.</li>
<li>Coverage: Focus order and announcement changed; layout and responsive styles did not change.</li>
</ul>
`,
  });

  assert.deepEqual(result, {
    errors: [],
    required: true,
    uiPaths: ["apps/web/src/components/legal/hosted-legal-consent-card.tsx"],
  });
});

test("accepts GitHub-rendered attributes and a hosted image", () => {
  const result = validateFrontendDesignProof({
    changedPaths: UI_PATHS,
    prBodyHtml: `
<h2 class="heading-element" dir="auto">Design proof</h2>
<ul dir="auto">
<li>Design page: <a href="/design?tab=components#settings">Settings components</a></li>
<li>Evidence: <img data-canonical-src="https://example.test/settings.png" src="https://camo.githubusercontent.test/settings"></li>
<li>Coverage: The changed component at its only fixed-width state.</li>
</ul>
`,
  });

  assert.deepEqual(result.errors, []);
});

test("reports missing catalog, heading, evidence, and coverage", () => {
  assert.deepEqual(
    validateFrontendDesignProof({
      changedPaths: ["apps/web/app/settings/page.tsx"],
      prBodyHtml: "<h2>Summary</h2><p>Settings changed.</p>",
    }).errors,
    [
      "Update the design page component catalog or sections catalog for this frontend UI change.",
      "Add a `## Design proof` section to the pull request body.",
    ],
  );

  assert.deepEqual(
    validateFrontendDesignProof({
      changedPaths: UI_PATHS,
      prBodyHtml: `
<h2>Design proof</h2>
<ul>
<li>Design page: <code>/settings</code></li>
<li>Evidence: None</li>
<li>Coverage: N/A</li>
</ul>
`,
    }).errors,
    [
      "The Design proof section must link to `/design?tab=components`, `/design?tab=consent`, or `/design?tab=sections`.",
      "The Design proof section must include evidence matched to the changed visual, state, interaction, or responsive risk.",
      "The Design proof section must explain which states and viewports were checked and why that evidence is sufficient.",
    ],
  );
});

test("does not borrow proof from another H2 section", () => {
  const result = validateFrontendDesignProof({
    changedPaths: UI_PATHS,
    prBodyHtml: `
<h2>Design proof</h2>
<ul>
<li>Design page: <code>/design?tab=components#settings</code></li>
<li>Coverage: Settings states at their changed width.</li>
</ul>
<h2>Evidence</h2>
<ul>
<li>Evidence: <img src="https://example.test/settings.png"></li>
</ul>
`,
  });

  assert.deepEqual(result.errors, [
    "The Design proof section must include evidence matched to the changed visual, state, interaction, or responsive risk.",
  ]);
});

test("does not borrow proof across an H1 boundary", () => {
  const result = validateFrontendDesignProof({
    changedPaths: UI_PATHS,
    prBodyHtml: `
<h2>Design proof</h2>
<ul>
<li>Design page: <code>/design?tab=components#settings</code></li>
<li>Evidence: Browser walkthrough of the changed settings state.</li>
</ul>
<h1>Coverage</h1>
<ul>
<li>Coverage: Phone and desktop settings states.</li>
</ul>
`,
  });

  assert.deepEqual(result.errors, [
    "The Design proof section must explain which states and viewports were checked and why that evidence is sufficient.",
  ]);
});

test("requires a visible design route or an anchor href", () => {
  const result = validateFrontendDesignProof({
    changedPaths: UI_PATHS,
    prBodyHtml: COMPLETE_HTML.replace(
      "Design page: <code>/design?tab=sections#group-usage-funding</code>",
      'Design page: <a href="/settings" title="/design?tab=components#settings">Settings</a>',
    ),
  });

  assert.deepEqual(result.errors, [
    "The Design proof section must link to `/design?tab=components`, `/design?tab=consent`, or `/design?tab=sections`.",
  ]);
});

test("skips backend-only and design-catalog-only hosted Web diffs", () => {
  assert.deepEqual(
    validateFrontendDesignProof({
      changedPaths: [
        "apps/web/app/api/settings/route.ts",
        "apps/web/src/lib/hosted-onboarding/service.ts",
      ],
      prBodyHtml: "",
    }),
    { required: false },
  );
  assert.deepEqual(
    validateFrontendDesignProof({
      changedPaths: [
        "apps/web/app/design/components-content.tsx",
        "apps/web/app/design/group-usage-funding-study.tsx",
      ],
      prBodyHtml: "",
    }),
    { required: false },
  );
});

test("actual CLI trusts rendered GFM for composed Markdown cases", async () => {
  const fixture = await createCliFixture();
  const hiddenHeading = `
##<!-- hidden -->Design proof

- Design page: /design?tab=components#settings
- Evidence: ![Settings](https://example.test/settings.png)
- Coverage: Changed settings state at its only affected width.
`.trim();
  const commentSuffixedFence = `
\`\`\`md
not proof
\`\`\`<!-- hidden -->
## Design proof
- Design page: /design?tab=components#settings
- Evidence: ![Settings](https://example.test/settings.png)
- Coverage: Changed settings state at its only affected width.
`.trim();
  const commentInsideRawHtml = `
<div>
not proof
<!-- hidden -->
## Design proof
- Design page: /design?tab=components#settings
- Evidence: ![Settings](https://example.test/settings.png)
- Coverage: Changed settings state at its only affected width.
`.trim();
  const renderedByMarkdown = new Map([
    ["visible", COMPLETE_HTML],
    [hiddenHeading, "<p>##Design proof</p>"],
    [commentSuffixedFence, "<pre><code>## Design proof</code></pre>"],
    [commentInsideRawHtml, "<div>## Design proof</div>"],
  ]);
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      requests.push({
        authorization: request.headers.authorization,
        payload,
      });
      if (payload.text === "renderer-error") {
        response.writeHead(503);
        response.end("Unavailable");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(renderedByMarkdown.get(payload.text) ?? "<p>Unknown</p>");
    });
  });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address === "object");
    const endpoint = `http://127.0.0.1:${address.port}`;

    const visible = await runCli(fixture, endpoint, "visible");
    assert.match(visible.stdout, /Frontend design proof passed/u);

    const composedBodies = [
      hiddenHeading,
      commentSuffixedFence,
      commentInsideRawHtml,
    ];
    for (const markdown of composedBodies) {
      const hidden = await runCli(fixture, endpoint, markdown);
      assert.equal(hidden.code, 1);
      assert.match(hidden.stderr, /Add a `## Design proof` section/u);
    }

    const rendererFailure = await runCli(fixture, endpoint, "renderer-error");
    assert.equal(rendererFailure.code, 1);
    assert.match(
      rendererFailure.stderr,
      /GitHub Markdown rendering failed \(503\)\./u,
    );

    assert.deepEqual(
      requests.map(({ payload }) => payload.text),
      ["visible", ...composedBodies, "renderer-error"],
    );
    for (const request of requests) {
      assert.equal(request.authorization, "Bearer test-token");
      assert.equal(request.payload.mode, "gfm");
      assert.equal(request.payload.context, "example/murph");
    }
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
  execFileSync("git", ["config", "user.email", "codex@users.noreply.github.com"], {
    cwd: directory,
  });
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
  await mkdir(join(directory, "apps/web/app/design"), { recursive: true });
  await writeFile(
    join(directory, "apps/web/app/settings/page.tsx"),
    "export default function Page() { return null; }\n",
  );
  await writeFile(
    join(directory, "apps/web/app/design/components-content.tsx"),
    "export function ComponentsContent() { return null; }\n",
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
    return { code: 0, ...result };
  } catch (error) {
    return {
      code: error.code,
      stderr: error.stderr,
      stdout: error.stdout,
    };
  }
}
