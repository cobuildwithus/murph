import localFont from "next/font/local";

export const fraunces = localFont({
  src: [
    { path: "./fonts/Fraunces-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Fraunces-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-serif",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

export const dmSans = localFont({
  src: "./fonts/DMSans-Variable.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "100 1000",
  style: "normal",
});

export const dmMono = localFont({
  src: "./fonts/DMMono-400.woff2",
  variable: "--font-mono",
  display: "swap",
  weight: "400",
  style: "normal",
});
