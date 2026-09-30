import { redirect } from 'next/navigation';

export default async function AccountIndexPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  redirect(`/c/${accountId}/resumen`);
}
