export type SortItem = { id: number; value: number };
export class SortingRace {
  readonly items: SortItem[];
  private moves = 0;
  constructor(values: number[]) { this.items = values.map((value, id) => ({ id, value })); }
  swap(left: number, right: number): void { if (left < 0 || right < 0 || left >= this.items.length || right >= this.items.length) return; const first = this.items[left]; const second = this.items[right]; if (!first || !second) return; this.items[left] = second; this.items[right] = first; this.moves++; }
  get complete(): boolean { return this.items.every((item, index) => index === 0 || (this.items[index - 1]?.value ?? Number.NEGATIVE_INFINITY) <= item.value); }
  get score(): number { return this.complete ? Math.max(10, 1000 - this.moves * 25) : 0; }
}
