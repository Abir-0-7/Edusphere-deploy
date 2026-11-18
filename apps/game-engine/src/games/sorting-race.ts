export type SortItem = { id: number; value: number };
export class SortingRace {
  readonly items: SortItem[];
  private moves = 0;
  constructor(values: number[]) {
    if (values.length < 2 || values.length > 16 || values.some((value) => !Number.isFinite(value)))
      throw new Error('sorting requires 2..16 finite values');
    this.items = values.map((value, id) => ({ id, value }));
  }
  swap(left: number, right: number): boolean {
    if (!Number.isInteger(left) || !Number.isInteger(right) || left === right || this.complete) return false;
    if (left < 0 || right < 0 || left >= this.items.length || right >= this.items.length) return false;
    const first = this.items[left];
    const second = this.items[right];
    if (!first || !second) return false;
    this.items[left] = second;
    this.items[right] = first;
    this.moves++;
    return true;
  }
  get complete(): boolean {
    return this.items.every(
      (item, index) =>
        index === 0 || (this.items[index - 1]?.value ?? Number.NEGATIVE_INFINITY) <= item.value,
    );
  }
  get score(): number {
    return this.complete ? Math.max(10, 1000 - this.moves * 25) : 0;
  }
}
