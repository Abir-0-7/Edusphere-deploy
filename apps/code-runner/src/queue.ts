export class BoundedQueue<T> {
  private readonly pending: Array<{ task: () => Promise<T>; resolve: (value: T) => void; reject: (reason: Error) => void }> = [];
  private running = 0;

  constructor(private readonly concurrency = 1, private readonly maxPending = 20) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('invalid concurrency');
    if (!Number.isInteger(maxPending) || maxPending < 1) throw new Error('invalid queue size');
  }

  run(task: () => Promise<T>): Promise<T> {
    if (this.pending.length >= this.maxPending) return Promise.reject(new Error('execution queue is full'));
    return new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject });
      this.drain();
    });
  }

  private drain(): void {
    while (this.running < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift();
      if (!entry) return;
      this.running += 1;
      void entry.task().then(entry.resolve, entry.reject).finally(() => {
        this.running -= 1;
        this.drain();
      });
    }
  }
}
