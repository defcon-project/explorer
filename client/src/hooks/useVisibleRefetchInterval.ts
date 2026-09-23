import { usePageVisibility } from './usePageVisibility';

type VisibleRefetchOptions = {
  enabled?: boolean;
};

export function useVisibleRefetchInterval(
  intervalMs: number,
  options: VisibleRefetchOptions = {}
): number | false {
  const isPageVisible = usePageVisibility();
  const enabled = options.enabled ?? true;
  if (!enabled || !isPageVisible) return false;
  return intervalMs;
}

