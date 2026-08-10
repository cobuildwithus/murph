import type {
  CompactTablePresentationCardV1,
  WorkoutSessionExerciseV1,
} from "@murphai/contracts";

import {
  IMESSAGE_CARD_COLOR,
  ImessageCardBadge,
} from "./card-image-chrome";

export const IMESSAGE_COMPACT_TABLE_CARD_IMAGE_WIDTH = 1_200;

export function getCompactTableCardImageSize(
  card: CompactTablePresentationCardV1,
): { width: number; height: number } {
  const rowCount = "workout" in card
    ? card.workout.exercises.length
    : card.rows.length;
  return {
    width: IMESSAGE_COMPACT_TABLE_CARD_IMAGE_WIDTH,
    height: Math.max(568, 330 + rowCount * 90 + (card.footer === null ? 0 : 70)),
  };
}

/** Mirrors the shipping SwiftUI compact-table snapshot at a wider raster size. */
export function CompactTableCardImage({
  card,
}: {
  card: CompactTablePresentationCardV1;
}) {
  return (
    <div
      data-design-contract="imessage-native-compact-table-card"
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        flexDirection: "column",
        borderRadius: 105,
        padding: "38px 45px 42px",
        backgroundColor: IMESSAGE_CARD_COLOR.balloon,
        color: IMESSAGE_CARD_COLOR.primary,
        fontFamily: "DM Sans",
      }}
    >
      <ImessageCardBadge top={30} left={30} />
      <div
        style={{
          display: "flex",
          minHeight: 105,
          flexDirection: "column",
          justifyContent: "center",
          marginLeft: 155,
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
          }}
        >
          {card.title}
        </div>
        {"workout" in card || card.subtitle === null ? null : (
          <div
            style={{
              display: "flex",
              color: IMESSAGE_CARD_COLOR.secondary,
              fontSize: 28,
              lineHeight: 1.2,
            }}
          >
            {card.subtitle}
          </div>
        )}
      </div>

      {"workout" in card
        ? <WorkoutSnapshot card={card} />
        : <GenericTableSnapshot card={card} />}

      {card.footer === null ? null : (
        <div
          style={{
            display: "flex",
            marginTop: 22,
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: 24,
            lineHeight: 1.25,
          }}
        >
          {card.footer}
        </div>
      )}
    </div>
  );
}

function WorkoutSnapshot({
  card,
}: {
  card: Extract<CompactTablePresentationCardV1, { workout: unknown }>;
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
          {card.workout.state === "active"
            ? "IN PROGRESS"
            : "WORKOUT COMPLETE"}
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
          <WorkoutExerciseRow key={index} exercise={exercise} />
        ))}
      </div>
    </div>
  );
}

function WorkoutExerciseRow({
  exercise,
}: {
  exercise: WorkoutSessionExerciseV1;
}) {
  const completed = exercise.sets.filter(
    (set) => set.status === "completed",
  ).length;
  const pendingTarget = exercise.sets.find(
    (set) => set.status === "pending" && set.target !== null,
  )?.target;
  const skipped = exercise.sets.filter(
    (set) => set.status === "skipped",
  ).length;
  const resolved = exercise.sets.every(
    (set) => set.status === "completed" || set.status === "skipped",
  );
  const supportingText = pendingTarget !== undefined
    ? `Next: ${pendingTarget}`
    : skipped > 0
      ? `${skipped} skipped`
      : resolved
        ? "Complete"
        : "Ready";

  return (
    <div
      style={{
        display: "flex",
        minHeight: 86,
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
        {resolved ? (
          <svg
            aria-hidden="true"
            data-exercise-checkmark="true"
            width={18}
            height={18}
            viewBox="0 0 18 18"
          >
            <path
              d="M3.5 9.5 7.25 13 14.5 5"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
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
        <div style={{ display: "flex", fontSize: 31, fontWeight: 600 }}>
          {exercise.name}
        </div>
        <div
          style={{
            display: "flex",
            color: IMESSAGE_CARD_COLOR.secondary,
            fontSize: 23,
          }}
        >
          {supportingText}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          color: IMESSAGE_CARD_COLOR.secondary,
          fontSize: 30,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {completed}/{exercise.sets.length}
      </div>
    </div>
  );
}

function GenericTableSnapshot({
  card,
}: {
  card: Exclude<CompactTablePresentationCardV1, { workout: unknown }>;
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
          minHeight: 66,
          alignItems: "center",
          color: IMESSAGE_CARD_COLOR.secondary,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "0.07em",
        }}
      >
        <div style={{ display: "flex", width: "38%" }}>
          {card.rowHeader.toUpperCase()}
        </div>
        {card.columns.map((column, index) => (
          <div
            key={index}
            style={{
              display: "flex",
              width: valueWidth,
              justifyContent: "flex-end",
              textAlign: "right",
            }}
          >
            {column.toUpperCase()}
          </div>
        ))}
      </div>
      {card.rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          style={{
            display: "flex",
            minHeight: 84,
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
            }}
          >
            {row.label}
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
              }}
            >
              {value}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
