/** Shared request/response shapes for the ai-service client. */
export interface JobStatus {
  id: string;
  kind: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  attempts: number;
  error_reason?: string | null;
  result?: Record<string, unknown> | null;
}

export interface Chapter {
  id: string;
  title: string;
  ordinal: number;
  start_page: number | null;
  end_page: number | null;
}

export interface ChatReply {
  answer: string;
  citations: { chunk_id: string; page: number | null; quote: string }[];
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  due_date: string;
  document_id?: string;
  chapter_id?: string | null;
  source_chunk_id?: string | null;
}
