import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  isFrontendUiChange,
  isFrontendUiPath,
  isStaticMetadataOnlyRouteChange,
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
const COMPLETION_WORKFLOW = readFileSync(
  new URL("../agent-docs/operations/completion-workflow.md", import.meta.url),
  "utf8",
);
const HOSTED_WORKTREE_GUIDE = readFileSync(
  new URL(
    "../agent-docs/operations/hosted-local-worktree-dev.md",
    import.meta.url,
  ),
  "utf8",
);

function documentedEvidenceExamples() {
  return [...COMPLETION_WORKFLOW.matchAll(
    /```markdown\n([\s\S]*?)\n\s*```/gu,
  )]
    .map((match) => match[1])
    .filter((example) => example.trimStart().startsWith("## Evidence"));
}

function renderDocumentedEvidenceExample(markdown) {
  const [heading, ...bodyLines] = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  assert.equal(heading, "## Evidence");
  return `
<h2>Evidence</h2>
<ul>
${bodyLines
  .map((line) => {
    assert.match(line, /^- /u);
    return `<li>${line.slice(2)}</li>`;
  })
  .join("\n")}
</ul>
`;
}

function frontendOnlyWorktreeCommand() {
  const match = /For frontend-only work[\s\S]*?```bash\n([\s\S]*?)\n```/u.exec(
    HOSTED_WORKTREE_GUIDE,
  );
  assert.ok(match);
  return match[1];
}

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

test("completion workflow documents the exact frontend evidence labels", () => {
  const examples = documentedEvidenceExamples();
  assert.equal(examples.length, 1);
  assert.deepEqual(
    validateFrontendEvidence({
      changedPaths: ["apps/web/app/settings/page.tsx"],
      prBodyHtml: renderDocumentedEvidenceExample(examples[0]),
    }),
    {
      errors: [],
      required: true,
      uiPaths: ["apps/web/app/settings/page.tsx"],
    },
  );
});

test("frontend-only worktree command pins every hosted public URL locally", () => {
  const command = frontendOnlyWorktreeCommand();
  for (const expected of [
    "DEVICE_SYNC_PUBLIC_BASE_URL='http://localhost:3101/api/device-sync'",
    "HOSTED_ONBOARDING_PUBLIC_BASE_URL='http://localhost:3101'",
    "HOSTED_ONBOARDING_ALLOWED_MUTATION_ORIGINS='http://localhost:3101,http://127.0.0.1:3101'",
    "HOSTED_WEB_BASE_URL='http://localhost:3101'",
  ]) {
    assert.match(
      command,
      new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    );
  }
  assert.match(command, /pnpm dev -- --hostname 127\.0\.0\.1 --port 3101/u);
});

test("exempts only isolated static route metadata from rendered proof", () => {
  const baseSource = `import { PitchDeck } from "./pitch-deck";

export default function Page() {
  return <PitchDeck />;
}
`;
  const headSource = `import type { Metadata } from "next";
import { PitchDeck } from "./pitch-deck";

export const metadata: Metadata = {
  alternates: { canonical: "/pitch-deck" },
  description: "A public pitch deck.",
  title: "Pitch deck",
};

export default function Page() {
  return <PitchDeck />;
}
`;
  const change = {
    baseSource,
    headSource,
    path: "apps/web/app/pitch-deck/page.tsx",
  };

  assert.equal(isStaticMetadataOnlyRouteChange(change), true);
  assert.equal(isFrontendUiChange(change), false);
  assert.deepEqual(
    validateFrontendEvidence({ changedFiles: [change], prBodyHtml: "" }),
    { required: false },
  );

  assert.equal(
    isStaticMetadataOnlyRouteChange({
      baseSource: headSource,
      headSource: headSource.replace("Pitch deck", "Pitch deck for teams"),
      path: change.path,
    }),
    true,
  );
});

