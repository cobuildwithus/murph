import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Offline only. Provider searches never contact the branding service.
const sourceUrl = "https://www.mychart.org/cached-api/help/organizations/?locale=en-us&includeOrganizations=1";
// Official site marks for organizations absent from MyChart's logo directory.
const kaiserLogo = "https://healthy.kaiserpermanente.org/etc.clientlibs/settings/wcm/designs/kporg/kp-foundation/clientlib-modules/styleguide/resources/assets/images/favicon-16x16.png";
const overrides: Record<string, string> = {
  "epic-1275": "https://www.sharp.com/apple-icon.png?56ba5f8e312a8622",
  "epic-1361-1": "https://www.vivohealthpharmacy.com/images/placeholders/vivo-logo.svg",
  "epic-227": "https://www.healthpartners.com/content/dam/brand-identity/icons/hp-favicon.ico",
  "epic-575": "https://www.mercy.net/etc.clientlibs/mercy/clientlibs/resources/images/favicons/favicon-196x196.png",
  "epic-920-1": "https://www.elcaminohealth.org/themes/custom/ech/favicons/ech-favicon.ico",
  "epic-958": "https://www.mayoclinic.org/favicon.ico",
  ...Object.fromEntries([132, 237, 439, 478, 479, 480, 482, 483].map((id) => [`epic-${id}`, kaiserLogo])),
};
// This exact official SVG was inspected: paths, polygons, and static fill styles only.
// A changed SVG requires review; arbitrary downloaded SVGs are never published.
const reviewedSvgHash = "d9b1980816d73827252ef281a1d0f3b925033abb3e4449b2271799b5bd28e184";

async function readBoundedBody(response: Response, maximum: number): Promise<Buffer> {
  if (!response.body) throw new Error("Missing response body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maximum) throw new Error("Response exceeded size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "public/clinical-provider-logos");
const directory = JSON.parse(await readFile(path.join(root, "src/lib/clinical-records/provider-directory.v2.json"), "utf8")) as {
  entries: Array<{ id: string; brandName: string }>;
};
const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`Brand directory returned ${response.status}`);
const source = JSON.parse((await readBoundedBody(response, 8 * 1024 * 1024)).toString("utf8")) as {
  organizationOptionsByScreenId: Record<string, Array<{
    slgId: string;
    name: string;
    logo?: { imageId: string; fileName: string; subAreaName: string } | null;
  }>>;
};
const brands = new Map(source.organizationOptionsByScreenId["pick-organization"].map((brand) => [brand.slgId, brand]));
const manifest: Record<string, string> = {};
const provenance: Record<string, { name: string; source: string }> = {};
const failures: string[] = [];
await mkdir(output, { recursive: true });
const previousManifest = await readFile(path.join(root, "src/lib/clinical-records/provider-logos.json"), "utf8").then((text) => JSON.parse(text) as Record<string, string>).catch(() => ({} as Record<string, string>));
const previousSources = await readFile(path.join(output, "sources.json"), "utf8").then((text) => JSON.parse(text) as { providers: typeof provenance }).catch(() => ({ providers: {} as typeof provenance }));
const pending = directory.entries.filter((entry) => overrides[entry.id] || brands.get(entry.id.replace(/^epic-/, ""))?.logo);
await Promise.all(Array.from({ length: 4 }, async () => {
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) return;
    const logo = brands.get(entry.id.replace(/^epic-/, ""))?.logo;
    if (!overrides[entry.id] && (!logo || logo.subAreaName !== "organizations" || !logo.fileName.endsWith(".png"))) continue;
    const url = overrides[entry.id] ?? `https://media.epic.com/mychartdotorg/directus/organizations/${encodeURIComponent(logo!.imageId)}/${encodeURIComponent(logo!.fileName)}`;
    const previous = previousManifest[entry.id];
    if (previous && /^\/clinical-provider-logos\/[a-f0-9]{24}\.(png|jpg|ico|svg)$/.test(previous) && previousSources.providers[entry.id]?.source === url) {
      const exists = await readFile(path.join(root, "public", previous)).then(() => true).catch(() => false);
      if (exists) {
        manifest[entry.id] = previous;
        provenance[entry.id] = { name: entry.brandName, source: url };
        continue;
      }
    }
    try {
      const image = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: "error", headers: { "User-Agent": "Mozilla/5.0" } });
      if (!image.ok || !image.headers.get("content-type")?.startsWith("image/")) throw new Error("Unavailable image");
      const bytes = await readBoundedBody(image, 512 * 1024);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const extension = imageExtension(bytes, digest);
      const filename = `${digest.slice(0, 24)}.${extension}`;
      await writeFile(path.join(output, filename), bytes);
      manifest[entry.id] = `/clinical-provider-logos/${filename}`;
      provenance[entry.id] = { name: entry.brandName, source: url };
    } catch {
      failures.push(entry.id);
    }
  }
}));
const sorted = <T>(value: Record<string, T>) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(path.join(root, "src/lib/clinical-records/provider-logos.json"), `${JSON.stringify(sorted(manifest), null, 2)}\n`);
await writeFile(path.join(output, "sources.json"), `${JSON.stringify({ sourceUrl, providers: sorted(provenance) }, null, 2)}\n`);
console.log(`Saved logos for ${Object.keys(manifest).length} providers. Unavailable: ${failures.length}.`);
if (failures.length) console.log(failures.sort().join(", "));

function imageExtension(bytes: Buffer, digest: string): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return "jpg";
  if (bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))) return "ico";
  if (digest === reviewedSvgHash) return "svg";
  throw new Error("Unrecognized image");
}
