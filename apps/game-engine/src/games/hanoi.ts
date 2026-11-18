export class TowersOfHanoi {
  readonly towers: number[][];
  readonly diskCount: number;
  moves = 0;
  constructor(diskCount = 4) {
    if (!Number.isInteger(diskCount) || diskCount < 1 || diskCount > 8)
      throw new Error('diskCount must be 1..8');
    this.diskCount = diskCount;
    this.towers = [Array.from({ length: diskCount }, (_, index) => diskCount - index), [], []];
  }
  move(from: number, to: number): boolean {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to || this.complete) return false;
    const source = this.towers[from];
    const target = this.towers[to];
    const disk = source?.[source.length - 1];
    const top = target?.[target.length - 1];
    if (!source || !target || disk === undefined || (top !== undefined && top < disk)) return false;
    target.push(source.pop()!);
    this.moves++;
    return true;
  }
  get complete(): boolean {
    return (
      this.towers[0]?.length === 0 &&
      this.towers[1]?.length === 0 &&
      this.towers[2]?.length === this.diskCount &&
      this.towers[2].every((disk, index) => disk === this.diskCount - index)
    );
  }
  get score(): number {
    return this.complete ? Math.max(10, 1000 - this.moves * 10) : 0;
  }
}
