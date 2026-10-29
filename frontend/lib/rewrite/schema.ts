import { z } from "zod";
import { MAX_CHARS } from "@/lib/text";

// How much the model may change: light touches only clear tells, thorough also weaker ones
export const STRENGTHS = ["light", "standard", "thorough"] as const;
export type Strength = (typeof STRENGTHS)[number];

// A sample of the author's own writing, so edits can stay close to their voice
export const MAX_VOICE_CHARS = 1500;

export const RewriteRequestSchema = z.object({
  locale: z.enum(["en", "fr"]).default("en"),
  strength: z.enum(STRENGTHS).default("standard"),
  voice: z.string().max(MAX_VOICE_CHARS).optional(),
  // Ask for the answer edit by edit instead of all at once
  stream: z.boolean().default(false),
  text: z
    .string()
    .refine((text) => text.trim().length > 0)
    .refine((text) => text.length <= MAX_CHARS),
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
