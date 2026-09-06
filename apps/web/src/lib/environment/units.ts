export function toFahrenheit(celsius: number): number {
  return Math.round((celsius * 9) / 5 + 32);
}

export function formatTemperatureTarget(target: string | null, imperial: boolean): string | null {
  if (!imperial || !target) return target;
  const range = /^(-?\d+(?:\.\d+)?)[–-](-?\d+(?:\.\d+)?)°C$/.exec(target);
  if (!range) return target;
  return `${toFahrenheit(Number(range[1]))}–${toFahrenheit(Number(range[2]))}°F`;
}
