import type { HostedGameRecap } from "@murphai/hosted-execution/runtime-control";

export type GameRecapEntry = { entryId: string; kind: string; playerName: string; text: string | null; visibleToBoth: boolean };
export type GameRecapChatMessage = { playerName: string; text: string };
export type GameRecapCanonicalScore = { memberId: string; name: string; score: number };

const VISUAL = new Set(["photo", "route", "heartRate", "reps"]);
const BACKGROUNDS = new Set(["night", "paper", "sage", "sienna", "slate"]);
const BLOCK_KINDS = new Set(["photo", "photoPair", "contactSheet", "headline", "kicker", "quote", "stat"]);
const BANNED = /\b(ticket|tickets|bet|bets|wager|stake|stakes|winnings)\b/iu;
const PRONOUN = /\b(he|she|him|her|his|hers)\b/iu;
const SECOND_PERSON = /\b(you|your|yours)\b/iu;
const EMOJI = /[\u{1F300}-\u{1FAFF}☀-➿]/u;
const VISUAL_BLOCK_LIMITS = { contactSheet: [3, 9], photo: [1, 1], photoPair: [2, 2] } as const;

type RecapBlock = HostedGameRecap["pages"][number]["blocks"][number];
type RecapEntries = ReadonlyMap<string, GameRecapEntry>;

function checkText(where: string, text: string | undefined, limit: number, errors: string[]): void {
  if (text === undefined) return;
  if (text.length > limit) errors.push(`${where}: ${text.length} characters, limit ${limit}. Cut it.`);
  if (text.includes("!")) errors.push(`${where}: no exclamation marks.`);
  if (EMOJI.test(text)) errors.push(`${where}: no emoji.`);
  if (BANNED.test(text)) errors.push(`${where}: say prize or dare; never ticket, bet, wager, stake or winnings.`);
  if (PRONOUN.test(text)) errors.push(`${where}: use names instead of he/she/him/her/his/hers.`);
}

function validateEntryAuthority(where: string, ids: readonly string[], entries: RecapEntries, errors: string[]): void {
  for (const entryId of ids) {
    const entry = entries.get(entryId);
    if (!entry || !entry.visibleToBoth) errors.push(`${where}: entry ${entryId} isn't in this game.`);
  }
}

function validateVisualBlock(where: string, block: RecapBlock, ids: readonly string[], entries: RecapEntries, errors: string[]): void {
  if (block.kind !== "photo" && block.kind !== "photoPair" && block.kind !== "contactSheet") return;
  const [minimum, maximum] = VISUAL_BLOCK_LIMITS[block.kind];
  if (ids.length < minimum || ids.length > maximum) errors.push(`${where}: needs ${minimum}${minimum === maximum ? "" : ` to ${maximum}`} entries, got ${ids.length}.`);
  for (const entryId of ids) {
    const entry = entries.get(entryId);
    if (entry?.visibleToBoth && !VISUAL.has(entry.kind)) errors.push(`${where}: ${entryId} is a ${entry.kind} post; show words with a quote block.`);
  }
}

function validateCopyBlock(where: string, block: RecapBlock, errors: string[]): void {
  if (block.kind === "headline") checkText(where, block.text, 70, errors);
  if (block.kind === "kicker") checkText(where, block.text, 22, errors);
  if (block.kind === "stat") {
    if (!block.statValue || block.statValue.length > 8) errors.push(`${where}: statValue of 1 to 8 characters.`);
    checkText(where, block.text, 40, errors);
  }
}

function normalizeQuote(value: string): string {
  return value.replace(/[’]/gu, "'").replace(/[“”]/gu, '"').replace(/\s+/gu, " ").trim().toLowerCase();
}

function validateQuoteBlock(where: string, block: RecapBlock, players: readonly string[], entries: RecapEntries, chatMessages: readonly GameRecapChatMessage[], errors: string[]): void {
  if (block.kind !== "quote") return;
  const quote = block.quote;
  const playerList = `[${players.map((player) => `'${player}'`).join(", ")}]`;
  if (!quote || !players.includes(quote.who)) errors.push(`${where}: who must be one of ${playerList}.`);
  const text = quote?.text ?? "";
  const normalized = normalizeQuote(text);
  const said = chatMessages.some((message) => message.playerName === quote?.who && normalizeQuote(message.text).includes(normalized));
  const wrote = [...entries.values()].some((entry) => entry.playerName === quote?.who && entry.text && normalizeQuote(entry.text).includes(normalized));
  if (!text || (!said && !wrote)) errors.push(`${where}: quote isn't something ${quote?.who} said in the chat or posted. Copy it exactly.`);
  if (text.length > 140) errors.push(`${where}: quote over 140 characters; pick a shorter piece of what they said.`);
}

function validateRecapBlock(input: { block: RecapBlock; blockIndex: number; chatMessages: readonly GameRecapChatMessage[]; entries: RecapEntries; errors: string[]; pageIndex: number; players: readonly string[] }): void {
  const { block, blockIndex, chatMessages, entries, errors, pageIndex, players } = input;
  const where = `page ${pageIndex} block ${blockIndex} (${block.kind})`;
  if (!BLOCK_KINDS.has(block.kind)) {
    errors.push(`${where}: unknown kind.`);
    return;
  }
  const ids = block.entryIds ?? [];
  validateEntryAuthority(where, ids, entries, errors);
  validateVisualBlock(where, block, ids, entries, errors);
  validateCopyBlock(where, block, errors);
  if (["headline", "kicker", "stat"].includes(block.kind) && SECOND_PERSON.test(block.text ?? "")) {
    errors.push(`page ${pageIndex} block ${blockIndex}: both players read this; write about them by name, not you.`);
  }
  validateQuoteBlock(where, block, players, entries, chatMessages, errors);
}

