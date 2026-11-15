import { RecapVideoRefusal, type RecapVideoInput, type RecapVideoPage } from "./types.js";

/** The most a recap show holds, from its contract. Anything past these is refused before any work is done on it. */
const MAX_PAGES = 11, MAX_BLOCKS = 4, MAX_SHEET = 9, MAX_TEXT = 1000, MAX_LYRIC_LINES = 20, MAX_LYRIC = 500;

const refuse = (message: string): never => {
  throw new RecapVideoRefusal("unsupported_page", message);
};
const tooLong = (text: string | undefined, most = MAX_TEXT): boolean => (text?.length ?? 0) > most;
const tokens = (line: string): string[] => line.trim().split(/\s+/u).filter(Boolean);

/** The song's words must be its lyrics, word for word, each with a time that makes sense inside the song. */
function requireSong(song: NonNullable<RecapVideoPage["song"]>, songMs: number): void {
  if (song.lyrics.length === 0 || song.lyrics.length > MAX_LYRIC_LINES || tooLong(song.title) || song.lyrics.some(line => tooLong(line, MAX_LYRIC))) {
    refuse("The song is longer than a recap's song can be.");
  }
  if (!song.lines) return;
  const fits = song.lines.length === song.lyrics.length && song.lines.every((line, index) => {
    const texts = tokens(song.lyrics[index] ?? "");
    return line.words.length === texts.length && line.words.every((word, at) => word.text === texts[at]);
  });
  let previous = 0;
  const timed = song.lines.every(line => line.words.every(word => {
    const ordered = Number.isFinite(word.startMs) && Number.isFinite(word.endMs) && word.startMs >= previous && word.endMs >= word.startMs && word.startMs <= songMs;
    previous = word.startMs;
    return ordered;
  }));
  if (!fits || !timed) throw new RecapVideoRefusal("invalid_soundtrack", "The song's word timings do not match its lyrics.");
}

const blockTooLarge = (block: RecapVideoPage["blocks"][number]): boolean =>
  [block.text, block.statValue, block.quote?.text, block.quote?.who, block.quote?.date].some(text => tooLong(text)) || (block.entryIds?.length ?? 0) > MAX_SHEET;

/** A page holds what its kind has a place for, and no more of it than a recap's page can. */
function requirePage(page: RecapVideoPage): void {
  if (page.blocks.length > MAX_BLOCKS) refuse("A page holds four blocks at most.");
  if (page.blocks.some(blockTooLarge) || tooLong(page.card?.title) || tooLong(page.card?.line)) refuse("A page's words are longer than a recap's can be.");
  const kinds = page.blocks.map(block => block.kind);
  // The cover is its title, under the small label a page may open with.
  if (page.kind === "cover" && (kinds.filter(kind => kind === "headline").length !== 1 || kinds.some(kind => kind !== "headline" && kind !== "kicker"))) {
    refuse("The cover holds one title.");
  }
  if (["superlative", "song", "result"].includes(page.kind) && kinds.length > 0) refuse(`A ${page.kind} page holds no blocks.`);
}

/**
 * Refuses a show that is larger than a recap can be, or that carries
 * something its page kind has no place for: every block on every page is
 * either drawn or a refusal, never left out.
 */
export function requireShape(input: RecapVideoInput): void {
  const { pages } = input.show;
  const title = input.stake.kind === "none" ? undefined : input.stake.title;
  if (pages.length > MAX_PAGES || tooLong(input.show.treatment) || tooLong(title) || Object.values(input.players).some(player => tooLong(player.name))) {
    refuse("The show is larger than a recap can be.");
  }
  if (title !== undefined && title.trim() === "") throw new RecapVideoRefusal("unsupported_stake", "The game's stake has no words.");
  pages.forEach(requirePage);
  for (const kind of ["song", "result"]) {
    if (pages.filter(page => page.kind === kind).length > 1) refuse("A show has one song and one result.");
  }
  for (const page of pages) {
    if (page.song) requireSong(page.song, input.score.songMs);
  }
}
