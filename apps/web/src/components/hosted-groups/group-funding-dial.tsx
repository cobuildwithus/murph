"use client";

import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { cn } from "@/src/lib/utils";

// Angles run clockwise from 12 o'clock. The arc opens at the bottom, so low
// amounts sit lower left and high amounts lower right.
const DIAL_SIZE = 320;
const DIAL_CENTER = DIAL_SIZE / 2;
const DIAL_RADIUS = 110;
const DIAL_STOP_LABEL_RADIUS = 150;
const DIAL_START_DEGREES = 225;
const DIAL_SWEEP_DEGREES = 270;
const DIAL_STROKE_WIDTH = 10;
const DIAL_SETTLE_TRANSITION =
  "duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none";

interface GroupFundingDialOption<Value extends number | string> {
  amountLabel: string;
  value: Value;
}

interface GroupFundingDialDrag {
  lastAngleDegrees: number;
  unclampedSweepDegrees: number;
}

function GroupFundingDial<Value extends number | string>({
  caption,
  disabled = false,
  label,
  onValueChange,
  options,
  value,
}: {
  caption: string;
  disabled?: boolean;
  label: string;
  onValueChange: (value: Value) => void;
  options: readonly GroupFundingDialOption<Value>[];
  value: Value;
}) {
  const dialRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<GroupFundingDialDrag | null>(null);
  const [dragSweepDegrees, setDragSweepDegrees] = useState<number | null>(null);
  const [turned, setTurned] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selectedOption = options[selectedIndex];
  if (!selectedOption) {
    return null;
  }

  const lastIndex = options.length - 1;
  const stopSweepDegrees = (index: number) =>
    lastIndex > 0 ? (DIAL_SWEEP_DEGREES * index) / lastIndex : 0;
  const dragging = dragSweepDegrees !== null;
  const sweepDegrees = dragSweepDegrees ?? stopSweepDegrees(selectedIndex);

  function selectIndex(index: number) {
    const option = options[index];
    if (option && option.value !== value) {
      onValueChange(option.value);
    }
  }

  function readPointerAngleDegrees(event: PointerEvent<HTMLDivElement>) {
    const bounds = dialRef.current?.getBoundingClientRect();
    if (!bounds) {
      return 0;
    }
    const x = event.clientX - (bounds.left + bounds.width / 2);
    const y = event.clientY - (bounds.top + bounds.height / 2);
    return ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      lastAngleDegrees: readPointerAngleDegrees(event),
      unclampedSweepDegrees: sweepDegrees,
    };
    setDragSweepDegrees(sweepDegrees);
    setTurned(true);
  }

  // Following the change in angle, not the absolute angle, keeps the knob under
  // the finger and stops it jumping across the gap from one end to the other.
  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const angleDegrees = readPointerAngleDegrees(event);
    drag.unclampedSweepDegrees +=
      ((angleDegrees - drag.lastAngleDegrees + 540) % 360) - 180;
    drag.lastAngleDegrees = angleDegrees;
    const nextSweepDegrees = Math.min(
      DIAL_SWEEP_DEGREES,
      Math.max(0, drag.unclampedSweepDegrees),
    );
    setDragSweepDegrees(nextSweepDegrees);
    selectIndex(
      Math.round((nextSweepDegrees / DIAL_SWEEP_DEGREES) * lastIndex),
    );
  }

  function handlePointerEnd() {
    dragRef.current = null;
    setDragSweepDegrees(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) {
      return;
    }
    const nextIndex = readKeyboardIndex(event.key, selectedIndex, lastIndex);
    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    setTurned(true);
    selectIndex(nextIndex);
  }

  return (
    <div
      ref={dialRef}
      className={cn(
        "@container relative mx-auto aspect-square w-full max-w-80 select-none",
        disabled && "opacity-60",
      )}
      data-slot="group-funding-dial"
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full"
        viewBox={`0 0 ${DIAL_SIZE} ${DIAL_SIZE}`}
      >
        <path
          className="stroke-muted"
          d={DIAL_ARC_PATH}
          fill="none"
          strokeLinecap="round"
          strokeWidth={DIAL_STROKE_WIDTH}
        />
        <path
          className={cn(
            "stroke-primary",
            !dragging &&
              cn("transition-[stroke-dasharray]", DIAL_SETTLE_TRANSITION),
          )}
          d={DIAL_ARC_PATH}
          fill="none"
          pathLength={DIAL_SWEEP_DEGREES}
          strokeDasharray={`${sweepDegrees} ${DIAL_SWEEP_DEGREES + 1}`}
          strokeLinecap="round"
          strokeWidth={DIAL_STROKE_WIDTH}
        />
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-serif text-[24cqw] font-semibold leading-none tracking-[-0.03em] tabular-nums text-foreground">
          {selectedOption.amountLabel}
        </span>
        <span className="mt-2 text-sm font-medium text-muted-foreground">
          {caption}
        </span>
      </div>

      {options.map((option, index) => {
        const point = readDialPoint(
          stopSweepDegrees(index),
          DIAL_STOP_LABEL_RADIUS,
        );
        return (
          <button
            key={option.value}
            aria-label={`${option.amountLabel} ${caption}`}
            className={cn(
              "absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-sm font-medium tabular-nums text-muted-foreground transition-colors duration-150 disabled:pointer-events-none",
              index === selectedIndex && "font-semibold text-foreground",
            )}
            disabled={disabled}
            onClick={() => selectIndex(index)}
            style={{
              left: `${(point.x / DIAL_SIZE) * 100}%`,
              top: `${(point.y / DIAL_SIZE) * 100}%`,
            }}
            tabIndex={-1}
            type="button"
          >
            {option.amountLabel}
          </button>
        );
      })}

      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 bottom-[9%] text-center text-xs text-muted-foreground transition-opacity duration-200",
          (turned || disabled) && "opacity-0",
        )}
      >
        Drag the dot
      </span>

      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          !dragging && cn("transition-[rotate]", DIAL_SETTLE_TRANSITION),
        )}
        style={{ rotate: `${DIAL_START_DEGREES + sweepDegrees}deg` }}
      >
        <div
          aria-disabled={disabled || undefined}
          aria-label={label}
          aria-valuemax={lastIndex}
          aria-valuemin={0}
          aria-valuenow={selectedIndex}
          aria-valuetext={`${selectedOption.amountLabel} ${caption}`}
          className={cn(
            "group/knob pointer-events-auto absolute left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full outline-none",
            disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing",
          )}
          data-dragging={dragging ? "true" : undefined}
          data-slot="group-funding-dial-knob"
          onKeyDown={handleKeyDown}
          onLostPointerCapture={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          role="slider"
          style={{ top: `${((DIAL_CENTER - DIAL_RADIUS) / DIAL_SIZE) * 100}%` }}
          tabIndex={disabled ? -1 : 0}
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-primary ring-4 ring-background transition-[scale] duration-150 group-focus-visible/knob:outline-2 group-focus-visible/knob:outline-offset-4 group-focus-visible/knob:outline-ring group-data-[dragging=true]/knob:scale-110 motion-reduce:transition-none">
            <span className="size-2 rounded-full bg-primary-foreground" />
          </span>
        </div>
      </div>
    </div>
  );
}

function readKeyboardIndex(
  key: string,
  selectedIndex: number,
  lastIndex: number,
): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return Math.min(lastIndex, selectedIndex + 1);
    case "ArrowLeft":
    case "ArrowDown":
      return Math.max(0, selectedIndex - 1);
    case "Home":
      return 0;
    case "End":
      return lastIndex;
    default:
      return null;
  }
}

function readDialPoint(sweepDegrees: number, radius: number) {
  const radians = ((DIAL_START_DEGREES + sweepDegrees) * Math.PI) / 180;
  return {
    x: DIAL_CENTER + radius * Math.sin(radians),
    y: DIAL_CENTER - radius * Math.cos(radians),
  };
}

function readDialArcPath() {
  const start = readDialPoint(0, DIAL_RADIUS);
  const end = readDialPoint(DIAL_SWEEP_DEGREES, DIAL_RADIUS);
  return `M ${start.x} ${start.y} A ${DIAL_RADIUS} ${DIAL_RADIUS} 0 1 1 ${end.x} ${end.y}`;
}

const DIAL_ARC_PATH = readDialArcPath();

export { GroupFundingDial };
export type { GroupFundingDialOption };
