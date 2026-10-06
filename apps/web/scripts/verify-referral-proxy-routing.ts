// Run from the repository root: pnpm exec node --import tsx apps/web/scripts/verify-referral-proxy-routing.ts
// Builds only a temporary synthetic app, using the installed lockfile dependencies.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MURPH_AGENT_GUIDE_MARKDOWN } from "../src/lib/public-agent-content";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const webRequire = createRequire(path.join(webRoot, "package.json"));
const nextBin = webRequire.resolve("next/dist/bin/next");
const nextVersion = (webRequire("next/package.json") as { version: string }).version;
const NOT_FOUND_MARKER = "fixture-app-not-found";
const encodedQuery = "?code=synthetic%2Fvalue%5Ctail&next=%2Frefer%2F";

async function prepareFixture(root: string): Promise<void> {
  // Keep Next's static matcher extraction and the real homepage dependency closure.
  for (const relative of [
    "proxy.ts",
    "src/lib/public-agent-content.ts",
    "src/lib/public-contact.ts",
    "src/lib/site-metadata.ts",
  ]) {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(webRoot, relative), destination);
    assert.deepEqual(await readFile(destination), await readFile(path.join(webRoot, relative)));
  }
  // Resolve before building: missing dependencies fail here, without an installation.
  for (const name of [
    "next", "react", "react-dom", "typescript", "@types/node", "@types/react", "@types/react-dom",
  ]) {
    const destination = path.join(root, "node_modules", name);
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(path.dirname(webRequire.resolve(`${name}/package.json`)), destination, "dir");
  }
  const echoRoute = `export async function POST(request) {
    return Response.json({
      path: request.nextUrl.pathname + request.nextUrl.search,
      body: await request.text(),
      signature: request.headers.get("x-synthetic-signature"),
    });
  }`;
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "referral-proxy-fixture", private: true }),
    "next.config.mjs": "export default { experimental: { cpus: 1 } };\n",
    "tsconfig.json": JSON.stringify({ compilerOptions: {
      target: "ES2022", module: "esnext", moduleResolution: "bundler", jsx: "preserve",
      strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true,
      allowJs: true, paths: { "@/*": ["./*"] },
    } }),
    "app/layout.js": "export default function Layout({children}) { return <html><body>{children}</body></html>; }",
    "app/page.js": "export default function Home() { return <main>fixture-home</main>; }",
    "app/refer/page.js": "export default function Refer() { return <main>fixture-refer</main>; }",
    "app/about/page.js": "export default function About() { return <main>fixture-about</main>; }",
    "app/not-found.js": `export default function NotFound() { return <main>${NOT_FOUND_MARKER}</main>; }`,
    "app/api/synthetic-signed/[...path]/route.js": echoRoute,
    "app/.well-known/workflow/v1/webhook/[...path]/route.js": echoRoute,
  };
  for (const [relative, content] of Object.entries(files)) {
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

function launchNext(root: string, args: string[], signal: AbortSignal) {
  signal.throwIfAborted();
  const child = spawn(process.execPath, [nextBin, ...args], {
    cwd: root,
    // Do not inherit app credentials, config overrides, NODE_OPTIONS, or env files.
    env: { PATH: process.env.PATH, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", CI: "1" },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    signal,
  });
  let output = "";
  let closed = false;
  const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-100_000); };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const close = new Promise<number | null>((resolve) => {
    child.once("close", (code) => { closed = true; resolve(code); });
  });
  const done = Promise.race([
    close,
    new Promise<never>((_, reject) => child.once("error", reject)),
  ]);
  void done.catch(() => {});
  return { child, close, done, output: () => output, closed: () => closed };
}
type NextProcess = ReturnType<typeof launchNext>;

