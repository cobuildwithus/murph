import type {
  CompactTablePresentationCardV1,
  WorkoutSessionExerciseV1,
} from "@murphai/contracts";

import { IMESSAGE_CARD_COLOR } from "./card-image-chrome";

export const IMESSAGE_COMPACT_TABLE_CARD_IMAGE_WIDTH = 1_200;

const CARD_HORIZONTAL_PADDING = 45;
const CARD_CONTENT_WIDTH =
  IMESSAGE_COMPACT_TABLE_CARD_IMAGE_WIDTH - CARD_HORIZONTAL_PADDING * 2;
const HEADER_TEXT_WIDTH = CARD_CONTENT_WIDTH;
const GENERIC_ROW_LABEL_WIDTH = CARD_CONTENT_WIDTH * 0.38;
const GENERIC_VALUES_WIDTH = CARD_CONTENT_WIDTH * 0.62;
const CARD_GRAPHEME_SEGMENTER = new Intl.Segmenter("en", {
  granularity: "grapheme",
});

type WrappedCardText = {
  lineCount: number;
  text: string;
};

type WorkoutExerciseLayout = {
  height: number;
  name: WrappedCardText;
  supportingText: WrappedCardText;
};

type GenericRowLayout = {
  height: number;
  label: WrappedCardText;
  values: WrappedCardText[];
};

type CompactTableCardImageLayout = {
  footer: WrappedCardText | null;
  headerHeight: number;
  height: number;
  subtitle: WrappedCardText | null;
  title: WrappedCardText;
  tableHeader?: {
    columns: WrappedCardText[];
    height: number;
    rowHeader: WrappedCardText;
  };
  tableRows?: GenericRowLayout[];
  workoutRows?: WorkoutExerciseLayout[];
};

export function getCompactTableCardImageSize(
  card: CompactTablePresentationCardV1,
): { width: number; height: number } {
  const layout = getCompactTableCardImageLayout(card);
  return {
    width: IMESSAGE_COMPACT_TABLE_CARD_IMAGE_WIDTH,
    height: layout.height,
  };
}

/**
 * Mirrors the shipping SwiftUI compact-table snapshot at a wider raster size.
 * Messages owns the app icon and outer corner mask, so the bitmap stays
 * rectangular and badge-free.
 */
export function CompactTableCardImage({
  card,
}: {
  card: CompactTablePresentationCardV1;
}) {
  const layout = getCompactTableCardImageLayout(card);
  return (
    <div
      data-design-contract="imessage-native-compact-table-card"
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        flexDirection: "column",
        padding: `38px ${CARD_HORIZONTAL_PADDING}px 42px`,
        backgroundColor: IMESSAGE_CARD_COLOR.balloon,
        color: IMESSAGE_CARD_COLOR.primary,
        fontFamily: "DM Sans",
      }}
    >
      <div
        style={{
          display: "flex",
          height: layout.headerHeight,
          flexDirection: "column",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 48,
            fontWeight: 600,
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
            whiteSpace: "pre-wrap",
          }}
          data-card-text-lines={layout.title.lineCount}
        >
          {layout.title.text}
        </div>
        {card.subtitle === null ? null : (
          <div
            style={{
              display: "flex",
              color: IMESSAGE_CARD_COLOR.secondary,
              fontSize: 28,
              lineHeight: 1.2,
              whiteSpace: "pre-wrap",
            }}
            data-card-text-lines={layout.subtitle?.lineCount}
          >
            {layout.subtitle?.text}
          </div>
        )}
      </div>

      {"workout" in card
        ? <WorkoutSnapshot card={card} rows={layout.workoutRows ?? []} />
        : (
            <GenericTableSnapshot
              card={card}
              header={layout.tableHeader}
              rows={layout.tableRows ?? []}
            />
          )}

      {card.footer === null ? null : (
        <div
          style={{
            display: "flex",
            marginTop: 22,
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: 24,
            lineHeight: 1.25,
            whiteSpace: "pre-wrap",
          }}
          data-card-text-lines={layout.footer?.lineCount}
        >
          {layout.footer?.text}
        </div>
      )}
    </div>
  );
}

