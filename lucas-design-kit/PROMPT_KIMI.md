Vas a construir el frontend de **Lucas**, una app colombiana para llevar cuentas compartidas. Las personas mandan fotos de recibos, PDFs o mensajes a un grupo de WhatsApp y Lucas los convierte en gastos clasificados y divididos. Hay dos tipos de cuenta: **hogar** (continua, con presupuestos mensuales) y **evento** (con fecha de inicio y fin, que termina en una liquidación de quién le debe a quién).

Ya existe un sistema de diseño completo. Te adjunto:
- `LUCAS_DISENO.md`: el manual de marca, todos los tokens y la API de cada componente. **Léelo completo antes de escribir código.**
- `styles/tokens.css` y `styles/lucas.css`: el CSS final. Úsalos tal cual, sin reescribirlos.
- `components/lucas-ui.jsx`: los componentes React ya hechos (BillCard, ExpenseCard, Sticker, Amount, Field, Chip, Avatar, AppShell…).
- Capturas de las 8 pantallas en móvil y escritorio, en modo Día y Noche. Son la referencia visual obligatoria.
- (Opcional) `referencia/pantallas/*.jsx`: el código de las 8 pantallas de muestra.

Reglas:
1. Stack: Next.js (App Router) + TypeScript + React 18. Importa `styles/tokens.css` y `styles/lucas.css` en `app/layout.tsx` y copia `fonts/` a `public/fonts/` (ajusta las rutas `url()` de `tokens.css` a `/fonts/...`).
2. Reutiliza los componentes de `lucas-ui.jsx` (puedes pasarlos a `.tsx` con los tipos de `lucas-ui.d.ts`). No inventes componentes nuevos si ya existe uno equivalente.
3. No uses Tailwind ni otra librería de UI con estilos propios (shadcn, MUI, Chakra). Los colores, espacios, radios y fuentes salen **solo** de las variables CSS de `tokens.css`. No escribas colores hexadecimales en los componentes.
4. Móvil primero. Pestañas abajo en móvil y riel lateral desde 760px (ya lo hace `AppShell` con container queries).
5. Montos siempre con `Amount` o `formatCOP`: pesos colombianos con punto de miles y sin decimales ($84.300).
6. Textos en español colombiano, tuteando, como en el manual. Nada de emojis en la interfaz.
7. Respeta `prefers-reduced-motion` y los contrastes indicados en el manual.

Primera tarea: monta el proyecto con el sistema de diseño y construye la pantalla **[escribe aquí cuál: p. ej. "Bandeja de revisión"]** idéntica a su captura, con datos de ejemplo. Antes de programar, dime qué archivos vas a crear.