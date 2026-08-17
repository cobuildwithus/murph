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
  renderedRouteSignature,
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
<li>Desktop screenshot: <a href="https://example.test/desktop.png"><img src="https://example.test/desktop.png" alt="Desktop group usage"></a></li>
<li>Mobile screenshot: <a href="https://example.test/mobile.png"><img src="https://example.test/mobile.png" alt="Mobile group usage"></a></li>
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

test("ignores route metadata edits without hiding rendered UI edits", () => {
  const baseSource = `
import type { Metadata } from "next";
import { Panel } from "@/src/components/panel";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({ title: "Settings" });

export default function Page() {
  return <Panel label="Settings" />;
}
`;
  const metadataOnlySource = `
import type { Metadata } from "next";
import { Panel } from "@/src/components/panel";
import {
  createMurphPageMetadata,
  MURPH_NOINDEX_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  robots: MURPH_NOINDEX_PAGE_ROBOTS,
  title: "Settings",
});

export default function Page() {
  return <Panel label="Settings" />;
}
`;
  const renderedChangeSource = metadataOnlySource.replace(
    'label="Settings"',
    'label="Account settings"',
  );

  assert.equal(
    renderedRouteSignature(baseSource),
    renderedRouteSignature(metadataOnlySource),
  );
  assert.notEqual(
    renderedRouteSignature(baseSource),
    renderedRouteSignature(renderedChangeSource),
  );
});

test("passes rendered design-page proof with both hosted viewports", () => {
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

test("accepts the dedicated consent design catalog and route", () => {
  const result = validateFrontendDesignProof({
    changedPaths: [
      "apps/web/src/components/legal/hosted-legal-consent-card.tsx",
      "apps/web/app/design/consent-content.tsx",
    ],
    prBodyHtml: `
<h2>Design proof</h2>
<ul>
<li>Design page: <code>/design?tab=consent#launch-consent</code></li>
<li>Desktop screenshot: <img src="https://example.test/consent-desktop.svg"></li>
<li>Mobile screenshot: <img src="https://example.test/consent-mobile.svg"></li>
</ul>
`,
  });

  assert.deepEqual(result, {
    errors: [],
    required: true,
    uiPaths: ["apps/web/src/components/legal/hosted-legal-consent-card.tsx"],
  });
});

test("accepts GitHub-rendered attributes and standalone HTML images", () => {
  const result = validateFrontendDesignProof({
    changedPaths: UI_PATHS,
    prBodyHtml: `
<h2 class="heading-element" dir="auto">Design proof</h2>
<ul dir="auto">
<li>Design page: <a href="/design?tab=components#settings">Settings components</a></li>
<li>Desktop screenshot: <img data-canonical-src="https://example.test/desktop.png" src="https://camo.githubusercontent.test/desktop"></li>
<li>Mobile screenshot: <img src="https://example.test/mobile.png"></li>
</ul>
`,
  });

  assert.deepEqual(result.errors, []);
});

test("reports missing catalog, heading, route, and viewport proof", () => {
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
<li>Desktop screenshot: local-only.png</li>
</ul>
`,
    }).errors,
    [
      "The Design proof section must link to `/design?tab=components`, `/design?tab=consent`, or `/design?tab=sections`.",
      "The Design proof section must include a hosted desktop screenshot from the design page.",
      "The Design proof section must include a hosted mobile screenshot from the design page.",
    ],
  );
});

test("does not borrow proof from another H2 section", () => {
  const result = validateFrontendDesignProof({
    changedPaths: UI_PATHS,
    prBodyHtml: `
<h2>Design proof</h2>
<ul><li>Design page: <code>/design?tab=components#settings</code></li></ul>
<h2>Screenshots</h2>
<ul>
<li>Desktop screenshot: <img src="https://example.test/desktop.png"></li>
<li>Mobile screenshot: <img src="https://example.test/mobile.png"></li>
</ul>
`,
  });

  assert.deepEqual(result.errors, [
    "The Design proof section must include a hosted desktop screenshot from the design page.",
    "The Design proof section must include a hosted mobile screenshot from the design page.",
  ]);
});

test("does not borrow proof across an H1 boundary", () => {
  const result = validateFrontendDesignProof({
    changedPaths: UI_PATHS,
    prBodyHtml: `
<h2>Design proof</h2>
<ul><li>Design page: <code>/design?tab=components#settings</code></li></ul>
<h1>Screenshots</h1>
<ul>
<li>Desktop screenshot: <img src="https://example.test/desktop.png"></li>
<li>Mobile screenshot: <img src="https://example.test/mobile.png"></li>
</ul>
`,
  });

  assert.deepEqual(result.errors, [
    "The Design proof section must include a hosted desktop screenshot from the design page.",
    "The Design proof section must include a hosted mobile screenshot from the design page.",
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
- Desktop screenshot: ![Desktop](https://example.test/desktop.png)
- Mobile screenshot: ![Mobile](https://example.test/mobile.png)
`.trim();
  const commentSuffixedFence = `
\`\`\`md
not proof
\`\`\`<!-- hidden -->
## Design proof
- Design page: /design?tab=components#settings
- Desktop screenshot: ![Desktop](https://example.test/desktop.png)
- Mobile screenshot: ![Mobile](https://example.test/mobile.png)
`.trim();
  const commentInsideRawHtml = `
<div>
not proof
<!-- hidden -->
## Design proof
- Design page: /design?tab=components#settings
- Desktop screenshot: ![Desktop](https://example.test/desktop.png)
- Mobile screenshot: ![Mobile](https://example.test/mobile.png)
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
