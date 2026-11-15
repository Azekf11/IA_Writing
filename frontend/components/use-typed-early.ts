import { useEffect, useRef } from "react";

const typed = (box: HTMLInputElement | HTMLTextAreaElement) => box.value;
const ticked = (box: HTMLInputElement) => box.checked;

// A box works before the scripts arrive, and what was typed then is not in the state yet. Hydration
// leaves it in the box, and the next render wipes it unless the state has taken it by then. The text
// a browser puts back on Back or Forward has the same fate, and it can land after hydration, once the
// page has loaded, with no event to say so: so the box is read again then. Returns the ref for the box.
function useHeldEarly<Box extends HTMLInputElement | HTMLTextAreaElement, Held>(
  read: (box: Box) => Held,
  value: Held,
  onChange: (value: Held) => void,
) {
  const box = useRef<Box>(null);
  useEffect(() => {
    const take = () => {
      if (box.current && read(box.current) !== value)
        onChange(read(box.current));
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
  }, [read, value, onChange]);
  return box;
}

export const useTypedEarly = <
  Box extends HTMLInputElement | HTMLTextAreaElement,
>(
  value: string,
  onChange: (value: string) => void,
) => useHeldEarly<Box, string>(typed, value, onChange);

// The same for a checkbox
export const useTickedEarly = (
  value: boolean,
  onChange: (value: boolean) => void,
) => useHeldEarly<HTMLInputElement, boolean>(ticked, value, onChange);
