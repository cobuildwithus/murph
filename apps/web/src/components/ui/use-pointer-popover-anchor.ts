"use client";

import { useCallback, useMemo, useRef } from "react";
import type { KeyboardEventHandler, PointerEventHandler } from "react";

interface PointerAnchorState {
  active: boolean;
  x: number;
  y: number;
}

export function usePointerPopoverAnchor() {
  const point = useRef<PointerAnchorState>({ active: false, x: 0, y: 0 });
  const virtualAnchor = useMemo(
    () => ({
      getBoundingClientRect: () =>
        new DOMRect(point.current.x, point.current.y, 0, 0),
    }),
    [],
  );

  const anchor = useCallback(
    () => (point.current.active ? virtualAnchor : null),
    [virtualAnchor],
  );
  const onKeyDown = useCallback<KeyboardEventHandler<HTMLElement>>(() => {
    point.current.active = false;
  }, []);
  const onPointerMove = useCallback<PointerEventHandler<HTMLElement>>(
    (event) => {
      point.current = {
        active: event.pointerType === "mouse",
        x: event.clientX,
        y: event.clientY,
      };
    },
    [],
  );

  return { anchor, onKeyDown, onPointerMove };
}
