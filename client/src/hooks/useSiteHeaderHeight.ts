import { useEffect, useState } from 'react';

/** Height of the sticky site header, so page elements can stick just below it. */
export function useSiteHeaderHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const header = document.querySelector('header.header');
    if (!header) return undefined;
    const update = () => setHeight(Math.round(header.getBoundingClientRect().height));
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(header);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  return height;
}
