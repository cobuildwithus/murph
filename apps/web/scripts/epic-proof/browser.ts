import { createHash, X509Certificate } from "node:crypto";
import { createServer } from "node:https";
import { once } from "node:events";
import { chromium, type Page } from "@playwright/test";
import { POST as intent } from "../../app/api/clinical-records/connect-intents/route";
import { POST as start } from "../../app/api/clinical-records/connect-intents/start/route";
import { GET as finish } from "../../app/api/clinical-records/oauth/callback/route";
import { boundBrowserNetwork, privateContext } from "./browser-network";
import { authorize, check, cleanEnv, origin, vendor } from "./policy";

export class SandboxFailure extends Error {
  constructor(readonly outcome: "auth-blocked" | "vendor-unavailable" | "expectation-drift") { super(outcome); }
}
const startPath = "/api/clinical-records/connect-intents/start";
const intentPath = "/api/clinical-records/connect-intents";

async function route(request: Request) {
  const path = new URL(request.url).pathname;
  if (request.method === "POST" && path === intentPath) return intent(request);
  if (request.method === "POST" && path === startPath) return start(request);
  if (request.method === "GET" && path === "/callback") return finish(request);
  if (request.method === "GET" && ["/", "/records"].includes(path)) return new Response("Sandbox proof", { headers: { "content-type": "text/plain" } });
  return new Response(null, { status: 404 });
}

async function consent(page: Page, patient: string, networkFailure: () => string | undefined) {
  const acted = new Set<string>();
  const deadline = Date.now() + (process.env.PROOF_INTERACTIVE === "1" ? 180_000 : 60_000);
  while (Date.now() < deadline) {
    check(!networkFailure());
    const current = new URL(page.url());
    if (current.origin === origin && current.pathname === "/records") {
      check(current.searchParams.get("clinicalRecords") === "connected");
      return;
    }
    if (current.origin === vendor && process.env.PROOF_INTERACTIVE !== "1") {
      if (await page.getByText(/captcha|verification code|verify your identity|an error has occurred/i).first().isVisible())
        throw new SandboxFailure("auth-blocked");
      const action = await consentAction(page, patient, acted);
      if (action) acted.add(action);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new SandboxFailure("auth-blocked");
}

async function consentAction(page: Page, patient: string, acted: Set<string>) {
  for (const [selector, value] of [["#Login", patient], ["#Password", "epicepic1"]] as const) {
    if (!acted.has(selector) && await page.locator(selector).isVisible()) {
      await page.locator(selector).fill(value);
      if (selector === "#Login" && await page.locator("#Password").isVisible()) {
        await page.locator("#Password").fill("epicepic1");
        acted.add("#Password");
      }
      await page.locator("#submit").click();
      return selector;
    }
  }
  for (const selector of ["#nextButton", "#allowDataSharing"]) {
    if (!acted.has(selector) && await page.locator(selector).isVisible()) {
      if (selector === "#allowDataSharing") {
        const day = page.getByLabel(/^1 day$/i);
        if (await day.count()) await day.check({ force: true });
      }
      await page.locator(selector).click();
      return selector;
    }
  }
}

export async function login(cookie: string, patient: string, cert: Buffer, key: Buffer, stage: (s: string) => void) {
  const server = createServer({ cert, key }, async (req, res) => {
    try {
      check(req.headers.host === "127.0.0.1:8443");
      const url = new URL(req.url!, origin);
      check(url.origin === origin);
      const body: Buffer[] = [];
      for await (const chunk of req) { body.push(chunk); check(Buffer.concat(body).length <= 4096); }
      if (url.pathname === "/callback") stage("callback");
      const response = await route(new Request(url, { method: req.method,
        headers: { cookie: req.headers.cookie ?? "", origin: req.headers.origin ?? "", "content-type": "application/json" },
        ...(body.length ? { body: Buffer.concat(body).toString() } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch { res.writeHead(500).end(); }
  });
  server.listen(8443, "127.0.0.1");
  await once(server, "listening");
  try {
    const spki = new X509Certificate(cert).publicKey.export({ format: "der", type: "spki" });
    const browser = await chromium.launch({ headless: process.env.PROOF_INTERACTIVE !== "1", env: cleanEnv(),
      args: ["--no-proxy-server", "--disable-background-networking", "--disable-breakpad", "--block-new-web-contents",
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE fhir.epic.com, EXCLUDE 127.0.0.1",
        "--ignore-certificate-errors-spki-list=" + createHash("sha256").update(spki).digest("base64")] });
    try {
      const context = await browser.newContext(privateContext);
      const separator = cookie.indexOf("=");
      await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1).split(";")[0]!,
        url: origin, httpOnly: true, secure: true, sameSite: "Lax" }]);
      const page = await context.newPage();
      const failure = await boundBrowserNetwork(page);
      page.setDefaultTimeout(8_000);
      await page.goto(origin);
      stage("start");
      const destination = await page.evaluate(async ([intentPath, startPath]) => {
        const headers = { "content-type": "application/json" };
        const created = await fetch(intentPath!, { method: "POST", headers, body: "{}" });
        const { claim } = await created.json();
        const started = await fetch(startPath!, { method: "POST", headers, body: JSON.stringify({ claim, providerDirectoryEntryId: "epic-sandbox" }) });
        return (await started.json()).authorizationUrl;
      }, [intentPath, startPath]);
      authorize(destination);
      stage("login");
      try {
        await page.goto(destination, { waitUntil: "domcontentloaded" });
        await consent(page, patient, failure);
      } catch (error) {
        if (failure() === "vendor-unavailable") throw new SandboxFailure("vendor-unavailable");
        check(!failure());
        throw error;
      }
    } finally { await browser.close(); }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
