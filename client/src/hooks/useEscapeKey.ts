import { useEffect, useRef, useLayoutEffect } from 'react';

/**
 * Clean hook to handle Escape key presses for modal dialogs.
 */
export function useEscapeKey(
  arg1: (() => void) | boolean,
  arg2?: (() => void) | boolean
) {
  const onEscape = typeof arg1 === 'function' ? arg1 : (arg2 as () => void);
  const active = typeof arg1 === 'boolean' ? arg1 : arg2 !== undefined ? Boolean(arg2) : true;

  const ref = useRef(onEscape);
  useLayoutEffect(() => {
    ref.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current) {
        ref.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [active]);
}
