import localFont from "next/font/local";
import { dmSansFontUrl, frauncesFontUrl } from "./font-files";

export const fraunces = localFont({
  src: "./fonts/Fraunces-Variable.ttf",
  variable: "--font-serif",
  weight: "400 900",
  display: "swap",
});

export const dmSans = localFont({
  src: "./fonts/DMSans-Variable.ttf",
  variable: "--font-sans",
  weight: "100 1000",
  display: "swap",
});

export const dmMono = localFont({
  src: "./fonts/DMMono-Regular.ttf",
  variable: "--font-mono",
  weight: "400",
  display: "swap",
});
