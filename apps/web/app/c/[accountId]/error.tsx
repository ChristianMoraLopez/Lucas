'use client';

import { ErrorView } from '@/components/error-view';

/** Cuando falla una pestaña de la cuenta: la barra y las pestañas siguen ahí. */
export default function ErrorCuenta({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorView error={error} retry={retry} />;
}
