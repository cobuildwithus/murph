import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Which drawing a prize ticket carries. The iOS app picks one from the prize's words, and a recap video
 * has to show the same one, so this is that rule ported step for step from the app's Swift, including
 * the places where Swift and JavaScript read text differently. The drawings and the words that call them
 * up are copied from the app by scripts/sync-stake-art.ts; test/stake-art.test.ts holds this file to
 * what the app's own code answered for thousands of prizes.
 */

interface Catalog {
  stopWords: string[];
  stakes: { id: string; title: string; keywords: string }[];
  ideas: { title: string; art: string }[];
}
interface Index {
  /** A suggested prize's plain words → the drawing it was written for. */
  ideas: Map<string, string>;
  /** A drawing's own plain title → that drawing. */
  titles: Map<string, string>;
  /** Every drawing with the words of its title and the extra words that call it up, in the app's order. */
  stakes: { id: string; title: Set<string>; keywords: Set<string> }[];
  /** Words too common to pick a drawing by. */
  stop: Set<string>;
}

/** The drawing for words that match nothing. */
const GIFT = "a-tiny-surprise-gift";
const ARTICLES = new Set(["a", "an", "the", "their"]);
/** Latin, Greek and Cyrillic end here. Apple's accent-blind folding strips accents from these letters only. */
const ACCENTS_STRIPPED_BELOW = 0x510;
/** What Apple's folding counts as riding on the letter before it: accents, vowel points, an emoji's skin tone. */
const MARK = /^[\p{Grapheme_Extend}\u{1F3FB}-\u{1F3FF}]$/u;
/** Small letters JavaScript's case mapping would change and Apple's leaves alone: dotless i and nine old Cyrillic shapes. */
const KEEPS_ITS_CASE = /^[\u0131\u1C80-\u1C88]$/u;
/** Everything between words: whatever is not a letter, mark or digit, plus two scripts Apple's letter table leaves out (Todhri, Tangut). */
const GAP = /(?:[^\p{L}\p{M}\p{N}]|[\u{105C0}-\u{105F3}\u{17000}-\u{187FF}\u{18D00}-\u{18D1E}])+/u;

const codeOf = (text: string): number => text.codePointAt(0) ?? 0;
/** Text as the characters a reader sees, which is how Swift walks it: a letter with its accents, or an emoji with its skin tone, is one. */
const characters = new Intl.Segmenter("en", { granularity: "grapheme" });
const seen = (text: string): string[] => Array.from(characters.segment(text), part => part.segment);

/**
 * "A massage" → "Massage", "their pick" → "Pick": one leading article goes before a prize is looked up
 * by its whole title. Only a plain space ends the first word, and the rest starts with a capital, as in
 * the app.
 */
function withoutLeadingArticle(title: string): string {
  const parts = seen(title);
  const start = parts.findIndex(part => part !== " ");
  const space = parts.indexOf(" ", Math.max(start, 0));
  const rest = parts.slice(space + 1);
  if (start < 0 || space < 0 || rest.length === 0 || !ARTICLES.has(parts.slice(start, space).join("").toLowerCase())) return title;
  return (rest[0] ?? "").toUpperCase() + rest.slice(1).join("");
}

/** A Latin, Greek or Cyrillic letter with its accent built in ("é") as the bare letter; any other character as it is. */
function bare(letter: string): string {
  const first = Array.from(letter.normalize("NFD"))[0] ?? letter;
  return first !== letter && codeOf(first) < ACCENTS_STRIPPED_BELOW ? first : letter;
}

/** A letter with its case folded away the way Apple does it: "É" and "é" are the same, "ß" is "ss". */
const withoutCase = (letter: string): string => KEEPS_ITS_CASE.test(letter) ? letter : letter.toLowerCase().toUpperCase().toLowerCase();

/** The marks Unicode's standard order puts first and last when several are stacked on one letter. */
const FIRST_IN_ORDER = "\u0334", LAST_IN_ORDER = "\u0345";
/** Whether that order ever moves this mark: it does if the mark changes places with one of those two. Most accents can move; an enclosing circle or a skin tone stays put. */
const moves = (mark: string): boolean => (mark + FIRST_IN_ORDER).normalize("NFD") !== mark + FIRST_IN_ORDER || (LAST_IN_ORDER + mark).normalize("NFD") !== LAST_IN_ORDER + mark;

/** The marks kept on a letter, in Apple's order: the ones that never move first, then the rest in Unicode's standard order. */
function inAppleOrder(marks: string): string {
  const each = Array.from(marks);
  return each.filter(mark => !moves(mark)).join("") + each.filter(moves).join("").normalize("NFD");
}

