import Phaser from 'phaser';
import { FixedTimestepLoop } from './loop';
import { SortingRace } from './games/sorting-race';
import { NQueens } from './games/n-queens';
import { TowersOfHanoi } from './games/hanoi';
import { FlashcardTowerDefense } from './games/tower-defense';
import { createServerRewardClient } from './rewards';
import { TOWER_CARDS, type GameAction } from './completion';

type MiniGame = SortingRace | NQueens | TowersOfHanoi | FlashcardTowerDefense;
type GameId = 'SortingRace' | 'NQueens' | 'TowersOfHanoi' | 'FlashcardTowerDefense';
const definitions: Array<{ id: GameId; label: string; create: () => MiniGame }> = [
  { id: 'SortingRace', label: 'Sorting Race', create: () => new SortingRace([4, 1, 3, 2]) },
  { id: 'NQueens', label: 'N-Queens', create: () => new NQueens(4) },
  { id: 'TowersOfHanoi', label: 'Towers of Hanoi', create: () => new TowersOfHanoi(4) },
  { id: 'FlashcardTowerDefense', label: 'Flashcard Tower Defense', create: () => new FlashcardTowerDefense() },
];

class VaultScene extends Phaser.Scene {
  private readonly loop = new FixedTimestepLoop(60);
  private gameIndex = 0;
  private gameState: MiniGame = definitions[0]!.create();
  private actions: GameAction[] = [];
  private selected = -1;
  private elapsed = 0;
  private status!: Phaser.GameObjects.Text;
  private board!: Phaser.GameObjects.Container;
  private rewardPending = false;
  constructor() { super('vault'); }

