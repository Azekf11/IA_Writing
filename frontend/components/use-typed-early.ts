import { useEffect, useRef } from "react";

// A box works before the scripts arrive, and what was typed then is not in the state yet. Hydration
// leaves it in the box, and the next render wipes it unless the state has taken it by then. The text
// a browser puts back on Back or Forward has the same fate, and it can land after hydration, once the
// page has loaded, with no event to say so: so the box is read again then. Returns the ref for the box.
export function useTypedEarly<
  Box extends HTMLInputElement | HTMLTextAreaElement,
>(value: string, onChange: (value: string) => void) {
  const box = useRef<Box>(null);
  useEffect(() => {
    const take = () => {
      if (box.current && box.current.value !== value)
        onChange(box.current.value);
    };
    take();
    // The browser's own step runs right after the load event, not during it
    let timer: ReturnType<typeof setTimeout>;
    const later = () => {
      timer = setTimeout(take, 0);
    };
    if (document.readyState === "complete") later();
    else window.addEventListener("load", later, { once: true });
    return () => {
      window.removeEventListener("load", later);
      clearTimeout(timer);
    };
  }, [value, onChange]);
  return box;
}
