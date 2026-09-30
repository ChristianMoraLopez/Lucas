# Lucas · web

La app que ven los usuarios: Next.js 16 (App Router) + React 19, con el sistema
de diseño de [`lucas-design-kit`](../../lucas-design-kit/LUCAS_DISENO.md) tal cual
(`styles/tokens.css` y `styles/lucas.css` no se tocan; lo propio de cada pantalla
va en `styles/app.css`).

```bash
cp .env.example .env.local   # y llena las dos variables de Supabase
pnpm dev                     # http://localhost:3000
pnpm test                    # pruebas de lib/ (Vitest)
pnpm typecheck               # next typegen + tsc
```

| Carpeta | Qué hay |
|---|---|
| `app/` | Rutas: `/login`, `/auth/callback`, `/` (selector), `/cuentas/nueva`, `/unirse`, `/e/[code]`, `/c/[accountId]/*` |
| `components/lucas-ui.tsx` | Componentes del kit (BillCard, Sticker, Amount, CodeInput, AppShell…) |
| `components/lucas-core.ts` | Funciones puras del kit (`formatCOP`, `lucas`, tonos, códigos): sirven en Server Components |
| `lib/` | Fechas en español, invitaciones, redirecciones seguras, errores y tipos |
| `utils/supabase/` | Clientes de Supabase (navegador, servidor y proxy) |
| `proxy.ts` | Refresca la sesión y manda a `/login` (recordando a dónde iba) |

Más contexto en el [README principal](../../README.md).
