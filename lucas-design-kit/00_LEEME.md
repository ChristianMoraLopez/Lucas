# Cómo usar este kit con Kimi

## Opción rápida: chat de Kimi (kimi.com o la app de escritorio)

1. Abre un chat nuevo en Kimi.
2. Adjunta **LUCAS_TODO_EN_UNO.md**. Ese archivo ya trae el manual, el CSS y los componentes.
3. Adjunta también las capturas de `capturas/`, al menos las de la pantalla que vas a construir, en Día y Noche.
4. Copia el texto de **PROMPT_KIMI.md**, cambia la parte entre corchetes por la pantalla que quieres y envíalo.
5. Cuando Kimi te dé el código, copia a tu proyecto la carpeta `fonts/` y los archivos de `styles/` y `components/` de este kit, tal cual. No dejes que los reescriba.

Para pantallas nuevas en ese mismo chat, basta con pedirlas: «Ahora la pantalla 5 · Liquidación, igual a su captura».

## Opción proyecto: Kimi con acceso a tu carpeta (Kimi Code o un agente en tu PC)

1. Crea tu proyecto (por ejemplo `npx create-next-app@latest lucas`).
2. Copia **toda** esta carpeta adentro, como `lucas-design-kit/`.
3. Pídele a Kimi: «Lee lucas-design-kit/PROMPT_KIMI.md y sigue sus instrucciones».

## Qué hay aquí

| Archivo | Qué es |
|---|---|
| `PROMPT_KIMI.md` | El prompt listo para pegar. |
| `LUCAS_TODO_EN_UNO.md` | Manual, CSS y componentes en un solo archivo, para adjuntar en el chat. |
| `LUCAS_DISENO.md` | Solo el manual: marca, tokens y API de componentes. |
| `styles/tokens.css` | Variables CSS (colores Día/Noche, espacios, radios, fuentes). |
| `styles/lucas.css` | Estilos de todos los componentes (clases `lu-`). |
| `components/lucas-ui.jsx` | Componentes React listos para Next.js. |
| `components/lucas-ui.d.ts` | Tipos de TypeScript. |
| `tokens.json` | Los mismos tokens en formato de datos. |
| `fonts/` | Bricolage Grotesque y Figtree (licencia OFL). |
| `capturas/` | Las 8 pantallas y 3 componentes, en Día y Noche. |
| `referencia/pantallas/` | Código de las pantallas de muestra, como referencia. |

Consejo: si Kimi empieza a usar Tailwind, colores inventados u otra fuente, recuérdale la regla 3 del prompt.
