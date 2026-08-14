import { describe, expect, it } from "vitest";

import {
  renderTelegramRichContentResponseCardTextV1,
  telegramRichContentResponseCardV1Schema,
} from "../src/telegram-rich-content-card.ts";

function parseHtml(html: string) {
  return telegramRichContentResponseCardV1Schema.safeParse({
    kind: "telegram_rich_content",
    version: 1,
    html,
  });
}

describe("Telegram rich content card", () => {
  it("derives readable text from the accepted presentation", () => {
    const card = telegramRichContentResponseCardV1Schema.parse({
      kind: "telegram_rich_content",
      version: 1,
      html: '<h2>Weekly plan</h2><p>Calm &amp; steady.</p><table bordered striped><caption>Sessions</caption><tr><th>Day</th><th align="right">Time</th></tr><tr><td>Monday</td><td align="right">20 min</td></tr></table><details><summary>Optional note</summary><p>Move it if needed.</p></details><blockquote>Stop if symptoms increase.</blockquote>',
    });

    expect(renderTelegramRichContentResponseCardTextV1(card)).toBe(
      "Weekly plan\nCalm & steady.\nSessions\nDay | Time\nMonday | 20 min\nOptional note\nMove it if needed.\n\n> Stop if symptoms increase.",
    );
  });

  it("ignores formatting whitespace inside structural containers", () => {
    const card = telegramRichContentResponseCardV1Schema.parse({
      kind: "telegram_rich_content",
      version: 1,
      html: `
        <h2>Plan</h2>
        <ul>
          <li>First</li>
          <li>Second</li>
        </ul>
        <table>
          <tr><th>Day</th><th>Time</th></tr>
          <tr><td>Monday</td><td>20 min</td></tr>
        </table>
      `,
    });

    expect(renderTelegramRichContentResponseCardTextV1(card)).toBe(
      "Plan\n\n• First\n• Second\n\nDay | Time\nMonday | 20 min",
    );
  });

  it.each([
    ["unknown tag", "<h2>Guide</h2><script>Bad</script>"],
    ["remote image", '<h2>Guide</h2><img src="https://example.test/a.png">'],
    ["link", '<h2>Guide</h2><a href="https://example.test">Source</a>'],
    ["deleted text", "<h2>Guide</h2><del>Done</del>"],
    ["short struck text", "<h2>Guide</h2><s>Done</s>"],
    ["struck text", "<h2>Guide</h2><strike>Done</strike>"],
    ["subscript", "<h2>Guide</h2><sub>2</sub>"],
    ["superscript", "<h2>Guide</h2><sup>2</sup>"],
    ["spoiler", "<h2>Guide</h2><tg-spoiler>Hidden</tg-spoiler>"],
    ["attribute", '<h2 class="title">Guide</h2>'],
    ["entity", "<h2>Guide &copy;</h2>"],
    ["invalid numeric entity", "<h2>Guide &#0;</h2>"],
    ["wrong closing order", "<h2><b>Guide</h2></b>"],
    ["missing details summary", "<details><p>Hidden</p></details>"],
    [
      "summary after content",
      "<details><p>Hidden</p><summary>More</summary></details>",
    ],
    ["stray list text", "<ul>Bad<li>Good</li></ul>"],
    ["stray table content", "<table><p>Bad</p><tr><td>Good</td></tr></table>"],
    [
      "repeated table caption",
      "<table><caption>One</caption><caption>Two</caption><tr><td>Good</td></tr></table>",
    ],
    [
      "late table caption",
      "<table><tr><td>Good</td></tr><caption>Late</caption></table>",
    ],
    ["plain paragraph", "<p>This should stay an ordinary reply.</p>"],
  ])("rejects %s", (_label, html) => {
    expect(parseHtml(html).success).toBe(false);
  });

  it("bounds table width, table height, nesting, and fallback text", () => {
    const sixCells = Array.from(
      { length: 6 },
      (_, index) => `<td>${index}</td>`,
    ).join("");
    expect(parseHtml(`<table><tr>${sixCells}</tr></table>`).success).toBe(
      false,
    );

    const thirteenRows = Array.from(
      { length: 13 },
      (_, index) => `<tr><td>${index}</td></tr>`,
    ).join("");
    expect(parseHtml(`<table>${thirteenRows}</table>`).success).toBe(false);

    expect(
      parseHtml(
        `<details><summary>1</summary>${"<details><summary>More</summary>".repeat(
          6,
        )}Text${"</details>".repeat(6)}</details>`,
      ).success,
    ).toBe(false);

    expect(parseHtml(`<h2>${"x".repeat(4_097)}</h2>`).success).toBe(false);
  });
});
