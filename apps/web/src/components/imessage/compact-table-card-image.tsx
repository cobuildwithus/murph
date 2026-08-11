import type {
  CompactTablePresentationCardV1,
  WorkoutSessionExerciseV1,
} from "@murphai/contracts";

import {
  IMessageCardHeader,
  IMESSAGE_CARD_COLOR,
  IMESSAGE_CARD_HEADER_BESIDE_BADGE_INSET,
  IMESSAGE_CARD_HEADER_SUBTITLE_FONT_SIZE,
  IMESSAGE_CARD_HEADER_TEXT_GAP,
  IMESSAGE_CARD_HEADER_TITLE_FONT_SIZE,
} from "./card-image-chrome";
import {
  measureDmSans400Text,
  segmentDmSans400Text,
} from "./dm-sans-400-card-metrics";
import {
  measureDmSans600Text,
  segmentDmSans600Text,
} from "./dm-sans-600-card-metrics";

export const IMESSAGE_COMPACT_TABLE_CARD_IMAGE_WIDTH = 1_200;

const CARD_HORIZONTAL_PADDING = 45;
const CARD_CONTENT_WIDTH =
  IMESSAGE_COMPACT_TABLE_CARD_IMAGE_WIDTH - CARD_HORIZONTAL_PADDING * 2;
const HEADER_TEXT_WIDTH =
  CARD_CONTENT_WIDTH - IMESSAGE_CARD_HEADER_BESIDE_BADGE_INSET;
