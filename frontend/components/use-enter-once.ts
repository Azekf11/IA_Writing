import { useEffect } from "react";
import { isTyping } from "@/lib/rewrite/keys";

// A held key repeats, and each repeat of Enter on a button is another click, on whatever holds the
// focus by then: a step that moves the focus would go on to the button it lands on. Enter counts
// once, unless the press began in a field.
export function useEnterOnce() {
  useEffect(() => {
    let pressedIn: EventTarget | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      if (!event.repeat) pressedIn = event.target;
      else if (!isTyping(pressedIn)) event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
