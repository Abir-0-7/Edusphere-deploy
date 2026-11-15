import type { Judge0Result, Judge0Submission, Language, RunResult } from './types.js';

export type Judge0ClientOptions = {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
};

const MAX_SOURCE_CHARS = 20_000;
const MAX_INPUT_CHARS = 4_000;
const EXECUTION_LIMITS = {
  cpu_time_limit: 2,
  wall_time_limit: 5,
  memory_limit: 128_000,
  stack_limit: 16_000,
  max_file_size: 1_024,
  enable_network: false,
} as const;

function bounded(value: string, max: number, name: string): string {
  if (value.length > max) throw new Error(`${name} exceeds limit`);
  return value;
}

function asRunResult(value: Judge0Result): RunResult {
  return {
    statusId: value.status?.id ?? 0,
    stdout: value.stdout ?? '',
    stderr: value.stderr ?? '',
    compileOutput: value.compile_output ?? '',
    message: value.message ?? '',
    timeSeconds: value.time == null ? null : Number(value.time),
    memoryKb: value.memory ?? null,
  };
}

export class Judge0Client {
  private readonly fetchImpl: typeof fetch;
  private readonly options: Required<Pick<Judge0ClientOptions, 'requestTimeoutMs' | 'pollIntervalMs' | 'maxPolls'>>;

  constructor(private readonly config: Judge0ClientOptions) {
    if (!/^https:\/\//.test(config.baseUrl)) throw new Error('Judge0 baseUrl must use HTTPS');
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.options = {
      requestTimeoutMs: config.requestTimeoutMs ?? 8_000,
      pollIntervalMs: config.pollIntervalMs ?? 200,
      maxPolls: config.maxPolls ?? 30,
    };
  }

  async run(languageId: number, source: string, input: string, expectedOutput?: string): Promise<RunResult> {
    bounded(source, MAX_SOURCE_CHARS, 'source code');
    bounded(input, MAX_INPUT_CHARS, 'stdin');
    if (expectedOutput !== undefined) bounded(expectedOutput, MAX_INPUT_CHARS, 'expected output');
    const payload = {
      language_id: languageId,
      source_code: source,
      stdin: input,
      ...(expectedOutput === undefined ? {} : { expected_output: expectedOutput }),
      ...EXECUTION_LIMITS,
    };
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.config.apiKey) headers['x-rapidapi-key'] = this.config.apiKey;
    const response = await this.request('/submissions?base64_encoded=false', { method: 'POST', headers, body: JSON.stringify(payload) });
    const submission = (await response.json()) as Judge0Submission;
    if (!submission.token) throw new Error('Judge0 did not return a submission token');
    for (let attempt = 0; attempt < this.options.maxPolls; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, this.options.pollIntervalMs));
      const resultResponse = await this.request(`/submissions/${encodeURIComponent(submission.token)}?base64_encoded=false`, { headers });
      const result = (await resultResponse.json()) as Judge0Result;
      if ((result.status?.id ?? 0) > 2) return asRunResult(result);
    }
    throw new Error('Judge0 execution timed out while polling');
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, { ...init, signal: controller.signal });
      if (!response.ok) throw new Error(`Judge0 request failed (${response.status})`);
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const languageIdFor = (language: Language): number => (language === 'python' ? 71 : 63);
