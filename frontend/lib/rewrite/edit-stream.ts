import { RawEditSchema, type RawEdit } from "./schema";

// The model answers with {"edits":[{...},{...}]}, a few characters at a time.
// This reads those characters and hands back each edit as soon as its closing brace arrives,
// so the first edit can be on screen while the model is still writing the fifth.
export class EditStreamParser {
  // How deep we are in braces and brackets, outside of strings.
  // 1 = the answer object, 2 = the "edits" array, 3 = inside one edit.
  private depth = 0;
  private inString = false;
  private escaped = false;
  private current = "";
  // Pieces that did not parse as an edit: counted, never fatal
  skipped = 0;

  push(chunk: string): RawEdit[] {
    const found: RawEdit[] = [];
    for (const char of chunk) {
      if (this.depth >= 3) this.current += char;

      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (char === "\\") this.escaped = true;
        else if (char === '"') this.inString = false;
        continue;
      }

      if (char === '"') {
        this.inString = true;
      } else if (char === "{" || char === "[") {
        this.depth++;
        if (this.depth === 3) this.current = char;
      } else if (char === "}" || char === "]") {
        if (this.depth === 3) {
          const edit = this.finish();
          if (edit) found.push(edit);
        }
        this.depth--;
      }
    }
    return found;
  }

  private finish(): RawEdit | null {
    const source = this.current;
    this.current = "";
    try {
      const parsed = RawEditSchema.safeParse(JSON.parse(source));
      if (parsed.success) return parsed.data;
    } catch {
      // Falls through: a broken piece is skipped
    }
    this.skipped++;
    return null;
  }
}