function WorkoutSnapshot({
  card,
  rows,
}: {
  card: Extract<CompactTablePresentationCardV1, { workout: unknown }>;
  rows: WorkoutExerciseLayout[];
}) {
  const progress = card.workout.exercises.reduce(
    (counts, exercise) => ({
      completed:
        counts.completed
        + exercise.sets.filter((set) => set.status === "completed").length,
      total: counts.total + exercise.sets.length,
    }),
    { completed: 0, total: 0 },
  );
  const progressFraction = progress.completed / progress.total;

  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: "0.08em",
          }}
        >
          {card.workout.state === "active" ? "TODAY" : "WORKOUT COMPLETE"}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {progress.completed}/{progress.total} sets
        </div>
      </div>
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          width: "100%",
          height: 14,
          overflow: "hidden",
          marginTop: 15,
          borderRadius: 999,
          backgroundColor: IMESSAGE_CARD_COLOR.progressTrack,
        }}
      >
        <div
          data-workout-progress={progressFraction.toFixed(4)}
          style={{
            display: "flex",
            width: `${progressFraction * 100}%`,
            height: "100%",
            borderRadius: 999,
            backgroundColor: IMESSAGE_CARD_COLOR.primary,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: 18,
          borderTop: `2px solid ${IMESSAGE_CARD_COLOR.divider}`,
        }}
      >
        {card.workout.exercises.map((exercise, index) => (
          <WorkoutExerciseRow
            key={index}
            exercise={exercise}
            layout={rows[index] ?? getWorkoutExerciseLayout(exercise)}
          />
        ))}
      </div>
    </div>
  );
}

function WorkoutExerciseRow({
  exercise,
  layout,
}: {
  exercise: WorkoutSessionExerciseV1;
  layout: WorkoutExerciseLayout;
}) {
  const completed = exercise.sets.filter(
    (set) => set.status === "completed",
  ).length;
  const resolved = exercise.sets.every(
    (set) => set.status === "completed" || set.status === "skipped",
  );

  return (
    <div
      style={{
        display: "flex",
        height: layout.height,
        alignItems: "center",
        borderBottom: `2px solid ${IMESSAGE_CARD_COLOR.divider}`,
        gap: 18,
      }}
    >
      <div
        aria-hidden="true"
        data-exercise-state={
          resolved ? "resolved" : completed > 0 ? "in-progress" : "pending"
        }
        style={{
          position: "relative",
          display: "flex",
          width: 28,
          height: 28,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          border: resolved
            ? "none"
            : `3px solid ${IMESSAGE_CARD_COLOR.secondary}`,
          borderRadius: 999,
          backgroundColor: resolved ? "#337338" : "transparent",
          color: "#FFF5E6",
          fontSize: 20,
          fontWeight: 600,
        }}
      >
        {!resolved && completed > 0 ? (
          <span
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 0,
              display: "flex",
              width: "50%",
              backgroundColor: IMESSAGE_CARD_COLOR.secondary,
            }}
          />
        ) : null}
        {resolved ? "✓" : ""}
      </div>
      <div
        style={{
          display: "flex",
          minWidth: 0,
          flex: 1,
          flexDirection: "column",
          gap: 3,
        }}
      >
        <div
          data-card-text-lines={layout.name.lineCount}
          style={{
            display: "flex",
            fontSize: 31,
            fontWeight: 600,
            lineHeight: 1.05,
            whiteSpace: "pre-wrap",
          }}
        >
          {layout.name.text}
        </div>
        <div
          style={{
            display: "flex",
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: 23,
            lineHeight: 1.2,
            whiteSpace: "pre-wrap",
          }}
          data-card-text-lines={layout.supportingText.lineCount}
        >
          {layout.supportingText.text}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          color: IMESSAGE_CARD_COLOR.secondary,
          fontSize: 30,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {completed}/{exercise.sets.length}
      </div>
    </div>
  );
}