/**
 * Text with case and accents folded away, as Apple's `folding` does for the app. It is not the textbook
 * rule: a Latin, Greek or Cyrillic letter loses every mark on it, while letters of other scripts keep
 * theirs (but lose a first Latin-style accent when nothing else about the letter changed), so each
 * letter is taken together with the marks that follow it.
 */
function folded(text: string): string {
  const points = Array.from(text);
  let out = "";
  for (let at = 0; at < points.length;) {
    const start = points[at++] ?? "";
    const letter = withoutCase(bare(start));
    let marks = "", untouched = letter === start;
    for (; MARK.test(points[at] ?? ""); at++) {
      const mark = points[at] ?? "";
      if (!(untouched && codeOf(mark) < ACCENTS_STRIPPED_BELOW)) marks += mark.normalize("NFD");
      untouched = false;
    }
    if (codeOf(letter) < ACCENTS_STRIPPED_BELOW) out += letter;
    // Text that opens with a mark has that mark ordered along with the ones after it.
    else out += MARK.test(start) && start.normalize("NFD") === start ? inAppleOrder(letter + marks) : letter + inAppleOrder(marks);
  }
  return out;
}

/**
 * A prize's words in small plain letters with single spaces: "  Crème brûlée!" → "creme brulee". Swift
 * treats two spellings of the same accented letter as equal, so the result is put in one spelling.
 */
const plain = (text: string): string => folded(text).split(GAP).filter(Boolean).join(" ").normalize("NFC");

/** The words of plain text. Swift does not split at a space that carries a mark, so neither does this. */
function wordsOf(text: string): string[] {
  const words: string[] = [];
  let word = "";
  for (const part of [...seen(text), " "]) {
    if (part !== " ") word += part;
    else if (word) {
      words.push(word);
      word = "";
    }
  }
  return words;
}

function readIndex(): Index {
  const catalog: Catalog = JSON.parse(readFileSync(fileURLToPath(new URL("../assets/stake-art/catalog.json", import.meta.url)), "utf8"));
  const stop = new Set(catalog.stopWords);
  const ideas = new Map<string, string>();
  for (const idea of catalog.ideas) {
    // The app takes the first suggested prize with the same words, and never matches empty words.
    const key = plain(withoutLeadingArticle(idea.title));
    if (key && !ideas.has(key)) ideas.set(key, idea.art);
  }
  return {
    ideas,
    titles: new Map(catalog.stakes.map(stake => [plain(withoutLeadingArticle(stake.title)), stake.id])),
    stakes: catalog.stakes.map(stake => ({
      id: stake.id,
      title: new Set(wordsOf(plain(stake.title)).filter(word => !stop.has(word))),
      keywords: new Set(wordsOf(plain(stake.keywords))),
    })),
    stop,
  };
}

let index: Index | undefined;

/**
 * The drawing whose words the prize shares most, or nothing when the overlap is too thin. Whole words
 * only, so "tea" is not found in "theater". A title word counts three and an extra word one; a drawing
 * is in the running when the prize holds its whole title, or at least half the prize's words are its
 * words: "cold" alone does not turn a cold plunge into an iced coffee. The first best drawing wins.
 */
function byWords(prize: string, { stakes, stop }: Index): string | undefined {
  const words = [...new Set(wordsOf(plain(prize)))].filter(word => !stop.has(word));
  let best: string | undefined, bestScore = 0;
  for (const stake of stakes) {
    const inTitle = words.filter(word => stake.title.has(word)).length, inKeywords = words.filter(word => stake.keywords.has(word)).length;
    const matched = words.filter(word => stake.title.has(word) || stake.keywords.has(word)).length;
    const score = inTitle * 3 + inKeywords;
    if (matched > 0 && (inTitle === stake.title.size || matched * 2 >= words.length) && score > bestScore) {
      best = stake.id;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The id of the drawing the app shows for a prize: the one a suggested prize was written for, else the
 * drawing with that exact title, else the closest by its words, else the gift.
 */
export function stakeArtId(prize: string): string {
  index ??= readIndex();
  const key = plain(withoutLeadingArticle(prize));
  return index.ideas.get(key) ?? index.titles.get(key) ?? byWords(prize, index) ?? GIFT;
}

/** Where that drawing is on disk. */
export const stakeArtFile = (prize: string): string => fileURLToPath(new URL(`../assets/stake-art/${stakeArtId(prize)}.svg`, import.meta.url));
