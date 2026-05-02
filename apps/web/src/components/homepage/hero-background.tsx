"use client";

import Image from "next/image";
import { useCallback, useRef, useState } from "react";

export function HeroBackground() {
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    if (el.readyState >= 3) {
      setVideoReady(true);
    } else {
      el.addEventListener("canplay", () => setVideoReady(true), { once: true });
    }
  }, []);

  return (
    <>
      <Image
        preload
        fill
        sizes="100vw"
        src="/hero.jpg"
        alt=""
        style={{ objectFit: "cover", objectPosition: "80% center" }}
        className="sm:[object-position:center]"
      />
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 sm:[object-position:center] ${
          videoReady ? "opacity-100" : "opacity-0"
        }`}
        style={{ objectPosition: "80% center" }}
        src="/hero.mp4"
      />
    </>
  );
}
