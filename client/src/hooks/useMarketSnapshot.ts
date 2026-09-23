import { useQuery } from '@tanstack/react-query';
import { fetchMarket } from '../services/api';
import { usePageVisibility } from './usePageVisibility';

interface UseMarketSnapshotOptions {
  staleTime?: number;
  refetchInterval?: number | false;
  pauseWhenHidden?: boolean;
}

export function useMarketSnapshot(options: UseMarketSnapshotOptions = {}) {
  const isPageVisible = usePageVisibility();
  const pauseWhenHidden = options.pauseWhenHidden ?? true;
  const refetchInterval =
    pauseWhenHidden && !isPageVisible ? false : (options.refetchInterval ?? false);

  return useQuery({
    queryKey: ['market'],
    queryFn: fetchMarket,
    staleTime: options.staleTime ?? 60_000,
    refetchInterval,
  });
}
