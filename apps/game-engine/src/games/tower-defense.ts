import { TOWER_CARDS } from './tower-cards';
export const TOWER_HZ = 60;
export const TOWER_TARGET = 5;
export const TOWER_WAVE_SIZE = 8;
const SPAWN_STEPS = 120;
const TRAVEL_STEPS = 720;
export type Enemy = { id: number; lane: number; hp: number; progress: number; ageSteps: number };
export class FlashcardTowerDefense {
  readonly enemies: Enemy[] = [];
  private nextId = 1;
  private steps = 0;
  private partialSteps = 0;
  private defeated = 0;
  lives = 3;
  get score(): number {
    return this.defeated * 100;
  }
  get complete(): boolean {
    return this.defeated >= TOWER_TARGET && this.lives > 0;
  }
  get lost(): boolean {
    return this.lives <= 0;
  }
  spawn(lane: number, hp = 1): boolean {
    if (
      !Number.isInteger(lane) ||
      lane < 0 ||
      lane > 2 ||
      hp !== 1 ||
      this.nextId > TOWER_WAVE_SIZE ||
      this.complete ||
      this.lost
    )
      return false;
    this.enemies.push({ id: this.nextId++, lane, hp: 1, progress: 0, ageSteps: 0 });
    return true;
  }
  private removeEscaped(): number {
    const escaped = this.enemies.filter((enemy) => enemy.ageSteps >= TRAVEL_STEPS);
    for (const enemy of escaped) this.enemies.splice(this.enemies.indexOf(enemy), 1);
    this.lives = Math.max(0, this.lives - escaped.length);
    return escaped.length;
  }
  tickSteps(steps: number): number {
    if (!Number.isInteger(steps) || steps < 1 || steps > 6000) throw new Error('invalid tower timestep');
    let escaped = 0;
    for (let index = 0; index < steps && !this.complete && !this.lost; index++) {
      this.steps++;
      for (const enemy of this.enemies) {
        enemy.ageSteps++;
        enemy.progress = enemy.ageSteps / TRAVEL_STEPS;
      }
      escaped += this.removeEscaped();
      if (this.steps % SPAWN_STEPS === 0) this.spawn((this.nextId - 1) % 3);
    }
    return escaped;
  }
  tick(dt: number): number {
    if (!Number.isFinite(dt) || dt < 0 || dt > 100) throw new Error('invalid tower delta');
    const accumulated = this.partialSteps + dt * TOWER_HZ;
    const steps = Math.floor(accumulated + 1e-9);
    this.partialSteps = Math.max(0, accumulated - steps);
    return steps > 0 ? this.tickSteps(steps) : 0;
  }
  answer(enemyId: number, answer: boolean): boolean {
    if (!Number.isInteger(enemyId) || typeof answer !== 'boolean' || this.complete || this.lost) return false;
    const enemy = this.enemies.find((candidate) => candidate.id === enemyId);
    if (!enemy) return false;
    const correct = answer === TOWER_CARDS[(enemy.id - 1) % TOWER_CARDS.length]?.answer;
    if (!correct) {
      enemy.ageSteps += 90;
      enemy.progress = enemy.ageSteps / TRAVEL_STEPS;
      this.removeEscaped();
      return false;
    }
    this.enemies.splice(this.enemies.indexOf(enemy), 1);
    this.defeated++;
    return true;
  }
}
