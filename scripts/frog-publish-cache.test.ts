import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Config, Github, type Entry } from "frog";
import { describe, expect, it } from "vitest";

// Exercise the installed registry patch through its real Octokit transport.
import { file, prepare } from "../node_modules/frog/dist/cli/internal/publish.js";

describe("Frog publish batch index reuse", () => {
  it("indexes once across unchanged linked batches and isolates label/author/repository scopes", async () => {
    const origin = "example/canary";
    const entries: Entry.Entry[] = Array.from({ length: 12 }, (_, index) => ({
      id: `synthetic-${index}`, title: `Synthetic friction ${index}`,
      severity: "minor", body: "Synthetic reproduction.", issue: `${origin}#${index + 1}`,
    }));
    const issues = entries.map((entry, index) => ({
      number: index + 1, title: entry.title, state: "open", user: { login: "canary-bot" },
      body: Github.renderBody({ body: entry.body,
        marker: { hash: Github.hash(entry.title), origin },
        report: Github.report({ entry, origin }), revision: Github.revision({ entry, origin }),
      }),
    }));
    const counts = { index: 0, permissions: 0, mutations: 0 };
    let allowSyntheticWrites = false;
    const mutationPaths: string[] = [];
    const server = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method !== "GET") {
        counts.mutations++;
        mutationPaths.push(url.pathname);
        if (!allowSyntheticWrites) { response.writeHead(403).end("{}"); return; }
        let serialized = "";
        for await (const chunk of request) serialized += chunk;
        const payload = JSON.parse(serialized);
        if (url.pathname.endsWith("/issues")) {
          const created = { number: issues.length + 1, title: String(payload.title),
            body: String(payload.body), state: "open", user: { login: "canary-bot" } };
          issues.push(created);
          response.end(JSON.stringify(created));
        } else response.end(JSON.stringify({ id: 1 }));
      } else if (/\/issues\/\d+$/u.test(url.pathname)) {
        response.end(JSON.stringify(issues[Number(url.pathname.split("/").at(-1)) - 1]));
      } else if (url.pathname.endsWith("/issues")) {
        counts.index++;
        response.end(JSON.stringify(issues));
      } else if (url.pathname.endsWith("/comments")) {
        response.end("[]");
      } else {
        counts.permissions++;
        response.end(JSON.stringify({ permissions: { push: true } }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected local TCP server");
    const root = await mkdtemp(path.join(tmpdir(), "frog-batch-proof-"));
    try {
      const config = Config.Schema.parse({ labels: ["friction"], maxPerRun: 5 });
      const ready = await prepare({ config, repo: origin, env: {
        GH_TOKEN: "synthetic-token", GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
      } });
      if ("code" in ready) throw new Error(ready.code);
      for (let offset = 0; offset < entries.length; offset += 5) {
        const result = await file({ ...ready, config, root, origin, repo: origin,
          entries: entries.slice(offset, offset + 5), dryRun: true, expectedAuthor: "canary-bot" });
        expect(result.consumed).toBe(0);
        expect(result.deferred).toEqual([]);
      }
      expect(counts).toEqual({ index: 1, permissions: 1, mutations: 0 });
      for (const scope of [
        { labels: ["other-label"] },
        { expectedAuthor: "other-bot" },
        { repo: "example/other" },
      ]) {
        await file({ ...ready, config, root, origin, repo: origin,
          entries: [], dryRun: true, expectedAuthor: "canary-bot", ...scope });
      }
      expect(counts).toEqual({ index: 4, permissions: 4, mutations: 0 });
      const fresh = await prepare({ config, repo: origin, env: {
        GH_TOKEN: "synthetic-token", GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
      } });
      if ("code" in fresh) throw new Error(fresh.code);
      await file({ ...fresh, config, root, origin, repo: origin, entries: [], dryRun: true });
      expect(counts.permissions).toBe(5);
      // The index must also remember issues created in earlier batches, even
      // when the cached repository listing predates their creation.
      allowSyntheticWrites = true;
      const first = { id: "new-a", title: "New duplicate title", body: "First occurrence", severity: "minor" as const };
      const second = { ...first, id: "new-b", body: "Second occurrence" };
      for (const entry of [first, second]) {
        const outcome = await file({ ...ready, config, root, origin, repo: origin,
          entries: [entry], expectedAuthor: "canary-bot" });
        expect(outcome.consumed).toBe(1);
        expect(outcome.deferred).toEqual([]);
      }
      expect(mutationPaths).toEqual(["/repos/example/canary/issues", "/repos/example/canary/issues/13/comments"]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { force: true, recursive: true });
    }
  });
});