async function within<T>(operation: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function signalOwned(processHandle: NextProcess, signal: NodeJS.Signals): void {
  if (processHandle.closed() || !processHandle.child.pid) return;
  try {
    if (process.platform === "win32") processHandle.child.kill(signal);
    else process.kill(-processHandle.child.pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

async function stopOwned(processHandle: NextProcess): Promise<void> {
  signalOwned(processHandle, "SIGTERM");
  try {
    await within(processHandle.close, 5_000, "Next fixture shutdown");
  } catch {
    signalOwned(processHandle, "SIGKILL");
    await within(processHandle.close, 5_000, "Next fixture forced shutdown");
  }
}

async function readOrigin(server: NextProcess): Promise<string> {
  const started = new Promise<string>((resolve) => {
    const inspect = () => {
      const match = server.output().match(/http:\/\/127\.0\.0\.1:([1-9][0-9]*)/u);
      if (match && server.output().includes("Ready in")) resolve(match[0]);
    };
    server.child.stdout.on("data", inspect);
    server.child.stderr.on("data", inspect);
    inspect();
  });
  return within(Promise.race([
    started,
    server.done.then(() => { throw new Error(`Next fixture exited during startup:\n${server.output()}`); }),
  ]), 30_000, "Next fixture startup");
}

type RequestFixture = (pathname: string, init?: RequestInit) => Promise<Response>;

async function verifyReferralResponses(request: RequestFixture): Promise<void> {
  for (const pathname of [
    "/refer%2F", "/refer%2f", "/refer%5C", "/refer%5c",
    "/refer%2Fchild", "/refer%5c%2Fchild", `/refer%2F${encodedQuery}`,
  ]) {
    const response = await request(pathname);
    assert.equal(response.status, 404, pathname);
    assert.equal(await response.text(), "Not Found", pathname);
    assert.equal(response.headers.get("location"), null, pathname);
  }
  const head = await request("/refer%5C", { method: "HEAD" });
  assert.equal(head.status, 404);
  assert.equal(await head.text(), "");
  for (const pathname of ["/refer", `/refer${encodedQuery}`]) {
    const response = await request(pathname, { headers: { Accept: "text/markdown" } });
    assert.equal(response.status, 200, pathname);
    assert.match(await response.text(), /fixture-refer/u);
  }
  const trailingSlash = await request(`/refer/${encodedQuery}`);
  assert.equal(trailingSlash.status, 308);
  const destination = new URL(trailingSlash.headers.get("location") ?? "", trailingSlash.url);
  assert.equal(destination.pathname + destination.search, `/refer${encodedQuery}`);
  await trailingSlash.text();
  for (const pathname of ["/refer-missing", "/refer%252F", "/refer%255C", "/about%2F", "/unknown"]) {
    const response = await request(pathname);
    assert.equal(response.status, 404, pathname);
    assert.ok((await response.text()).includes(NOT_FOUND_MARKER), pathname);
  }
}

async function verifyHomepageAndPublicRoutes(request: RequestFixture): Promise<void> {
  for (const method of ["GET", "HEAD"]) {
    const response = await request(`/${encodedQuery}`, { method, headers: { Accept: "text/markdown" } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
    assert.equal(await response.text(), method === "HEAD" ? "" : MURPH_AGENT_GUIDE_MARKDOWN);
  }
  for (const [pathname, marker] of [["/", "fixture-home"], ["/about", "fixture-about"]]) {
    assert.ok(pathname && marker);
    const response = await request(pathname, { headers: { Accept: "text/html" } });
    assert.equal(response.status, 200, pathname);
    assert.ok((await response.text()).includes(marker), pathname);
  }
}

async function verifyUnchangedRequestPaths(request: RequestFixture): Promise<void> {
  for (const pathname of [
    `/api/synthetic-signed/token%2Fvalue%5Ctail${encodedQuery}`,
    `/.well-known/workflow/v1/webhook/token%2Fvalue${encodedQuery}`,
  ]) {
    const response = await request(pathname, {
      method: "POST", body: "synthetic-body", headers: { "x-synthetic-signature": "synthetic-signature" },
    });
    assert.equal(response.status, 200, pathname);
    assert.deepEqual(await response.json(), {
      path: pathname, body: "synthetic-body", signature: "synthetic-signature",
    });
  }
  const malformedWebhook = await request("/.well-known/workflow/v1/webhook/%E0%A4%A", {
    method: "POST", body: "synthetic-body",
  });
  assert.equal(malformedWebhook.status, 400);
  assert.equal(await malformedWebhook.text(), "Malformed token");
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "murph-referral-proxy-"));
  const children: NextProcess[] = [];
  const cancellation = new AbortController();
  const interrupt = () => cancellation.abort(new Error("Fixture interrupted"));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await prepareFixture(root);
    const build = launchNext(root, ["build", "--webpack"], cancellation.signal);
    children.push(build);
    const exitCode = await within(build.done, 120_000, "Next fixture build");
    assert.equal(exitCode, 0, `Next fixture build failed:\n${build.output()}`);
    const server = launchNext(root, ["start", "--hostname", "127.0.0.1", "--port", "0"], cancellation.signal);
    children.push(server);
    const origin = await readOrigin(server);
    let count = 0;
    const request: RequestFixture = (pathname, init) => {
      count += 1;
      return fetch(origin + pathname, {
        ...init, redirect: "manual",
        signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(10_000)]),
      });
    };
    await verifyReferralResponses(request);
    await verifyHomepageAndPublicRoutes(request);
    await verifyUnchangedRequestPaths(request);
    process.stdout.write(`Referral proxy production fixture passed (Next ${nextVersion}; ${count} HTTP checks).\n`);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    try {
      await Promise.all(children.map(stopOwned));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
