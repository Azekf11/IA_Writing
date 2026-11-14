import { z } from "zod";
import { MAX_CHARS, MAX_VOICE_CHARS, STRENGTHS } from "@/lib/text";

// Half an emoji, which JSON can carry as an escape, is not text the API accepts. It would answer with
// a 400, once the attempt has started, and the writer would be told the service is unavailable.
const wellFormed = (value: string) => value.isWellFormed();

export const RewriteRequestSchema = z.object({
  locale: z.enum(["en", "fr"]).default("en"),
  strength: z.enum(STRENGTHS).default("standard"),
  voice: z.string().max(MAX_VOICE_CHARS).refine(wellFormed).optional(),
  // Ask for the answer edit by edit instead of all at once
  stream: z.boolean().default(false),
  // False leaves this rewrite out of the history, and changes nothing else
  keep: z.boolean().default(true),
  text: z
    .string()
    .refine((text) => text.trim().length > 0)
    .refine((text) => text.length <= MAX_CHARS)
    .refine(wellFormed),
});

// One edit as the model writes it
export const RawEditSchema = z.object({
  original: z.string(),
  replacement: z.string(),
  reason: z.string(),
});

// What Claude must return: edits only, never a full rewrite
export const ClaudeOutputSchema = z.object({ edits: z.array(RawEditSchema) });

export type RawEdit = z.infer<typeof RawEditSchema>;
