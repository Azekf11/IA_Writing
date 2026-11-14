"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { CHOSEN_IN_FORCED_COLORS, cn } from "@/lib/cn";

const LOOKS = {
  segments: {
    group: "gap-1 rounded-lg bg-surface-2 p-1",
    segment: "rounded-md px-2 py-1.5 font-medium transition-colors",
    // The fill and the word differ by less than 3:1 from the other segments: the ring does not
    chosen: `bg-surface text-foreground shadow-sm ring-1 ring-muted ${CHOSEN_IN_FORCED_COLORS}`,
    other: "text-muted hover:text-foreground",
  },
  swatches: {
    group: "gap-2",
    // A swatch is there to show its colour, in forced colours too
    segment:
      "grid size-8 place-items-center rounded-full text-white transition-transform hover:scale-110 forced-colors:forced-color-adjust-none",
    chosen: "ring-2 ring-foreground ring-offset-2 ring-offset-surface",
    other: "",
  },
};

const STEPS: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

type Segment<Value extends string> = {
  value: Value;
  content: ReactNode;
  // Needed when the content has no words
  label?: string;
  // What this segment does, read with it whether it is the choice or not: a screen reader's own
  // cursor reaches a segment without choosing it. It goes on the segment, since the arrow keys move
  // the focus between them and a description on the group is not read with the segment that has it.
  describedBy?: string;
  className?: string;
};

type Props<Value extends string> = {
  label: string;
  segments: Segment<Value>[];
  // Nothing is chosen while it is unknown: the server cannot know the theme
  value?: string;
  onChange: (value: Value) => void;
  look?: keyof typeof LOOKS;
  className?: string;
};

// One choice among a few. It works like a group of radio buttons: one stop for Tab, and the arrow
// keys change the choice. These are buttons, not radios, so Enter never submits the form around them.
export function SegmentedControl<Value extends string>({
  label,
  segments,
  value,
  onChange,
  look = "segments",
  className,
}: Props<Value>) {
  const styles = LOOKS[look];
  const tabStop = segments.some((segment) => segment.value === value)
    ? value
    : segments[0].value;

  function move(event: KeyboardEvent<HTMLButtonElement>, from: number) {
    const step = STEPS[event.key];
    if (!step || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const to = (from + step + segments.length) % segments.length;
    onChange(segments[to].value);
    (event.currentTarget.parentElement?.children[to] as HTMLElement).focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(styles.group, className)}
    >
      {segments.map((segment, index) => {
        const chosen = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={segment.label}
            aria-describedby={segment.describedBy}
            tabIndex={segment.value === tabStop ? 0 : -1}
            onClick={() => onChange(segment.value)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              styles.segment,
              chosen ? styles.chosen : styles.other,
              segment.className,
            )}
          >
            {segment.content}
          </button>
        );
      })}
    </div>
  );
}
