export type Enemy = { id: number; lane: number; hp: number; progress: number };
export class FlashcardTowerDefense {
  readonly enemies: Enemy[] = [];
  private nextId = 1;
  score = 0;
  spawn(lane: number, hp = 1): void { this.enemies.push({ id: this.nextId++, lane, hp: Math.max(1, hp), progress: 0 }); }
  tick(dt: number): number { for (const enemy of this.enemies) enemy.progress += dt; return this.enemies.filter((enemy) => enemy.progress >= 1).length; }
  answer(enemyId: number, correct: boolean): boolean { const enemy = this.enemies.find((candidate) => candidate.id === enemyId); if (!enemy || !correct) return false; enemy.hp--; if (enemy.hp <= 0) { this.enemies.splice(this.enemies.indexOf(enemy), 1); this.score += 100; } return true; }
}
