import { vi } from "vitest";

export type QueryAnswer = { data: unknown; error: { code: string } | null };

// A Supabase read: every step hands the query back, and awaiting it or asking for one row gives the answer
export function fakeQuery(answer: QueryAnswer) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn<(column: string, from: string) => unknown>((): unknown => query),
    abortSignal: vi.fn(() => query),
    single: vi.fn(async () => query.answer),
    maybeSingle: vi.fn(async () => query.answer),
    then: (done: (value: QueryAnswer) => unknown) => done(query.answer),
    answer,
  };
  return query;
}
