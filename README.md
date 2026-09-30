<div align="center">

# 💸 lucas

**Las cuentas compartidas de tu grupo de WhatsApp, sin hacer cuentas.**

Manda la foto del recibo al grupo y Lucas lo convierte en un gasto clasificado,
dividido y listo para liquidar. Hecho en Colombia, en pesos, sin decimales.

![Stack](https://img.shields.io/badge/stack-Next.js%2016%20%C2%B7%20Supabase%20%C2%B7%20Baileys%20%C2%B7%20Python-1C1433)
![Monorepo](https://img.shields.io/badge/monorepo-pnpm%20%2B%20Turborepo-6A35E6)
![Costo](https://img.shields.io/badge/costo-%240%20(todo%20gratis)-0A7A4C)
![Licencia](https://img.shields.io/badge/licencia-privada-625A78)

</div>

---

## ¿Qué es esto?

La gente manda fotos de recibos, PDFs o mensajes de texto a un grupo de WhatsApp.
Un número «contador» de la plataforma está dentro del grupo y lo recibe todo.
Lucas extrae los datos (QR de factura DIAN → OCR → LLM local), los clasifica con
un modelo propio, y en la web los usuarios revisan, corrigen, ven presupuestos y
dividen gastos. Al cerrar un paseo, Lucas calcula quién le paga a quién con el
mínimo de transferencias.

Hay dos tipos de cuenta:

| Tipo | Para qué | Ejemplo |
|---|---|---|
| **Hogar** | Continua, con presupuestos mensuales | «Casa» (una pareja) |
| **Evento** | Con inicio y fin, termina en liquidación | «Paseo Santa Marta» (8 amigos) |

## Estructura del monorepo

```
lucas/
├── apps/
│   └── web/              # Next.js 16 (App Router) — la app que ven los usuarios
├── services/
│   ├── connector/        # Node.js + Baileys — puente con WhatsApp (fase posterior)
│   └── worker/           # Python 3.12 — OCR, LLM local y clasificación (fase posterior)
├── supabase/
│   ├── migrations/       # Esquema, RLS y funciones RPC (Supabase CLI)
│   ├── tests/            # Pruebas de permisos con pgTAP
│   └── seed.sql          # Datos de ejemplo: «Casa» y «Paseo Santa Marta»
├── lucas-design-kit/     # Sistema de diseño final (fuente de verdad visual)
└── docs/
```

## Stack

| Capa | Tecnología |
|---|---|
| Web | Next.js 16 · React 19 · TypeScript · TanStack Query · RHF + Zod · Serwist (PWA) |
| Diseño | Sistema propio (`tokens.css` + `lucas.css`), Bricolage Grotesque + Figtree, Motion, Lottie |
| Datos | Supabase (Postgres, Auth, Storage, Realtime, RLS, RPC, pg_cron) — región São Paulo |
| WhatsApp | Baileys, aislado detrás de una interfaz (migración futura a Cloud API) |
| Worker | Python 3.12 · Pydantic · zxing-cpp · pdfplumber · OpenCV · RapidOCR · imagehash · RapidFuzz |
| IA local | Ollama (Qwen 2.5) + Laya sobre ONNX Runtime — **nada de APIs de IA pagas** |
| Calidad | Biome · Ruff · Vitest · pytest · Playwright · pgTAP |
| Infra | Vercel Hobby (web) + Oracle Cloud Always Free ARM (connector, worker, Ollama) |

## Empezar

Requisitos: Node.js 24, pnpm 12 (vía `corepack enable`) y Supabase CLI.

```bash
pnpm install

# Variables de entorno de la web (valores de ejemplo en apps/web/.env.example)
cp apps/web/.env.example apps/web/.env.local

# Levantar la web
pnpm dev
```

La app queda en `http://localhost:3000`.

### Base de datos local (opcional, requiere Docker)

```bash
pnpm db:start     # levanta Supabase local (Postgres, Auth, Studio…)
pnpm db:reset     # aplica migraciones + datos semilla
pnpm db:test      # corre las pruebas de permisos (pgTAP)
```

Para aplicar las migraciones al proyecto remoto:

```bash
npx supabase link --project-ref <tu-project-ref>
npx supabase db push
```

## Configuración de Supabase (una sola vez, en el Dashboard)

### 1. Login con Google

1. En [Google Cloud Console](https://console.cloud.google.com/) crea credenciales
   **OAuth 2.0 → ID de cliente web**.
2. Origen autorizado: `https://<tu-proyecto>.supabase.co`.
3. URI de redirección autorizada: `https://<tu-proyecto>.supabase.co/auth/v1/callback`.
4. En Supabase: **Authentication → Sign In / Providers → Google**, pega
   Client ID y Client Secret y actívalo.

### 2. Correos con Resend (enlace mágico)

El SMTP por defecto de Supabase es solo para pruebas (tasa muy limitada).
Usamos [Resend](https://resend.com) (plan gratuito):

1. En Resend: verifica tu dominio (o usa el dominio de pruebas) y crea un **API key**.
2. En Supabase: **Project Settings → Authentication → SMTP Settings** y activa
   *Custom SMTP* con:
   - Host: `smtp.resend.com` · Puerto: `465` (SSL) o `587` (TLS)
   - Usuario: `resend` · Contraseña: tu API key de Resend
   - Remitente: `Lucas <hola@tudominio.com>`
3. En **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` en desarrollo, tu dominio de Vercel en producción.
   - Redirect URLs: agrega `http://localhost:3000/**` y `https://tudominio/**`.

### 3. Llaves

- La **publishable key** va en `apps/web/.env.local` (es pública, la seguridad la da RLS).
- La **service role key** jamás toca la web: solo `services/connector` y
  `services/worker` (cada uno tiene su `.env.example` documentado).

## Diseño

La fuente de verdad visual es [`lucas-design-kit/`](./lucas-design-kit/LUCAS_DISENO.md):
identidad «billetes colombianos» — verde/morado/coral, Bricolage Grotesque para
títulos y cifras, Figtree para interfaz, tarjeta billete con guilloche, stickers
rotados para estados, modo Día y Noche. Sin Tailwind, sin librerías de UI con
estilos propios: todo sale de `tokens.css`.

## Datos de ejemplo

El seed crea dos cuentas listas para explorar (entra con cualquiera de estos
correos usando el enlace mágico, en local con contraseña `lucas1234`):

- **Casa** (hogar): Valeria y Juan Camilo, presupuestos del mes, gastos de mercado y servicios.
- **Paseo Santa Marta** (evento): 8 personas, invitación activa con código `PASEO-7K2Q`,
  gastos divididos de varias formas y 4 personas por reclamar.

## Estado del proyecto

- [x] **Fase 1** — Monorepo, esquema completo + RLS + RPC, auth, selector de cuentas,
  crear cuenta, unirse con código, administración de miembros e invitaciones.
- [ ] **Fase 2** — Bandeja de revisión y captura manual de gastos.
- [ ] **Fase 3** — Worker: extracción (QR DIAN, OCR), LLM local y clasificación.
- [ ] **Fase 4** — Connector de WhatsApp con Baileys.
- [ ] **Fase 5** — Presupuestos, gráficas, liquidación y exportes.
- [ ] **Fase 6** — PWA, despliegue y observabilidad.

---

<div align="center">
<sub>«Me debes 40 lucas» — nunca más.</sub>
</div>