const FOOTER_FONT_SIZE = 49;
const CAPTION_2_FONT_SIZE = 41;
const CAPTION_FONT_SIZE = 45;
const SUBHEADLINE_FONT_SIZE = 56;
const GENERIC_ROW_LABEL_WIDTH = CARD_CONTENT_WIDTH * 0.38;
const GENERIC_VALUES_WIDTH = CARD_CONTENT_WIDTH * 0.62;
const INTRINSIC_TRACK_SAFETY_PADDING = 4;

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
  genericMode?: "grid" | "stacked";
  tableHeader?: {
    columnWidths: number[];
    columns: WrappedCardText[];
    height: number;
    rowHeader: WrappedCardText;
    rowHeaderWidth: number;
    stackedColumns: WrappedCardText[];
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
 * Messages owns the outer corner mask; the bitmap owns Murph's canonical mark.
 */
export function CompactTableCardImage({
  card,
  logoSrc = "/icons/murph-mark.svg",
}: {
  card: CompactTablePresentationCardV1;
  logoSrc?: string;
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
      <IMessageCardHeader
        height={layout.headerHeight}
        logoSrc={logoSrc}
        subtitle={"workout" in card ? null : layout.subtitle}
        title={layout.title}
      />

      {"workout" in card
        ? <WorkoutSnapshot card={card} rows={layout.workoutRows ?? []} />
        : (
            <GenericTableSnapshot
              card={card}
              header={layout.tableHeader}
              mode={layout.genericMode ?? "grid"}
              rows={layout.tableRows ?? []}
            />
          )}

      {card.footer === null ? null : (
        <div
          style={{
            display: "flex",
            marginTop: 45,
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: FOOTER_FONT_SIZE,
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
    <div style={{ display: "flex", flexDirection: "column", marginTop: 45 }}>
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
            fontSize: CAPTION_2_FONT_SIZE,
            fontWeight: 600,
            letterSpacing: "0.08em",
          }}
        >
          {card.workout.state === "active"
            ? "IN PROGRESS"
            : "WORKOUT COMPLETE"}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: SUBHEADLINE_FONT_SIZE,
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
          marginTop: 26,
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
            backgroundColor: IMESSAGE_CARD_COLOR.systemAccent,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: 45,
        }}
      >
        {card.workout.exercises.map((exercise, index) => (
          <WorkoutExerciseRow
            key={index}
            exercise={exercise}
            isLast={index === card.workout.exercises.length - 1}
            layout={rows[index] ?? getWorkoutExerciseLayout(exercise)}
          />
        ))}
      </div>
    </div>
  );
}

function WorkoutExerciseRow({
  exercise,
  isLast,
  layout,
}: {
  exercise: WorkoutSessionExerciseV1;
  isLast: boolean;
  layout: WorkoutExerciseLayout;
}) {
  const completed = exercise.sets.filter(
    (set) => set.status === "completed",
  ).length;
  const resolved = exercise.sets.every(
    (set) => set.status === "completed" || set.status === "skipped",
  );
  const allCompleted = completed === exercise.sets.length;

  return (
    <div
      style={{
        display: "flex",
        height: layout.height,
        alignItems: "center",
        borderBottom: isLast
          ? "none"
          : `2px solid ${IMESSAGE_CARD_COLOR.divider}`,
        gap: 38,
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
          width: 64,
          height: 64,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          border: resolved
            ? "none"
            : `3px solid ${IMESSAGE_CARD_COLOR.secondary}`,
          borderRadius: 999,
          backgroundColor: resolved
            ? allCompleted ? "#34C759" : IMESSAGE_CARD_COLOR.secondary
            : "transparent",
          color: "#FFF5E6",
          fontSize: 45,
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
        {resolved ? (
          <svg
            aria-hidden="true"
            data-exercise-checkmark="true"
            width={42}
            height={42}
            viewBox="0 0 18 18"
          >
            <path
              d="M3.5 9.5 7.25 13 14.5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
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
            fontSize: SUBHEADLINE_FONT_SIZE,
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
            fontSize: CAPTION_FONT_SIZE,
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
          fontSize: SUBHEADLINE_FONT_SIZE,
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
  mode,
  rows,
}: {
  card: Exclude<CompactTablePresentationCardV1, { workout: unknown }>;
  header: CompactTableCardImageLayout["tableHeader"];
  mode: "grid" | "stacked";
  rows: GenericRowLayout[];
}) {
  if (mode === "stacked") {
    return <GenericStackedRows card={card} header={header} rows={rows} />;
  }

  const valueFontSize = SUBHEADLINE_FONT_SIZE;

  return (
    <div
      data-compact-table-layout="grid"
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: 45,
      }}
    >
      <div
        style={{
          display: "flex",
          height: header?.height ?? 66,
          alignItems: "center",
          gap: 38,
          color: IMESSAGE_CARD_COLOR.secondary,
          fontSize: CAPTION_2_FONT_SIZE,
          fontWeight: 600,
          letterSpacing: "0.07em",
        }}
      >
        <div
          data-card-text-lines={header?.rowHeader.lineCount}
          style={{
            display: "flex",
            width: header?.rowHeaderWidth ?? GENERIC_ROW_LABEL_WIDTH,
            flexShrink: 0,
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
              width: header?.columnWidths[index] ?? GENERIC_VALUES_WIDTH
                / card.columns.length,
              flexShrink: 0,
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
            height: rows[rowIndex]?.height ?? 93,
            alignItems: "center",
            gap: 38,
            borderTop: `2px solid ${IMESSAGE_CARD_COLOR.divider}`,
          }}
        >
          <div
            style={{
              display: "flex",
              width: header?.rowHeaderWidth ?? GENERIC_ROW_LABEL_WIDTH,
              flexShrink: 0,
              fontSize: SUBHEADLINE_FONT_SIZE,
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
                width: header?.columnWidths[index] ?? GENERIC_VALUES_WIDTH
                  / card.columns.length,
                flexShrink: 0,
                justifyContent: "flex-end",
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

function GenericStackedRows({
  card,
  header,
  rows,
}: {
  card: Exclude<CompactTablePresentationCardV1, { workout: unknown }>;
  header: CompactTableCardImageLayout["tableHeader"];
  rows: GenericRowLayout[];
}) {
  return (
    <div
      data-compact-table-layout="stacked"
      style={{
        display: "flex",
        flexDirection: "column",
        marginTop: 45,
      }}
    >
      {card.rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          style={{
            display: "flex",
            minHeight: rows[rowIndex]?.height,
            flexDirection: "column",
            padding: "34px 0",
            borderBottom: rowIndex === card.rows.length - 1
              ? "none"
              : `2px solid ${IMESSAGE_CARD_COLOR.divider}`,
          }}
        >
          <div
            data-card-text-lines={rows[rowIndex]?.label.lineCount}
            style={{
              display: "flex",
              fontSize: SUBHEADLINE_FONT_SIZE,
              fontWeight: 600,
              lineHeight: 1.15,
              whiteSpace: "pre-wrap",
            }}
          >
            {rows[rowIndex]?.label.text ?? row.label}
          </div>
          {row.values.map((value, valueIndex) => (
            <div
              key={valueIndex}
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 23,
                gap: 8,
              }}
            >
              <div
                data-card-text-lines={
                  header?.stackedColumns[valueIndex]?.lineCount
                }
                style={{
                  display: "flex",
                  color: IMESSAGE_CARD_COLOR.secondary,
                  fontSize: CAPTION_FONT_SIZE,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  whiteSpace: "pre-wrap",
                }}
              >
                {header?.stackedColumns[valueIndex]?.text
                  ?? card.columns[valueIndex]}
              </div>
              <div
                data-card-text-lines={rows[rowIndex]?.values[valueIndex]?.lineCount}
                style={{
                  display: "flex",
                  width: "100%",
                  justifyContent: "flex-end",
                  fontSize: SUBHEADLINE_FONT_SIZE,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.2,
                  textAlign: "right",
                  whiteSpace: "pre-wrap",
                }}
              >
                {rows[rowIndex]?.values[valueIndex]?.text ?? value}
              </div>
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
  const title = wrapCardText(
    card.title,
    HEADER_TEXT_WIDTH,
    IMESSAGE_CARD_HEADER_TITLE_FONT_SIZE,
    600,
  );
  const subtitle = "workout" in card || card.subtitle === null
    ? null
    : wrapCardText(
      card.subtitle,
      HEADER_TEXT_WIDTH,
      IMESSAGE_CARD_HEADER_SUBTITLE_FONT_SIZE,
    );
  const footer = card.footer === null
    ? null
    : wrapCardText(card.footer, CARD_CONTENT_WIDTH, FOOTER_FONT_SIZE);
  const measuredHeaderHeight = Math.ceil(
    title.lineCount * IMESSAGE_CARD_HEADER_TITLE_FONT_SIZE * 1.1
    + (subtitle === null
      ? 0
      : IMESSAGE_CARD_HEADER_TEXT_GAP
        + subtitle.lineCount * IMESSAGE_CARD_HEADER_SUBTITLE_FONT_SIZE * 1.2),
  );
  const headerHeight = Math.max(101, measuredHeaderHeight);
  const footerHeight = footer === null
    ? 0
    : 45 + Math.ceil(footer.lineCount * FOOTER_FONT_SIZE * 1.2);

  if ("workout" in card) {
    const workoutRows = card.workout.exercises.map(getWorkoutExerciseLayout);
    const dividerHeight = Math.max(0, workoutRows.length - 1) * 2;
    const measuredHeight =
      38 + headerHeight + 45
      + Math.ceil(SUBHEADLINE_FONT_SIZE * 1.2) + 26 + 15 + 45
      + workoutRows.reduce((total, row) => total + row.height, 0)
      + dividerHeight
      + footerHeight + 42;
    return {
      footer,
      headerHeight,
      height: measuredHeight,
      subtitle,
      title,
      workoutRows,
    };
  }

  const gridWidths = getCompactTableGridWidths(card);
  const genericMode = gridWidths.totalWidth <= CARD_CONTENT_WIDTH
    ? "grid"
    : "stacked";
  const valueWidth = GENERIC_VALUES_WIDTH / card.columns.length;
  const rowHeader = wrapCardText(
    card.rowHeader.toUpperCase(),
    gridWidths.rowHeaderWidth,
    CAPTION_2_FONT_SIZE,
    600,
    0.07,
  );
  const columns = card.columns.map((column, index) =>
    wrapCardText(
      column.toUpperCase(),
      gridWidths.columnWidths[index] ?? valueWidth,
      CAPTION_2_FONT_SIZE,
      600,
      0.07,
    )
  );
  const stackedColumns = card.columns.map((column) =>
    wrapCardText(column, CARD_CONTENT_WIDTH, CAPTION_FONT_SIZE, 600)
  );
  const tableHeaderHeight = Math.max(
    75,
    26 + Math.ceil(
      Math.max(rowHeader.lineCount, ...columns.map((column) => column.lineCount))
      * CAPTION_2_FONT_SIZE * 1.2,
    ),
  );
  const tableRows = card.rows.map((row) => {
    const label = wrapCardText(
      row.label,
      genericMode === "grid"
        ? gridWidths.rowHeaderWidth
        : CARD_CONTENT_WIDTH,
      SUBHEADLINE_FONT_SIZE,
      600,
    );
    const values = row.values.map((value, index) =>
      wrapCardText(
        value,
        genericMode === "grid"
          ? gridWidths.columnWidths[index] ?? valueWidth
          : CARD_CONTENT_WIDTH,
        SUBHEADLINE_FONT_SIZE,
      )
    );
    const textHeight = genericMode === "grid"
      ? Math.max(
        label.lineCount * SUBHEADLINE_FONT_SIZE * 1.15,
        ...values.map((value) =>
          value.lineCount * SUBHEADLINE_FONT_SIZE * 1.15
        ),
      )
      : label.lineCount * SUBHEADLINE_FONT_SIZE * 1.15
        + values.reduce(
          (height, value, index) =>
            height + 23
            + (stackedColumns[index]?.lineCount ?? 1) * CAPTION_FONT_SIZE * 1.2
            + 8
            + value.lineCount * SUBHEADLINE_FONT_SIZE * 1.2,
          0,
        );
    return {
      height: genericMode === "grid"
        ? Math.max(93, 26 + Math.ceil(textHeight))
        : 68 + Math.ceil(textHeight),
      label,
      values,
    };
  });
  const tableHeight = genericMode === "grid"
    ? tableHeaderHeight
      + tableRows.reduce((total, row) => total + row.height, 0)
    : tableRows.reduce((total, row) => total + row.height, 0)
      + Math.max(0, tableRows.length - 1) * 2;
  const measuredHeight =
    38 + headerHeight + 45 + tableHeight
    + footerHeight + 42;
  return {
    footer,
    genericMode,
    headerHeight,
    height: measuredHeight,
    subtitle,
    tableHeader: {
      columnWidths: gridWidths.columnWidths,
      columns,
      height: tableHeaderHeight,
      rowHeader,
      rowHeaderWidth: gridWidths.rowHeaderWidth,
      stackedColumns,
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
  const textWidth = CARD_CONTENT_WIDTH - 215;
  const name = wrapCardText(
    exercise.name,
    textWidth,
    SUBHEADLINE_FONT_SIZE,
    600,
  );
  const supportingText = wrapCardText(
    supportingValue,
    textWidth,
    CAPTION_FONT_SIZE,
  );
  return {
    height: Math.max(
      124,
      60 + Math.ceil(
        name.lineCount * SUBHEADLINE_FONT_SIZE * 1.15
        + 11
        + supportingText.lineCount * CAPTION_FONT_SIZE * 1.2,
      ),
    ),
    name,
    supportingText,
  };
}

function getCompactTableGridWidths(
  card: Exclude<CompactTablePresentationCardV1, { workout: unknown }>,
): { columnWidths: number[]; rowHeaderWidth: number; totalWidth: number } {
  const rowHeaderWidth = Math.ceil(
    Math.max(
      measureDmSans600Text(
        card.rowHeader.toUpperCase(),
        CAPTION_2_FONT_SIZE,
        0.07,
      ),
      ...card.rows.map((row) =>
        measureDmSans600Text(row.label, SUBHEADLINE_FONT_SIZE)
      ),
    ),
  ) + INTRINSIC_TRACK_SAFETY_PADDING;
  const columnWidths = card.columns.map((column, index) =>
    Math.ceil(
      Math.max(
        measureDmSans600Text(
          column.toUpperCase(),
          CAPTION_2_FONT_SIZE,
          0.07,
        ),
        ...card.rows.map((row) =>
          measureDmSans400Text(
            row.values[index] ?? "",
            SUBHEADLINE_FONT_SIZE,
          )
        ),
      ),
    ) + INTRINSIC_TRACK_SAFETY_PADDING
  );
  const horizontalSpacing = card.columns.length * 38;
  return {
    columnWidths,
    rowHeaderWidth,
    totalWidth: rowHeaderWidth
      + columnWidths.reduce((total, width) => total + width, 0)
      + horizontalSpacing,
  };
}

function wrapCardText(
  value: string,
  width: number,
  fontSize: number,
  fontWeight: 400 | 600 = 400,
  letterSpacingEm = 0,
): WrappedCardText {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine === "" ? word : `${currentLine} ${word}`;
    if (measureCardText(candidate, fontSize, fontWeight, letterSpacingEm) <= width) {
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
      fontWeight,
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
  fontWeight: 400 | 600,
  letterSpacingEm: number,
): string[] {
  const fragments: string[] = [];
  let currentFragment = "";

  const graphemes = fontWeight === 600
    ? segmentDmSans600Text(token)
    : segmentDmSans400Text(token);
  for (const grapheme of graphemes) {
    const candidate = `${currentFragment}${grapheme}`;
    if (
      currentFragment !== ""
      && measureCardText(candidate, fontSize, fontWeight, letterSpacingEm) > width
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
  fontWeight: 400 | 600,
  letterSpacingEm: number,
): number {
  return fontWeight === 600
    ? measureDmSans600Text(value, fontSize, letterSpacingEm)
    : measureDmSans400Text(value, fontSize, letterSpacingEm);
}
