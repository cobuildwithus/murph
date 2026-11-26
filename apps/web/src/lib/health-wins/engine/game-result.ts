import { addDays } from "../../game/time";
import { formatWinDate } from "./shared";
import { streakDateRange } from "./streak";
import type { CardSpec } from "./types";

type PayoffPlayer = { memberId: string; firstName: string; score: number; won: boolean };

export interface GameResultCharts {
  game_result: {
    type: "game_result";
    contest: string;
    lengthDays: number;
    players: [PayoffPlayer, PayoffPlayer];
    stake: { kind: "prize" | "dare"; item: string };
    paid: true;
  };
}

type GameResultInput = Pick<GameResultCharts["game_result"], "contest" | "lengthDays" | "players" | "stake">
  & { gameId: string; startDate: string };

/** Players are ordered by the settled result, with the winner first. */
export function buildGameResultCard({ gameId, startDate, contest, lengthDays, players, stake }: GameResultInput): Extract<CardSpec, { kind: "game_result" }> {
  const endDate = addDays(startDate, lengthDays - 1);
  const range = lengthDays === 1 ? formatWinDate(startDate, endDate) : streakDateRange(startDate, endDate, endDate);
  return {
    id: `game:${gameId}`, kind: "game_result", filter: "Challenges", theme: "challenges",
    title: { number: `${players[0].score}–${players[1].score}`, measure: "" },
    subtitle: `${contest} · ${lengthDays} ${lengthDays === 1 ? "day" : "days"}`,
    source_note: `Final score, ${range}.`,
    chart: { type: "game_result", contest, lengthDays, players, stake, paid: true },
    share: { caption_tips: ["How did it go down?", "Rematch?"] },
  };
}
