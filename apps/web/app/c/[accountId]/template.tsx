/* Al pasar de una pestaña a otra, la pantalla nueva entra suave (200 ms, en
   CSS: .lu-pantalla). El layout (barra y pestañas) no se vuelve a montar:
   solo lo de adentro. */
export default function AccountTemplate({ children }: { children: React.ReactNode }) {
  return <div className="lu-pantalla">{children}</div>;
}
