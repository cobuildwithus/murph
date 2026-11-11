import type { GameRecapStory as HostedGameRecap } from "./recap-show.js";

export type GameRecapEntry = { entryId: string; kind: string; playerName: string; text: string | null; visibleToBoth: boolean };
export type GameRecapChatMessage = { playerName: string; text: string };
export type GameRecapCanonicalScore = { memberId: string; name: string; score: number };

const VISUAL = new Set(["photo", "route", "heartRate", "reps"]);
const BACKGROUNDS = new Set(["night", "paper", "sage", "sienna", "slate"]);
const BLOCK_KINDS = new Set(["photo", "photoPair", "contactSheet", "headline", "kicker", "quote", "stat", "scene"]);
const PICTURE_KINDS = new Set(["photo", "photoPair", "contactSheet", "scene"]);
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
  const wrote = [...entries.values()].some((entry) => entry.visibleToBoth && entry.playerName === quote?.who && entry.text && normalizeQuote(entry.text).includes(normalized));
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
  if (block.kind === "scene") {
    const scene = block.scene;
    if (!scene || scene.prompt.length < 80 || scene.prompt.length > 700) errors.push(`${where}: prompt of 80 to 700 characters saying what the camera sees.`);
    if (scene && (scene.cast.length === 0 || new Set(scene.cast).size !== scene.cast.length)) errors.push(`${where}: cast must contain unique player names.`);
    for (const id of ids) if (entries.get(id)?.kind !== "photo") errors.push(`${where}: scene references must be real photos.`);
    for (const name of scene?.cast ?? []) if (!players.includes(name)) errors.push(`${where}: cast must be player names from [${players.map((player) => `'${player}'`).join(", ")}].`);
  }
}

function validatePicturePage(page: HostedGameRecap["pages"][number], index: number, players: readonly string[], errors: string[]): void {
  const pictures = page.blocks.filter(block => PICTURE_KINDS.has(block.kind));
  if (!pictures.length && index !== 0) return;
  const kinds = page.blocks.map(block => block.kind).join(",");
  if (index === 0) {
    if (kinds !== "headline,scene,kicker") errors.push("page 1: use title, one scene, then prize kicker in that order.");
    const cast = pictures[0]?.scene?.cast ?? [];
    if (cast.length !== players.length || players.some(name => !cast.includes(name))) errors.push("page 1: the cover must feature both players.");
  } else if (!/^(kicker,)?headline,(scene|photo|photoPair|contactSheet),(headline|quote)$/u.test(kinds)) {
    errors.push(`page ${index + 1}: use optional kicker, setup headline, one picture, then payoff headline or quote.`);
  }
  const limit = index === 0 ? 28 : 45;
  for (const block of page.blocks) {
    if (block.kind === "headline" && (block.text?.length ?? 0) > limit) errors.push(`page ${index + 1}: picture headline limit is ${limit} characters.`);
    if (["photo", "photoPair", "contactSheet"].includes(block.kind) && block.style !== "print") errors.push(`page ${index + 1}: real photos use print with the whole image visible.`);
  }
}

function validateRecapShow(input: RecapValidationInput, errors: string[]): void {
  const { recap, players, entries } = input;
  if (recap.treatment && input.usedTreatments?.some(used => normalizeTreatment(used) === normalizeTreatment(recap.treatment!))) errors.push("treatment: this genre was already used; choose a new genre, not a cosmetic variant.");
  if (!recap.treatment?.trim() || recap.treatment.length > 60) errors.push("treatment: choose a genre label of 1 to 60 characters.");
  if (recap.pages.length < 5) errors.push("pages: pair shows need 5 to 7 authored pages.");
  const scenes = recap.pages.flatMap(page => page.blocks.filter(block => block.kind === "scene"));
  const photoCount = new Set(entries.filter(entry => entry.visibleToBoth && entry.kind === "photo").map(entry => entry.entryId)).size;
  const maximum = photoCount < 3 ? 4 : 3;
  if (scenes.length < 2 || scenes.length > maximum) errors.push(`scenes: use 2 to ${maximum}; a fourth requires fewer than 3 real photos.`);
  recap.pages.forEach((page, index) => validatePicturePage(page, index, players, errors));
  if (recap.superlatives && !withValidGameSuperlatives(recap, input.result?.map(player => player.memberId) ?? [], false).superlatives) errors.push("superlatives: choose zero, one or two unique eligible players.");
  const song = recap.song;
  if (song) {
    checkText("song title", song.title, 30, errors);
    if (!song.style.trim() || song.style.length > 220) errors.push("song style: one nonempty sentence, at most 220 characters.");
    if (song.lyrics.length < 4 || song.lyrics.length > 6) errors.push(`song lyrics: ${song.lyrics.length} lines; write 4 to 6.`);
    song.lyrics.forEach((line, index) => { if (!line.trim() || line.length > 60 || EMOJI.test(line) || BANNED.test(line)) errors.push(`song lyrics line ${index + 1}: nonempty, at most 60 characters, no emoji or banned prize words.`); });
  }
}

