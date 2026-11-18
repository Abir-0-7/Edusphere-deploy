export type FixedUpdate = (dt: number) => void;

/** Deterministic fixed-step accumulator used by every game scene. */
export class FixedTimestepLoop {
  readonly stepSeconds: number;
  private accumulator = 0;
  constructor(hz = 60) {
    if (!Number.isFinite(hz) || hz <= 0) throw new Error('hz must be positive');
    this.stepSeconds = 1 / hz;
  }
  reset(): void {
    this.accumulator = 0;
  }
  advance(frameSeconds: number, update: FixedUpdate): number {
    if (!Number.isFinite(frameSeconds)) return 0;
    this.accumulator = Math.min(
      this.accumulator + Math.max(0, Math.min(frameSeconds, 0.25)),
      this.stepSeconds * 8,
    );
    let steps = 0;
    while (this.accumulator >= this.stepSeconds && steps < 8) {
      update(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
      steps++;
    }
    return steps;
  }
}
