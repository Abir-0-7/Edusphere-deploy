export class NQueens {
  readonly size: number;
  readonly columns: number[];
  constructor(size = 8) { if (size < 1 || size > 12) throw new Error('size must be 1..12'); this.size = size; this.columns = Array(size).fill(-1); }
  place(row: number, column: number): boolean {
    if (row < 0 || row >= this.size || column < 0 || column >= this.size) return false;
    this.columns[row] = column; return true;
  }
  remove(row: number): void { if (row >= 0 && row < this.size) this.columns[row] = -1; }
  get complete(): boolean { return this.columns.every((column, row) => column >= 0 && this.columns.every((other, otherRow) => row === otherRow || (other >= 0 && other !== column && Math.abs(other - column) !== Math.abs(otherRow - row)))); }
  get score(): number { return this.complete ? this.size * 100 : 0; }
}
