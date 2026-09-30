'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Los datos de una cuenta cambian poco mientras se mira: 30 s sin volver a pedirlos
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