function wordGrams(value: string): Set<string> {
  const words = value.toLowerCase().match(/[a-z']+/gu) ?? [];
  return new Set(words.slice(0, -2).map((_, index) => words.slice(index, index + 3).join(" ")));
}

function validateChatLine(input: { chatLine: string; players: readonly string[]; priorChatLines: readonly string[] }, errors: string[]): void {
  checkText("chatLine", input.chatLine, 160, errors);
  if (/^\s*(?:the |your )?recap/iu.test(input.chatLine)) errors.push("chatLine: lead with the week's funniest moment, not with the recap being ready.");
  if (/made the recap|recap'?s (?:ready|up|in)\b|recap is (?:ready|up|in)\b|your week is ready/iu.test(input.chatLine)) {
    errors.push("chatLine: that ending is a stock phrase; point them to the recap in your own words.");
  }
  const current = wordGrams(input.chatLine);
  const names = new Set(input.players.map((player) => player.toLowerCase()));
  const repeats = input.priorChatLines.flatMap((line) => [...wordGrams(line)].filter((gram) => current.has(gram) && !gram.split(" ").some((word) => names.has(word)))).sort();
  if (repeats[0]) errors.push(`chatLine: repeats "${repeats[0]}" from an earlier week's chat line in the lore; say it a new way.`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function validateScoreLine(
  scoreLine: string,
  result: readonly GameRecapCanonicalScore[],
  errors: string[],
): void {
  if (result.length !== 2) return;
  const [a, b] = result;
  if (a.score === b.score) {
    if (/\b(?:owe|owes|owed|owing)\b/iu.test(scoreLine)) {
      errors.push("scoreLine: the settled result is a tie; nobody owes.");
    }
    return;
  }
  const winner = a.score > b.score ? a : b;
  const loser = winner === a ? b : a;
  if (!scoreLine.includes(winner.name) || !scoreLine.includes(loser.name)) {
    errors.push("scoreLine: a win must name both players.");
    return;
  }
  const owing = new RegExp(`${escapeRegExp(loser.name)}[^.]{0,60}\\b(?:owe|owes|owed|owing)\\b[^.]{0,60}${escapeRegExp(winner.name)}`, "iu");
  if (!owing.test(scoreLine)) {
    errors.push(`scoreLine: ${loser.name}, the settled loser, must be on the owing side to ${winner.name}.`);
  }
}

export function validateGameRecap(input: { recap: HostedGameRecap; players: readonly string[]; entries: readonly GameRecapEntry[]; chatMessages?: readonly GameRecapChatMessage[]; priorChatLines?: readonly string[]; result?: readonly GameRecapCanonicalScore[] }): string[] {
  const errors: string[] = [];
  const entries = new Map(input.entries.map((entry) => [entry.entryId, entry]));
  const pages = input.recap.pages;
  if (pages.length < 3 || pages.length > 7) errors.push(`pages: ${pages.length}; write 3 to 7.`);
  pages.forEach((page, pageIndex) => {
    const number = pageIndex + 1;
    if (!BACKGROUNDS.has(page.background)) errors.push(`page ${number}: background must be one of ['night', 'paper', 'sage', 'sienna', 'slate'].`);
    if (page.blocks.length < 1 || page.blocks.length > 3) errors.push(`page ${number}: ${page.blocks.length} blocks; use 1 to 3.`);
    page.blocks.forEach((block, blockIndex) => validateRecapBlock({ block, blockIndex: blockIndex + 1, chatMessages: input.chatMessages ?? [], entries, errors, pageIndex: number, players: input.players }));
  });
  const quotePages = pages.map((page) => page.blocks.filter((block) => block.kind === "quote").length);
  if (quotePages.filter((count) => count >= 2).length > 1) errors.push("Only one page can stack several quotes (a back-and-forth). Let your headlines carry the other pages.");
  const pagesWithQuotes = quotePages.filter(Boolean).length;
  if (pages.length > 0 && pagesWithQuotes > Math.ceil(pages.length / 2)) errors.push(`Quotes on ${pagesWithQuotes} of ${pages.length} pages; keep them to about half and let your own lines carry the rest.`);
  checkText("scoreLine", input.recap.scoreLine, 80, errors);
  if (/\d+\s*[–-]\s*\d+/u.test(input.recap.scoreLine)) errors.push("scoreLine: the card already shows the score; land the result and who owes what instead.");
  if (!input.players.some((player) => input.recap.scoreLine.includes(player))) errors.push("scoreLine: name who owes whom.");
  if (SECOND_PERSON.test(input.recap.scoreLine)) errors.push("scoreLine: write about them by name, not you.");
  if (input.result) validateScoreLine(input.recap.scoreLine, input.result, errors);
  validateChatLine({ chatLine: input.recap.chatLine, players: input.players, priorChatLines: input.priorChatLines ?? [] }, errors);
  return errors;
}

export function gameRecapToolResult(errors: readonly string[]): string {
  return errors.length === 0 ? "ok: saved. The players will see this recap." : `Not saved. Fix these and call write_recap again:\n- ${errors.join("\n- ")}`;
}