function wordGrams(value: string): Set<string> {
  const words = value.toLowerCase().match(/[a-z']+/gu) ?? [];
  return new Set(words.slice(0, -2).map((_, index) => words.slice(index, index + 3).join(" ")));
}

const CHAT_SCORE = /\b(\d+)\s*(?:[-–—:]|to)\s*(\d+)\b(?!\s*[ap]\.?m\.?\b)/giu;

function chatLineMoment(value: string, players: readonly string[]): string {
  // Only exempt an opening result through its score, never the specific moment.
  const score = [...value.matchAll(CHAT_SCORE)][0];
  if (!score) return value;
  const opening = value.slice(0, score.index);
  const resultOpening = /^(?:(?:the|this|your|our|that's|that’s|that is)\s+)?(?:the\s+)?(?:game|week|tied?|draw|final|finished|ended|over)\b/iu.test(opening.trim());
  const winnerOpening = players.some((name) => new RegExp(`^${escapeRegExp(name)}\\s+(?:won|wins?)\\b`, "iu").test(opening.trim()));
  if (/[.!?;]/u.test(opening) || (!resultOpening && !winnerOpening)) return value;
  return value.slice(score.index + score[0].length);
}

function validateChatLine(input: { chatLine: string; players: readonly string[]; priorChatLines: readonly string[]; result?: readonly GameRecapCanonicalScore[] }, errors: string[]): void {
  checkText("chatLine", input.chatLine, 160, errors);
  if (/^\s*(?:the |your )?recap/iu.test(input.chatLine)) errors.push("chatLine: lead with the finished game and its result, not with the recap being ready.");
  if (/made the recap|recap'?s (?:ready|up|in)\b|recap is (?:ready|up|in)\b|your week is ready/iu.test(input.chatLine)) {
    errors.push("chatLine: skip stock recap phrases and invitations; the next line already supplies the link.");
  }
  if (input.result && input.result.length === 2) {
    const scores = input.result.map((player) => player.score).sort((a, b) => a - b);
    for (const match of input.chatLine.matchAll(CHAT_SCORE)) {
      const stated = [Number(match[1]), Number(match[2])].sort((a, b) => a - b);
      if (stated[0] !== scores[0] || stated[1] !== scores[1]) errors.push(`chatLine: score must match the settled result (${scores.join(" to ")}).`);
    }
  }
  const current = wordGrams(chatLineMoment(input.chatLine, input.players));
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
      errors.push("scoreLine: the settled result is a tie; name the players and describe the tie without owe, owes, owed or owing.");
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

type RecapValidationInput = { recap: HostedGameRecap; players: readonly string[]; entries: readonly GameRecapEntry[]; chatMessages?: readonly GameRecapChatMessage[]; priorChatLines?: readonly string[]; result?: readonly GameRecapCanonicalScore[]; group?: boolean; show?: boolean; usedTreatments?: readonly string[] };

function blockLimit(input: RecapValidationInput): number { return input.show && !input.group ? 4 : 3; }

function validateRecapPolicy(input: RecapValidationInput, errors: string[]): void {
  const pages = input.recap.pages;
  if ((!input.show || input.group) && (input.recap.treatment !== undefined || input.recap.song !== undefined || pages.some(page => page.blocks.some(block => block.kind === "scene" || block.scene !== undefined)))) errors.push("Show fields require an enabled pair show generation.");
  if (input.group) {
    const expected = input.result?.map(player => player.memberId) ?? [];
    if (!input.recap.superlatives || !withValidGameSuperlatives(input.recap, expected, true).superlatives) errors.push("superlatives: include exactly one kind superlative per eligible player.");
    const copy = JSON.stringify(input.recap);
    if (/\b(slacker|lazy|no.show|didn.t post|did not post|behind everyone)\b/iu.test(copy)) errors.push("Group recaps must not shame or single out missing people.");
    if (input.recap.scoreLine) errors.push("scoreLine: omit for groups; the result card owns standings and prize parties.");
  }
  if (input.show && !input.group) validateRecapShow(input, errors);
}

export function validateGameRecap(input: RecapValidationInput): string[] {
  const errors: string[] = [];
  const entries = new Map(input.entries.map((entry) => [entry.entryId, entry]));
  const pages = input.recap.pages;
  validateRecapPolicy(input, errors);
  if (pages.length < 3 || pages.length > 7) errors.push(`pages: ${pages.length}; write 3 to 7.`);
  pages.forEach((page, pageIndex) => {
    const number = pageIndex + 1;
    if (!BACKGROUNDS.has(page.background)) errors.push(`page ${number}: background must be one of ['night', 'paper', 'sage', 'sienna', 'slate'].`);
    if (page.blocks.length < 1 || page.blocks.length > blockLimit(input)) errors.push(`page ${number}: ${page.blocks.length} blocks; use 1 to ${blockLimit(input)}.`);
    page.blocks.forEach((block, blockIndex) => validateRecapBlock({ block, blockIndex: blockIndex + 1, chatMessages: input.chatMessages ?? [], entries, errors, pageIndex: number, players: input.players }));
  });

  const quotePages = pages.map((page) => page.blocks.filter((block) => block.kind === "quote").length);
  if (quotePages.filter((count) => count >= 2).length > 1) errors.push("Only one page can stack several quotes (a back-and-forth). Let your headlines carry the other pages.");
  const pagesWithQuotes = quotePages.filter(Boolean).length;
  if (pages.length > 0 && pagesWithQuotes > Math.ceil(pages.length / 2)) errors.push(`Quotes on ${pagesWithQuotes} of ${pages.length} pages; keep them to about half and let your own lines carry the rest.`);
  const { scoreLine } = input.recap;
  if (scoreLine !== undefined) {
    checkText("scoreLine", scoreLine, 80, errors);
    if (/\d+\s*[–-]\s*\d+/u.test(scoreLine)) errors.push("scoreLine: the card already shows the score; land the result and who owes what instead.");
    if (!input.players.some((player) => scoreLine.includes(player))) errors.push("scoreLine: name who owes whom.");
    if (SECOND_PERSON.test(scoreLine)) errors.push("scoreLine: write about them by name, not you.");
    if (input.result) validateScoreLine(scoreLine, input.result, errors);
  }
  validateChatLine({ chatLine: input.recap.chatLine, players: input.players, priorChatLines: input.priorChatLines ?? [], result: input.result }, errors);
  return errors;
}

export function gameRecapToolResult(errors: readonly string[]): string {
  return errors.length === 0 ? "ok: saved. The players will see this recap." : `Not saved. Fix these and call write_recap again:\n- ${errors.join("\n- ")}`;
}

/** Optional copy must never prevent the story from being saved or read. */
export function withValidGameSuperlatives(recap: HostedGameRecap, memberIds: readonly string[], group = memberIds.length > 2): HostedGameRecap {
  const { superlatives, ...story } = recap;
  return superlatives && (group ? superlatives.length === memberIds.length : superlatives.length >= 1 && superlatives.length <= 2) && (memberIds.length >= 2 && memberIds.length <= 10 && new Set(memberIds).size === memberIds.length)
    && new Set(superlatives.map(item => item.memberId)).size === superlatives.length
    && superlatives.every((item) => memberIds.includes(item.memberId))
    ? { ...story, superlatives } : story;
}

function normalizeTreatment(value: string): string { return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " "); }
