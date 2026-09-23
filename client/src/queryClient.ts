import { QueryClient } from '@tanstack/react-query';

// Fallback polling interval used when websocket stream is unavailable.
export const AUTO_REFRESH_MS = 15_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 45_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      // Keep showing the previous page's data while a changed queryKey
      // (pagination, filters) refetches, instead of flashing a loading state.
      placeholderData: (previousData: unknown) => previousData,
    },
  },
});
