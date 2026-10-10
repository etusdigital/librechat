import { useEffect, useRef, useState } from 'react';
import type { Size } from './preview-geometry';

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => {
      const style = window.getComputedStyle(element);
      const horizontal = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) || 0;
      const vertical = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) || 0;
      const width = Math.max(Math.floor(element.clientWidth - horizontal), 0);
      const height = Math.max(Math.floor(element.clientHeight - vertical), 0);
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}