function GenericTableSnapshot({
  card,
  header,
  rows,
}: {
  card: Exclude<CompactTablePresentationCardV1, { workout: unknown }>;
  header: CompactTableCardImageLayout["tableHeader"];
  rows: GenericRowLayout[];
}) {
  const valueWidth = `${62 / card.columns.length}%`;
  const valueFontSize = card.columns.length >= 3 ? 23 : 28;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: 30,
        borderTop: `2px solid ${IMESSAGE_CARD_COLOR.divider}`,
      }}
    >
      <div
        style={{
          display: "flex",
          height: header?.height ?? 66,
          alignItems: "center",
          color: IMESSAGE_CARD_COLOR.secondary,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "0.07em",
        }}
      >
        <div
          data-card-text-lines={header?.rowHeader.lineCount}
          style={{
            display: "flex",
            width: "38%",
            lineHeight: 1.2,
            whiteSpace: "pre-wrap",
          }}
        >
          {header?.rowHeader.text ?? card.rowHeader.toUpperCase()}
        </div>
        {card.columns.map((column, index) => (
          <div
            key={index}
            style={{
              display: "flex",
              width: valueWidth,
              justifyContent: "flex-end",
              lineHeight: 1.2,
              textAlign: "right",
              whiteSpace: "pre-wrap",
            }}
            data-card-text-lines={header?.columns[index]?.lineCount}
          >
            {header?.columns[index]?.text ?? column.toUpperCase()}
          </div>
        ))}
      </div>
      {card.rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          style={{
            display: "flex",
            height: rows[rowIndex]?.height ?? 84,
            alignItems: "center",
            borderTop: `2px solid ${IMESSAGE_CARD_COLOR.divider}`,
          }}
        >
          <div
            style={{
              display: "flex",
              width: "38%",
              paddingRight: 20,
              fontSize: 29,
              fontWeight: 600,
              lineHeight: 1.15,
              whiteSpace: "pre-wrap",
            }}
            data-card-text-lines={rows[rowIndex]?.label.lineCount}
          >
            {rows[rowIndex]?.label.text ?? row.label}
          </div>
          {row.values.map((value, index) => (
            <div
              key={index}
              style={{
                display: "flex",
                width: valueWidth,
                justifyContent: "flex-end",
                paddingLeft: 12,
                fontSize: valueFontSize,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.15,
                textAlign: "right",
                whiteSpace: "pre-wrap",
              }}
              data-card-text-lines={rows[rowIndex]?.values[index]?.lineCount}
            >
              {rows[rowIndex]?.values[index]?.text ?? value}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function getCompactTableCardImageLayout(
  card: CompactTablePresentationCardV1,
): CompactTableCardImageLayout {
  const title = wrapCardText(card.title, HEADER_TEXT_WIDTH, 48);
  const subtitle = card.subtitle === null
    ? null
    : wrapCardText(card.subtitle, HEADER_TEXT_WIDTH, 28);
  const footer = card.footer === null
    ? null
    : wrapCardText(card.footer, CARD_CONTENT_WIDTH, 24);
  const headerHeight = Math.max(
    105,
    Math.ceil(
      title.lineCount * 48 * 1.05
      + (subtitle === null ? 0 : 8 + subtitle.lineCount * 28 * 1.2),
    ),
  );
  const footerHeight = footer === null
    ? 0
    : 22 + Math.ceil(footer.lineCount * 24 * 1.25);
  const rowCount = "workout" in card
    ? card.workout.exercises.length
    : card.rows.length;
  const legacyHeight = 330 + rowCount * 90 + (footer === null ? 0 : 70);

  if ("workout" in card) {
    const workoutRows = card.workout.exercises.map(getWorkoutExerciseLayout);
    const measuredHeight =
      38 + headerHeight + 26 + 36 + 15 + 14 + 18
      + workoutRows.reduce((total, row) => total + row.height, 0)
      + footerHeight + 42;
    return {
      footer,
      headerHeight,
      height: Math.max(568, legacyHeight, measuredHeight),
      subtitle,
      title,
      workoutRows,
    };
  }

  const valueWidth = GENERIC_VALUES_WIDTH / card.columns.length;
  const valueFontSize = card.columns.length >= 3 ? 23 : 28;
  const rowHeader = wrapCardText(
    card.rowHeader.toUpperCase(),
    GENERIC_ROW_LABEL_WIDTH,
    22,
    0.07,
  );
  const columns = card.columns.map((column) =>
    wrapCardText(column.toUpperCase(), valueWidth, 22, 0.07)
  );
  const tableHeaderHeight = Math.max(
    66,
    20 + Math.ceil(
      Math.max(rowHeader.lineCount, ...columns.map((column) => column.lineCount))
      * 22 * 1.2,
    ),
  );
  const tableRows = card.rows.map((row) => {
    const label = wrapCardText(
      row.label,
      GENERIC_ROW_LABEL_WIDTH - 20,
      29,
    );
    const values = row.values.map((value) =>
      wrapCardText(value, valueWidth - 12, valueFontSize)
    );
    const textHeight = Math.max(
      label.lineCount * 29 * 1.15,
      ...values.map((value) => value.lineCount * valueFontSize * 1.15),
    );
    return {
      height: Math.max(84, 20 + Math.ceil(textHeight)),
      label,
      values,
    };
  });
  const measuredHeight =
    38 + headerHeight + 30 + tableHeaderHeight
    + tableRows.reduce((total, row) => total + row.height, 0)
    + footerHeight + 42;
  return {
    footer,
    headerHeight,
    height: Math.max(568, legacyHeight, measuredHeight),
    subtitle,
    tableHeader: {
      columns,
      height: tableHeaderHeight,
      rowHeader,
    },
    tableRows,
    title,
  };
}

function getWorkoutExerciseLayout(
  exercise: WorkoutSessionExerciseV1,
): WorkoutExerciseLayout {
  const nextPendingSet = exercise.sets.find((set) => set.status === "pending");
  const supportingValue = nextPendingSet?.target !== null
      && nextPendingSet?.target !== undefined
    ? `Next: ${nextPendingSet.target}`
    : nextPendingSet !== undefined
      ? "Next set: no target"
      : exercise.sets.some((set) => set.status === "skipped")
        ? `${exercise.sets.filter((set) => set.status === "skipped").length} skipped`
        : "Complete";
  const textWidth = CARD_CONTENT_WIDTH - 125;
  const name = wrapCardText(exercise.name, textWidth, 31);
  const supportingText = wrapCardText(supportingValue, textWidth, 23);
  return {
    height: Math.max(
      86,
      22 + Math.ceil(
        name.lineCount * 31 * 1.05
        + 3
        + supportingText.lineCount * 23 * 1.2,
      ),
    ),
    name,
    supportingText,
  };
}

function wrapCardText(
  value: string,
  width: number,
  fontSize: number,
  letterSpacingEm = 0,
): WrappedCardText {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine === "" ? word : `${currentLine} ${word}`;
    if (measureCardText(candidate, fontSize, letterSpacingEm) <= width) {
      currentLine = candidate;
      continue;
    }

    if (currentLine !== "") {
      lines.push(currentLine);
    }
    const fragments = breakOverwideCardToken(
      word,
      width,
      fontSize,
      letterSpacingEm,
    );
    lines.push(...fragments.slice(0, -1));
    currentLine = fragments[fragments.length - 1] ?? "";
  }

  if (currentLine !== "" || lines.length === 0) {
    lines.push(currentLine);
  }

  return {
    lineCount: lines.length,
    text: lines.join("\n"),
  };
}

function breakOverwideCardToken(
  token: string,
  width: number,
  fontSize: number,
  letterSpacingEm: number,
): string[] {
  const fragments: string[] = [];
  let currentFragment = "";

  for (const grapheme of segmentCardGraphemes(token)) {
    const candidate = `${currentFragment}${grapheme}`;
    if (
      currentFragment !== ""
      && measureCardText(candidate, fontSize, letterSpacingEm) > width
    ) {
      fragments.push(currentFragment);
      currentFragment = grapheme;
      continue;
    }
    currentFragment = candidate;
  }

  if (currentFragment !== "" || fragments.length === 0) {
    fragments.push(currentFragment);
  }
  return fragments;
}

function measureCardText(
  value: string,
  fontSize: number,
  letterSpacingEm: number,
): number {
  const graphemes = segmentCardGraphemes(value);
  const textUnits = graphemes.reduce(
    (total, grapheme) => total + getCardGraphemeWidthUnits(grapheme),
    0,
  );
  const letterSpacing = Math.max(0, graphemes.length - 1)
    * fontSize
    * letterSpacingEm;
  return textUnits * fontSize + letterSpacing;
}

function segmentCardGraphemes(value: string): string[] {
  return Array.from(
    CARD_GRAPHEME_SEGMENTER.segment(value),
    (segment) => segment.segment,
  );
}

function getCardGraphemeWidthUnits(grapheme: string): number {
  const normalized = grapheme.normalize("NFC");
  if (/\p{Extended_Pictographic}/u.test(normalized)) return 1;
  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
      .test(normalized)
  ) {
    return 1;
  }

  const character = Array.from(normalized)[0] ?? "";
  if (character === " ") return 0.28;
  if ("il.,;:!'|".includes(character)) return 0.26;
  if ("mwMW@#%&".includes(character)) return 0.9;
  if (/\p{Lu}/u.test(character)) return 0.68;
  if (/\p{Nd}/u.test(character)) return 0.56;
  return 0.54;
}
