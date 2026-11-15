import { gradeProblem } from './grade.js';
import { Judge0Client } from './judge0.js';
import { getProblem } from './problems.js';
import { BoundedQueue } from './queue.js';
import type { Grade, Language } from './types.js';

export type BattleRequest = {
  readonly userId: string;
  readonly problemId: string;
  readonly language: Language;
  readonly source: string;
};

export type BattleResult = {
  readonly userId: string;
  readonly grade: Grade;
  readonly score: number;
  readonly tokenAward: number;
};

export class BattleService {
  private readonly queue: BoundedQueue<BattleResult>;

  constructor(private readonly client: Judge0Client, concurrency = 1, maxPending = 20) {
    this.queue = new BoundedQueue(concurrency, maxPending);
  }

  submit(request: BattleRequest): Promise<BattleResult> {
    if (!/^[a-zA-Z0-9_:-]{1,128}$/.test(request.userId)) throw new Error('invalid user id');
    const problem = getProblem(request.problemId);
    return this.queue.run(async () => {
      const grade = await gradeProblem(this.client, problem, request.language, request.source);
      const score = Math.round((grade.passed / grade.total) * 100);
      // Rewards are derived from server-side grading; no client score or token value is accepted.
      const tokenAward = grade.passed === grade.total ? 5 : grade.passed > 0 ? 1 : 0;
      return { userId: request.userId, grade, score, tokenAward };
    });
  }
}