  create(): void {
    this.add.text(24, 18, 'StudyVault Game Vault', { color: '#f8fafc', fontSize: '26px' });
    this.status = this.add.text(24, 58, '', { color: '#cbd5e1', fontSize: '16px' });
    const menu = this.add.text(24, 92, definitions.map((game, index) => `${index + 1} ${game.label}`).join('     '), { color: '#94a3b8', fontSize: '14px' });
    this.add.text(24, 420, 'Click tiles or towers to act. Tower Defense: answer each flashcard with Y or N.', { color: '#94a3b8', fontSize: '13px' });
    this.board = this.add.container(0, 0);
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      const index = Number(event.key);
      if (Number.isInteger(index) && index >= 1 && index <= definitions.length) this.select(index - 1);
      if (event.key.toLowerCase() === 'y') this.answer(true);
      if (event.key.toLowerCase() === 'n') this.answer(false);
    });
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.click(pointer.x, pointer.y));
    menu.setInteractive();
    this.select(0);
  }

  private select(index: number): void {
    this.gameIndex = index;
    this.gameState = definitions[index]!.create();
    this.actions = [];
    this.selected = -1;
    this.elapsed = 0;
    this.rewardPending = false;
    this.render();
  }

  private click(x: number, y: number): void {
    const state = this.gameState;
    if (state instanceof SortingRace && y >= 160 && y <= 330) {
      const tile = Math.floor((x - 120) / 140);
      if (tile < 0 || tile >= state.items.length) return;
      if (this.selected < 0) this.selected = tile;
      else { state.swap(this.selected, tile); this.actions.push({ type: 'swap', left: this.selected, right: tile }); this.selected = -1; }
    } else if (state instanceof NQueens && y >= 150 && y < 390 && x >= 250 && x < 550) {
      const cell = 75;
      const row = Math.floor((y - 150) / cell);
      const column = Math.floor((x - 250) / cell);
      state.place(row, column); this.actions.push({ type: 'place', row, column });
    } else if (state instanceof TowersOfHanoi && y >= 180 && y < 390) {
      const tower = Math.floor((x - 170) / 210);
      if (tower < 0 || tower > 2) return;
      if (this.selected < 0) this.selected = tower;
      else { if (state.move(this.selected, tower)) this.actions.push({ type: 'move', from: this.selected, to: tower }); this.selected = -1; }
    }
    this.render();
  }

  private answer(correct: boolean): void {
    if (!(this.gameState instanceof FlashcardTowerDefense)) return;
    const enemy = this.gameState.enemies[0];
    if (!enemy) return;
    this.gameState.answer(enemy.id, correct);
    this.actions.push({ type: 'answer', enemyId: enemy.id, answer: correct });
    this.render();
  }

  private render(): void {
    this.board.removeAll(true);
    const state = this.gameState;
    this.status.setText(`${definitions[this.gameIndex]!.label}  |  Score ${state.score}  |  Moves ${this.actions.length}`);
    if (state instanceof SortingRace) {
      state.items.forEach((item, index) => {
        const x = 190 + index * 140;
        this.board.add(this.add.rectangle(x, 230, 112, 112, index === this.selected ? 0x0f766e : 0x2563eb).setStrokeStyle(2, 0xcbd5e1));
        this.board.add(this.add.text(x - 10, 214, String(item.value), { color: '#ffffff', fontSize: '28px' }));
      });
    } else if (state instanceof NQueens) {
      const cell = 75;
      for (let row = 0; row < state.size; row++) for (let col = 0; col < state.size; col++) {
        const x = 250 + col * cell + cell / 2; const y = 150 + row * cell + cell / 2;
        this.board.add(this.add.rectangle(x, y, cell, cell, (row + col) % 2 ? 0x334155 : 0xe2e8f0));
        if (state.columns[row] === col) this.board.add(this.add.text(x - 15, y - 20, 'Q', { color: '#be123c', fontSize: '32px', fontStyle: 'bold' }));
      }
    } else if (state instanceof TowersOfHanoi) {
      state.towers.forEach((tower, index) => {
        const x = 220 + index * 210;
        this.board.add(this.add.rectangle(x, 345, 150, 10, 0x64748b));
        this.board.add(this.add.rectangle(x, 260, 8, 170, index === this.selected ? 0x0f766e : 0x94a3b8));
        tower.forEach((disk, row) => this.board.add(this.add.rectangle(x, 338 - row * 24, 32 + disk * 16, 18, [0x2563eb, 0x0f766e, 0xbe123c, 0x7c3aed][disk % 4]!)));
      });
    } else {
      const enemy = state.enemies[0];
      const card = enemy ? TOWER_CARDS[(enemy.id - 1) % TOWER_CARDS.length] : undefined;
      this.board.add(this.add.text(180, 190, card ? `${card.prompt}   (Y / N)` : 'Preparing the next flashcard...', { color: '#f8fafc', fontSize: '18px' }));
      state.enemies.forEach((enemy) => this.board.add(this.add.rectangle(300 + enemy.lane * 100, 300, 48, 48, 0xbe123c)));
    }
    const complete = state instanceof SortingRace ? state.complete : state instanceof NQueens ? state.complete : state instanceof TowersOfHanoi ? state.complete : state.score >= 500;
    if (complete && !this.rewardPending) {
      this.rewardPending = true;
      void createServerRewardClient().award(definitions[this.gameIndex]!.id, this.actions).then(({ tokensAwarded }) => {
        this.status.setText(`${definitions[this.gameIndex]!.label} complete  |  ${tokensAwarded} token(s) awarded`);
      }).catch(() => { this.status.setText('Completion saved locally; reward verification failed.'); });
    }
  }

  update(_time: number, delta: number): void {
    this.loop.advance(delta / 1000, (dt) => {
      if (!(this.gameState instanceof FlashcardTowerDefense)) return;
      this.elapsed += dt;
      if (this.elapsed >= 2 && this.gameState.score < 500) {
        this.elapsed = 0;
        const lane = this.actions.filter((action) => action.type === 'spawn').length % 3;
        this.gameState.spawn(lane);
        const enemy = this.gameState.enemies[this.gameState.enemies.length - 1];
        if (enemy) this.actions.push({ type: 'spawn', lane, hp: 1 });
        this.render();
      }
    });
  }
}

new Phaser.Game({ type: Phaser.AUTO, width: 800, height: 450, parent: 'game', backgroundColor: '#0f172a', scene: VaultScene, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH } });
