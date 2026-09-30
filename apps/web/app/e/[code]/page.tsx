import { redirect } from 'next/navigation';

/** Link corto de invitación (lucas.co/e/PASEO-7K2Q): abre «Entra a una cuenta» con el código puesto. */
export default async function InviteLinkPage({ params }: PageProps<'/e/[code]'>) {
  const { code } = await params;
  redirect(`/unirse?codigo=${encodeURIComponent(decodeURIComponent(code).toUpperCase())}`);
}
