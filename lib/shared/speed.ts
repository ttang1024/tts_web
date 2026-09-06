export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;
export const SPEED_STEP = 0.05;

// Rounded to two decimals to avoid floating-point drift (1.05 + 0.05 → 1.1).
export function adjustSpeed(speed: number, delta: number): number {
  const next = Math.round((speed + delta) * 100) / 100;
  return Math.min(Math.max(next, SPEED_MIN), SPEED_MAX);
}

export function formatSpeed(speed: number): string {
  return `${parseFloat(speed.toFixed(2))}×`;
}