test("keeps rendered, shared, dynamic, and viewport metadata changes in proof", () => {
  const path = "apps/web/app/pitch-deck/page.tsx";
  const baseSource = `export const metadata = { title: "Before" };

export default function Page() {
  return <h1>Before</h1>;
}
`;
  const cases = [
    `export const metadata = { title: "After" };

export default function Page() {
  return <h1>After</h1>;
}
`,
    `export const metadata = { title: "After" };

export default function Page() {
  return <h1>{metadata.title}</h1>;
}
`,
    String.raw`export const metadata = { title: "After" };

export default function Page() {
  return <h1>{metad\u0061ta.title}</h1>;
}
`,
    `export const metadata = { title: "After" };

export default function Page() {
  return <h1>{eval("meta" + "data").title}</h1>;
}
`,
    `export const metadata = buildMetadata("After");

export default function Page() {
  return <h1>Before</h1>;
}
`,
    `export const metadata = { themeColor: "black", title: "After" };

export default function Page() {
  return <h1>Before</h1>;
}
`,
    `export const metadata = { formatDetection: { telephone: false } };

export default function Page() {
  return <h1>Before</h1>;
}
`,
    `const pageTitle = "After";
export const metadata = { title: pageTitle };

export default function Page() {
  return <h1>Before</h1>;
}
`,
    `export const metadata = { "theme\\u0043olor": "black", title: "After" };

export default function Page() {
  return <h1>Before</h1>;
}
`,
    `export const metadata = { title: "After" };
export const viewport = { width: "device-width" };

export default function Page() {
  return <h1>Before</h1>;
}
`,
    `import * as self from "./page";
export const metadata = { title: "After" };

export default function Page() {
  return <h1>{self["meta" + "data"].title}</h1>;
}
`,
  ];

  for (const headSource of cases) {
    const change = { baseSource, headSource, path };
    assert.equal(isStaticMetadataOnlyRouteChange(change), false);
    assert.equal(isFrontendUiChange(change), true);
  }

  assert.equal(
    isStaticMetadataOnlyRouteChange({
      baseSource: null,
      headSource: `export const metadata = { title: "New" };\n`,
      path,
    }),
    false,
  );
});

test("does not strip type-import text from rendered route source", () => {
  const path = "apps/web/app/pitch-deck/page.tsx";
  const baseSource = `export const metadata = { title: "Before" };

const example = \`import type { Before } from "example";\`;

export default function Page() {
  return <pre>{example}</pre>;
}
`;
  const headSource = `export const metadata = { title: "After" };

const example = \`import type { After } from "example";\`;

export default function Page() {
  return <pre>{example}</pre>;
}
`;

  assert.equal(
    isStaticMetadataOnlyRouteChange({ baseSource, headSource, path }),
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
      "Add a `Direct:` list item under `## Evidence` naming proof matched to the changed frontend claim.",
      "Add a `Coverage:` list item under `## Evidence` explaining which states and viewports were checked and why that proof is sufficient.",
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
    "Add a `Direct:` list item under `## Evidence` naming proof matched to the changed frontend claim.",
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
  await mkdir(join(directory, "apps/web/app/settings"), { recursive: true });
  const pagePath = join(directory, "apps/web/app/settings/page.tsx");
  await writeFile(
    pagePath,
    'export default function Page() { return <h1>Before</h1>; }\n',
  );
  execFileSync("git", ["add", "apps"], { cwd: directory });
  execFileSync("git", ["commit", "--quiet", "-m", "root"], { cwd: directory });
  const rootSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();

  execFileSync("git", ["switch", "--quiet", "-c", "base"], {
    cwd: directory,
  });
  await writeFile(
    pagePath,
    'export default function Page() { return <h1>After</h1>; }\n',
  );
  execFileSync("git", ["add", "apps"], { cwd: directory });
  execFileSync("git", ["commit", "--quiet", "-m", "base moved"], {
    cwd: directory,
  });
  const baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    encoding: "utf8",
  }).trim();

  execFileSync("git", ["switch", "--quiet", "-c", "head", rootSha], {
    cwd: directory,
  });
  await writeFile(
    pagePath,
    [
      'export const metadata = { title: "Settings" };',
      "",
      'export default function Page() { return <h1>After</h1>; }',
      "",
    ].join("\n"),
  );
  execFileSync("git", ["add", "apps"], { cwd: directory });
  execFileSync("git", ["commit", "--quiet", "-m", "head changed"], {
    cwd: directory,
  });
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
