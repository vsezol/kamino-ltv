import { useEffect, useRef, useState } from "react";

export function useAnimatedNumber(value: number, duration = 800) {
  const [displayValue, setDisplayValue] = useState(value);
  const previous = useRef(value);
  const rafId = useRef<number>();

  useEffect(() => {
    const startValue = previous.current;
    const delta = value - startValue;
    const startTime = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(startValue + delta * eased);
      if (progress < 1) {
        rafId.current = requestAnimationFrame(tick);
      }
    };

    rafId.current = requestAnimationFrame(tick);
    previous.current = value;

    return () => {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [value, duration]);

  return displayValue;
}
