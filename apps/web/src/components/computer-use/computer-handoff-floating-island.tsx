"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { cn } from "@/src/lib/utils";

const DEFAULT_STORAGE_KEY = "murph.computer-handoff.island-offset.v2";
const VIEWPORT_MARGIN = 12;

type Offset = { x: number; y: number };
const DEFAULT_OFFSET: Offset = { x: 0, y: 0 };

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  naturalLeft: number;
  naturalTop: number;
  width: number;
  height: number;
}

function readStoredOffset(persistKey: string | null): Offset | null {
  if (!persistKey) return null;
  try {
    const raw = window.localStorage.getItem(persistKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Offset>;
    if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // ignore corrupted storage
  }
  return null;
}

export function ComputerHandoffFloatingIsland({
  handle,
  children,
  persistKey = DEFAULT_STORAGE_KEY,
}: {
  handle: ReactNode;
  children: ReactNode;
  persistKey?: string | null;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const storedOffset = useStoredOffset(persistKey);
  const [offsetOverride, setOffsetOverride] = useState<Offset | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const offset = offsetOverride ?? storedOffset;
  const setOffset = useCallback((next: Offset | ((current: Offset) => Offset)) => {
    setOffsetOverride((current) => {
      const base = current ?? storedOffset;
      return typeof next === "function" ? next(base) : next;
    });
  }, [storedOffset]);

  const reclampToViewport = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    setOffset((current) => {
      const rect = el.getBoundingClientRect();
      const naturalLeft = rect.left - current.x;
      const naturalTop = rect.top - current.y;
      const minX = VIEWPORT_MARGIN - naturalLeft;
      const maxX =
        window.innerWidth - VIEWPORT_MARGIN - naturalLeft - rect.width;
      const minY = VIEWPORT_MARGIN - naturalTop;
      const maxY =
        window.innerHeight - VIEWPORT_MARGIN - naturalTop - rect.height;
      const x = Math.min(Math.max(current.x, minX), Math.max(minX, maxX));
      const y = Math.min(Math.max(current.y, minY), Math.max(minY, maxY));
      if (x === current.x && y === current.y) return current;
      return { x, y };
    });
  }, [setOffset]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(reclampToViewport);
    window.addEventListener("resize", reclampToViewport);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", reclampToViewport);
    };
  }, [reclampToViewport]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = el.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
      naturalLeft: rect.left - offset.x,
      naturalTop: rect.top - offset.y,
      width: rect.width,
      height: rect.height,
    };
    setGrabbing(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const minX = VIEWPORT_MARGIN - state.naturalLeft;
    const maxX =
      window.innerWidth - VIEWPORT_MARGIN - state.naturalLeft - state.width;
    const minY = VIEWPORT_MARGIN - state.naturalTop;
    const maxY =
      window.innerHeight - VIEWPORT_MARGIN - state.naturalTop - state.height;
    const x = Math.min(Math.max(state.baseX + dx, minX), Math.max(minX, maxX));
    const y = Math.min(Math.max(state.baseY + dy, minY), Math.max(minY, maxY));
    setOffset({ x, y });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setGrabbing(false);
    if (!persistKey) return;
    try {
      window.localStorage.setItem(
        persistKey,
        JSON.stringify({
          x: state.baseX + (event.clientX - state.startX),
          y: state.baseY + (event.clientY - state.startY),
        }),
      );
    } catch {
      // ignore quota errors
    }
  };

  return (
    <div
      ref={rootRef}
      className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border/60 bg-card/95 px-3 py-2 shadow-lg shadow-black/15 backdrop-blur-md transition-shadow"
      style={{
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
        boxShadow: grabbing
          ? "0 18px 40px -16px rgb(0 0 0 / 0.35)"
          : undefined,
      }}
    >
      <div
        className={cn(
          "-my-2 -ml-3 flex select-none items-center gap-3 self-stretch py-2 pl-3 pr-1",
          grabbing ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label="Drag to reposition"
        role="presentation"
      >
        {handle}
      </div>
      {children}
    </div>
  );
}

function useStoredOffset(persistKey: string | null): Offset {
  const raw = useSyncExternalStore(
    subscribeToStoredOffset,
    () => readStoredOffsetRaw(persistKey),
    () => null,
  );
  return useMemo(() => parseStoredOffset(raw), [raw]);
}

function subscribeToStoredOffset() {
  return () => {};
}

function readStoredOffsetRaw(persistKey: string | null): string | null {
  if (!persistKey || typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(persistKey);
  } catch {
    // ignore corrupted storage
  }
  return null;
}

function parseStoredOffset(raw: string | null): Offset {
  if (!raw) {
    return DEFAULT_OFFSET;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Offset>;
    if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
      return { x: parsed.x, y: parsed.y };
    }
  } catch {
    // ignore corrupted storage
  }
  return DEFAULT_OFFSET;
}
