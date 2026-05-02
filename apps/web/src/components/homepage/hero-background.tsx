"use client";

import Image from "next/image";
import { useRef, useState } from "react";

export function HeroBackground() {
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

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
        onCanPlay={() => setVideoReady(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 sm:[object-position:center] ${
          videoReady ? "opacity-100" : "opacity-0"
        }`}
        style={{ objectPosition: "80% center" }}
        src="/hero.mp4"
      />
    </>
  );
}
