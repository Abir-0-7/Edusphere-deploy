export type Language = 'python' | 'javascript';

export type TestCase = {
  readonly input: string;
  readonly expectedOutput: string;
};

export type Problem = {
  readonly id: string;
  readonly title: string;
  readonly statement: string;
  readonly languageIds: Readonly<Record<Language, number>>;
  readonly tests: readonly TestCase[];
};

export type RunResult = {
  readonly statusId: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly compileOutput: string;
  readonly message: string;
  readonly timeSeconds: number | null;
  readonly memoryKb: number | null;
};

export type Grade = {
  readonly problemId: string;
  readonly passed: number;
  readonly total: number;
  readonly results: readonly { passed: boolean; output: string; error: string }[];
};

export type Judge0Submission = {
  readonly token: string;
};

export type Judge0Result = {
  readonly status?: { id?: number };
  readonly stdout?: string | null;
  readonly stderr?: string | null;
  readonly compile_output?: string | null;
  readonly message?: string | null;
  readonly time?: string | null;
  readonly memory?: number | null;
};
