import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Renders a long list in pages: the first `step` rows right away, the next page when the
 * end comes near while scrolling. A folder with thousands of files opens instantly instead
 * of building every row up front.
 */
export function useIncrementalList<T>(
  items: T[],
  step = 120
): { visible: T[]; hasMore: boolean; sentinelRef: (el: HTMLElement | null) => void } {
  const [count, setCount] = useState(step);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // A new list (another folder, a new filter) starts from the top page again.
  useEffect(() => {
    setCount(step);
  }, [items, step]);

  const sentinelRef = useCallback(
    (el: HTMLElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!el || typeof IntersectionObserver === 'undefined') return;
      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) setCount((c) => c + step);
        },
        { rootMargin: '600px 0px' }
      );
      observerRef.current.observe(el);
    },
    [step]
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { visible: items.length > count ? items.slice(0, count) : items, hasMore: items.length > count, sentinelRef };
}
