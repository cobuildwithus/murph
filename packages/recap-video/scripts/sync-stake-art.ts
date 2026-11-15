// Copies the prize drawings, and the words that pick one, out of the iOS app's repository into
// assets/stake-art/, so a recap video draws the same picture the app prints on a prize ticket.
//   pnpm exec tsx packages/recap-video/scripts/sync-stake-art.ts <murph-ios checkout> [git ref]
// Everything is read from the git ref (origin/main unless one is given), never from the checkout's
// working files, so edits that were never committed there cannot end up here.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Stake { id: string; title: string; keywords: string; sha256: string }
interface Idea { title: string; art: string }
interface Catalog { source: { repo: string; commit: string }; stopWords: string[]; stakes: Stake[]; ideas: Idea[] }

const GAME = "MurphCompanion/Game", RESOURCES = "MurphCompanion/Resources";
const [checkout, ref = "origin/main"] = process.argv.slice(2);
if (!checkout) {
  console.error("usage: tsx packages/recap-video/scripts/sync-stake-art.ts <murph-ios checkout> [git ref]");
  process.exit(1);
}
const out = fileURLToPath(new URL("../assets/stake-art/", import.meta.url));
const catalogFile = path.join(out, "catalog.json");

const git = (...args: string[]): Buffer => execFileSync("git", ["-C", checkout, ...args], { maxBuffer: 64 * 1024 * 1024 });
const commit = git("rev-parse", "--verify", `${ref}^{commit}`).toString().trim();
const show = (file: string): Buffer => git("show", `${commit}:${file}`);
const fail = (message: string): never => {
  throw new Error(`${message} (murph-ios ${commit.slice(0, 10)})`);
};
const text = (value: unknown, what: string): string => typeof value === "string" && value.length > 0 ? value : fail(`${what} is not text`);
const record = (value: unknown, what: string): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : fail(`${what} is not an object`);
const list = (value: unknown, what: string): unknown[] => Array.isArray(value) ? value : fail(`${what} is not a list`);
/** The one piece of a Swift source file a pattern finds; the app keeps a few of the picking rule's words in code. */
const swift = (file: string, pattern: RegExp): string => pattern.exec(show(`${GAME}/${file}`).toString())?.[1] ?? fail(`${file} no longer reads the way this script expects`);

/** Every drawing with the words that call it up, in the app's order, which decides ties. A drawing's id becomes a file name, so it may hold nothing a path could misread. */
function readStakes(): Stake[] {
  return list(JSON.parse(show(`${RESOURCES}/GameStakes.json`).toString()), "GameStakes.json").map((entry, index) => {
    const stake = record(entry, `Stake ${index}`), id = text(stake.id, `Stake ${index}'s id`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) fail(`Stake id "${id}" is not a plain file name`);
    const art = show(`${RESOURCES}/StakeArt.xcassets/stake-${id}.imageset/art.svg`);
    writeIfChanged(`${id}.svg`, art);
    return { id, title: text(stake.title, `${id}'s title`), keywords: text(stake.keywords, `${id}'s keywords`), sha256: createHash("sha256").update(art).digest("hex") };
  });
}

/**
 * The prizes the app suggests, each with the drawing it was written for, in the order the app looks
 * through them: kind by kind as its code lists the kinds, not as the file happens to. The first prize
 * with the same words wins there, so the order is kept here and nothing is dropped.
 */
function readIdeas(ids: Set<string>): Idea[] {
  const kinds = [...swift("GameIdeas.swift", /enum Kind: String, CaseIterable, Decodable \{([\s\S]*?)\n {4}\}/u).matchAll(/^\s*case ([\w, ]+)$/gmu)].flatMap(found => (found[1] ?? "").split(", "));
  if (kinds.length === 0) fail("GameIdeas.swift lists no kinds of people");
  const byKind = record(JSON.parse(show(`${RESOURCES}/GameIdeas.json`).toString()), "GameIdeas.json");
  return kinds.flatMap(kind => byKind[kind] === undefined ? [] : list(record(byKind[kind], kind).prizes, `${kind}'s prizes`).map(entry => {
    const prize = record(entry, `A ${kind} prize`), title = text(prize.title, `A ${kind} prize's title`), art = text(prize.art, `"${title}"'s art`);
    if (!ids.has(art)) fail(`"${title}" asks for a drawing that does not exist: ${art}`);
    return { title, art };
  }));
}

const changed: string[] = [];
function writeIfChanged(name: string, bytes: Buffer): void {
  const file = path.join(out, name);
  const before = existsSync(file) ? readFileSync(file) : undefined;
  if (before?.equals(bytes)) return;
  writeFileSync(file, bytes);
  changed.push(`${before ? "changed" : "added"} ${name}`);
}

const rows = (items: object[]): string => `[\n${items.map(item => `    ${JSON.stringify(item)}`).join(",\n")}\n  ]`;

mkdirSync(out, { recursive: true });
const before = existsSync(catalogFile) ? JSON.parse(readFileSync(catalogFile, "utf8")) as Catalog : undefined;
const stakes = readStakes();
const ids = new Set(stakes.map(stake => stake.id));
// The drawing a prize gets when nothing matches is named in the app's code and must be one of these.
const gift = swift("GameTickets.swift", /GameStakeCatalog\.lexical\(prize\)\?\.asset \?\?\s*"stake-([a-z0-9-]+)"/u);
if (!ids.has(gift)) fail(`The app falls back to a drawing that does not exist: ${gift}`);
const stopWords = [...swift("GameStakeCatalog.swift", /static let stop: Set<String> = \[([\s\S]*?)\]/u).matchAll(/"([^"]+)"/gu)].map(found => found[1] ?? "");
if (stopWords.length === 0) fail("GameStakeCatalog.swift lists no words to skip");
const ideas = readIdeas(ids);
for (const name of readdirSync(out).filter(name => name.endsWith(".svg") && !ids.has(name.slice(0, -4)))) {
  rmSync(path.join(out, name));
  changed.push(`removed ${name}`);
}
const catalog = `{
  "source": ${JSON.stringify({ repo: "murph-ios", commit })},
  "stopWords": ${JSON.stringify(stopWords)},
  "stakes": ${rows(stakes)},
  "ideas": ${rows(ideas)}
}
`;
writeIfChanged("catalog.json", Buffer.from(catalog));

console.log(`murph-ios ${before ? `${before.source.commit.slice(0, 10)} -> ` : ""}${commit.slice(0, 10)} (${ref}): ${stakes.length} drawings, ${ideas.length} suggested prizes, ${stopWords.length} skipped words, falls back to ${gift}`);
console.log(changed.length > 0 ? changed.join("\n") : "Nothing changed.");
if (before && before.source.commit !== commit) {
  // The rule itself is ported by hand. Data alone cannot show that it moved, so say where to look.
  console.log("The app's picking rule lives in GameTickets.swift (GamePrizeArt), GameIdeas.swift (art), GameStakeCatalog.swift (lexical, normalized) and GameProtoTickets.swift (GamePrize.withoutLeadingArticle). If any of those changed, update src/stake-art.ts and rebuild test/stake-art-parity.json from the app's code.");
}
