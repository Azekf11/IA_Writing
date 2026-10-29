import { z } from "zod";
import { MAX_CHARS } from "@/lib/text";

export const RewriteRequestSchema = z.object({
  locale: z.enum(["en", "fr"]).default("en"),
  text: z
    .string()
    .refine((text) => text.trim().length > 0)
    .refine((text) => text.length <= MAX_CHARS),
});

// What Claude must return: edits only, never a full rewrite
export const ClaudeOutputSchema = z.object({
  edits: z.array(
    z.object({
      original: z.string(),
      replacement: z.string(),
      reason: z.string(),
    }),
  ),
});

export type RawEdit = z.infer<typeof ClaudeOutputSchema>["edits"][number];
