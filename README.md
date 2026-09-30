<div align="center">

<img src="apps/web/app/icon.svg" width="76" alt="" />

# lucas

**Las cuentas compartidas de tu grupo de WhatsApp, sin hacer cuentas.**

Manden la foto del recibo al grupo y Lucas la vuelve un gasto clasificado,<br />
dividido y listo para liquidar. En pesos colombianos, sin decimales y sin Excel.

<br />

![Fase](https://img.shields.io/badge/fases_1_y_2-listas-0A7A4C?style=flat-square)
![Pruebas](https://img.shields.io/badge/pruebas-124_pasando-6A35E6?style=flat-square)
![Demo](https://img.shields.io/badge/demo-lucas--tau--black.vercel.app-1C1433?style=flat-square)
![Stack](https://img.shields.io/badge/Next.js_16_·_Supabase_·_Baileys_·_Python-1C1433?style=flat-square)
![Costo](https://img.shields.io/badge/costo-%240%2C_todo_gratis-FFC53D?style=flat-square&labelColor=1C1433)

<br />

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="lucas-design-kit/capturas/componente-tarjeta-billete-noche.png" />
  <img src="lucas-design-kit/capturas/componente-tarjeta-billete-dia.png" width="760" alt="Tarjetas billete: $2.395.200 gastados en septiembre en la casa y $4.816.000 del paseo entre 8 personas" />
</picture>

</div>

<br />

## ¿Qué es?

«Me debes 40 lucas». Así se habla de plata en Colombia, y de ahí sale el nombre.

1. **Mandan** fotos de recibos, PDFs o mensajes («pagué 100 lucas de taxis») al grupo de WhatsApp de siempre.
2. **Un número contador** de Lucas está en el grupo, lo lee todo y lo vuelve gastos: comercio, fecha, total, ítems, categoría y quién pagó.
3. **En la web** revisan lo que la IA no leyó seguro, corrigen, ven presupuestos y, al final del paseo, Lucas dice **quién le paga a quién** con el mínimo de transferencias.

Hay dos tipos de cuenta:

| | Para qué | Ejemplo |
|---|---|---|
| **Hogar** | Continua, con presupuesto mensual por categoría | «Casa», de Valeria y Andrés |
| **Evento** | Con inicio y fin; termina en una liquidación | «Paseo Santa Marta», 8 amigos, 24 – 28 sep |

## Así se ve

<table>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="lucas-design-kit/capturas/1-selector-cuentas-noche.png" />
        <img src="lucas-design-kit/capturas/1-selector-cuentas-dia.png" alt="Selector de cuentas" />
      </picture>
      <p align="center"><b>Selector de cuentas</b> · fase 1 ✓</p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="lucas-design-kit/capturas/6-entrar-con-codigo-noche.png" />
        <img src="lucas-design-kit/capturas/6-entrar-con-codigo-dia.png" alt="Entrar con código" />
      </picture>
      <p align="center"><b>Entrar con código</b> · fase 1 ✓</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="lucas-design-kit/capturas/8-personas-noche.png" />
        <img src="lucas-design-kit/capturas/8-personas-dia.png" alt="Personas, roles e invitaciones" />
      </picture>
      <p align="center"><b>Personas, roles e invitaciones</b> · fase 1 ✓</p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="lucas-design-kit/capturas/2-bandeja-revision-noche.png" />
        <img src="lucas-design-kit/capturas/2-bandeja-revision-dia.png" alt="Bandeja de revisión" />
      </picture>
      <p align="center"><b>Bandeja de revisión</b> · fase 2 ✓</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="lucas-design-kit/capturas/4-resumen-evento-noche.png" />
        <img src="lucas-design-kit/capturas/4-resumen-evento-dia.png" alt="Resumen de un evento" />
      </picture>
      <p align="center"><b>Resumen del paseo</b> · fase 2 ✓</p>
    </td>
    <td width="50%">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="lucas-design-kit/capturas/5-liquidacion-noche.png" />
        <img src="lucas-design-kit/capturas/5-liquidacion-dia.png" alt="Liquidación: quién le paga a quién" />
      </picture>
      <p align="center"><b>Liquidación</b> · fase 5</p>
    </td>
  </tr>
</table>

<sub>Capturas del sistema de diseño (<a href="lucas-design-kit/LUCAS_DISENO.md">lucas-design-kit</a>), la referencia visual de cada pantalla. Cambian solas entre Día y Noche según el tema de GitHub.</sub>

## Cómo funciona por dentro

```mermaid
flowchart LR
    G([Grupo de WhatsApp]) -->|foto, PDF o texto| C[connector<br/>Node + Baileys]
    C -->|mensaje + evidencia comprimida| DB[(Supabase<br/>Postgres · Storage)]
    DB -->|cola jobs| W[worker · Python]
    W --> X{¿Qué llegó?}
    X -->|foto| QR[QR factura DIAN<br/>o OCR]
    X -->|PDF| PDF[texto directo]
    X -->|texto| R[reglas de montos<br/>y fechas colombianas]
    QR & PDF & R --> LLM[Qwen 2.5 local<br/>estructura el JSON]
    LLM --> V[validación y<br/>nivel de confianza]
    V --> K[categoría: memoria de comercios<br/>→ Laya → revisión humana]
    K -->|gasto| DB
    DB <-->|RLS + RPC| WEB[web · Next.js]
    WEB -->|correcciones| DB
```

- **Deduplicación** por id del mensaje de WhatsApp, huella perceptual de la imagen y CUFE de la factura electrónica.
- **Cada corrección humana** actualiza la memoria de comercios de la cuenta y queda como ejemplo para reentrenar Laya (en Colab o Kaggle, nunca en el servidor).
- **Nada de APIs de IA pagas**: Ollama y Laya corren en CPU, en un servidor ARM gratuito.

## Estado del proyecto

- [x] **Fase 1 · Base.** Monorepo, esquema completo con RLS y RPC, entrada con enlace mágico y Google, selector de cuentas, crear cuenta de hogar o evento, unirse con código o link («¿Eres alguna de estas personas?»), personas, roles e invitaciones. Modo Día y Noche.
- [x] **Fase 2 · Subir, revisar y ver.** Subida de fotos (con la cámara del celular), PDFs o texto con compresión en el navegador; procesador simulado; bandeja de revisión con evidencia y zoom, confianza por campo, correcciones y tiempo real; memoria de comercios y ejemplos de entrenamiento; resúmenes de hogar (categorías, 6 meses, presupuestos) y de evento (quién puso más); lista de gastos; PWA instalable; animaciones Lottie.
- [ ] **Fase 3 · Worker.** QR DIAN, OCR, LLM local, validación y clasificación con Laya (reemplaza al procesador simulado).
- [ ] **Fase 4 · WhatsApp.** Connector con Baileys y «Conectar WhatsApp».
- [ ] **Fase 5 · Números.** Liquidación (quién le paga a quién), edición de presupuestos y exportes (Excel, CSV, PDF).
- [ ] **Fase 6 · Producción.** Consentimiento y borrado de datos (Ley 1581), retención de evidencias y observabilidad.

## Cómo llegan los gastos hoy (fase 2)

Mientras no existen el connector ni el worker, todo entra por la web:

1. **Subir** (`/c/[cuenta]/subir` o el atajo «Subir un recibo» de la PWA): la foto se comprime en el navegador (1600 px, WebP o JPEG) y va al bucket privado `evidencias`, en la carpeta de la cuenta. También sirven PDFs o un mensaje como «taxis al aeropuerto 100 lucas, la pagó Santi».
2. `submit_upload` verifica que el archivo exista y que la persona sea de la cuenta, y crea el **mensaje** y el **trabajo** en la cola (`jobs`).
3. El **procesador simulado** (`run_simulated_worker`, con pg_cron cada 10 s) lee los montos colombianos del texto, detecta quién pagó, clasifica con la memoria de comercios de la cuenta y deja el gasto con confianza por campo. Si la conoce bien, lo confirma solo; si no, va a **Revisar**.
4. En **Revisar**, un admin corrige y confirma con Enter. Cada corrección alimenta la memoria de comercios y, si cambió la categoría, queda como ejemplo para reentrenar a Laya. Todo se actualiza en vivo con Supabase Realtime.

Cuando llegue el worker de Python (fase 3) basta con `select cron.unschedule('lucas-procesador-simulado');` y que el worker tome los trabajos de la misma cola.

## Stack

| Capa | Tecnología |
|---|---|
| Web | Next.js 16 (App Router) · React 19 · TypeScript · TanStack Query · React Hook Form + Zod · Radix UI (sin estilos) |
| Diseño | Sistema propio: `tokens.css` + `lucas.css`, Bricolage Grotesque y Figtree, sin Tailwind |
| Datos | Supabase: Postgres, Auth, Storage privado, Realtime, RLS, RPC, pg_cron |
| WhatsApp | Baileys detrás de una interfaz, listo para migrar a WhatsApp Cloud API |
| Worker | Python 3.12 · Pydantic · zxing-cpp · pdfplumber · OpenCV · RapidOCR · imagehash · RapidFuzz |
| IA local | Ollama (Qwen 2.5) y Laya sobre ONNX Runtime |
| Calidad | Biome · Vitest · PGlite (Postgres en WASM para probar RLS sin Docker) · Ruff · pytest · Playwright |
| PWA | Serwist (service worker con Turbopack), manifest con atajo a la cámara, página sin conexión |
| Infra | Vercel Hobby (web) · Supabase Free · Oracle Cloud Always Free ARM (connector, worker, Ollama) |

## Estructura

```
lucas/
├── apps/web/              Next.js: lo que ven los usuarios
│   ├── app/               rutas (login, selector, unirse, /c/[cuenta]/…)
│   ├── components/        componentes del kit de diseño
│   ├── lib/               fechas, invitaciones, compresión, tiempo real, tipos (+ pruebas)
│   ├── public/lottie/     animaciones de LottieFiles recoloreadas a la paleta del kit
│   └── styles/            tokens.css y lucas.css del kit + app.css
├── supabase/
│   ├── migrations/        esquema, RLS y RPC
│   ├── templates/         correos de entrada con la marca
│   ├── tests/             104 pruebas de permisos, fase 2 y semilla (PGlite)
│   └── seed.sql           «Casa» y «Paseo Santa Marta», iguales a las capturas
├── services/
│   ├── connector/         Node + Baileys (fase 4)
│   └── worker/            Python (fase 3)
└── lucas-design-kit/      sistema de diseño: manual, CSS, componentes y capturas
```

## Empezar

Necesitas Node 24 y pnpm 12 (`corepack enable`). Para la base de datos local, además, Docker y la [CLI de Supabase](https://supabase.com/docs/guides/local-development).

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # URL y publishable key de Supabase
pnpm dev                                       # http://localhost:3000
```

### Pruebas

```bash
pnpm db:test      # 104 pruebas de RLS, RPC, Storage, procesador y semilla sobre Postgres real (PGlite), sin Docker
pnpm test         # todo el monorepo (incluye las pruebas de apps/web/lib)
pnpm typecheck    # tipos de rutas de Next + tsc
pnpm lint         # Biome
```

### Base de datos local

```bash
pnpm db:start     # Supabase local en Docker (Studio en http://localhost:54323)
pnpm db:reset     # migraciones + semilla
```

Con la semilla puedes entrar como `valeria@example.com` (titular de las dos cuentas), `laura@example.com` (admin del paseo) o `santi@example.com` (miembro) con enlace mágico: en local los correos llegan a Mailpit, en `http://localhost:54324`. Para probar el flujo de unirse, crea otro usuario y usa el código **PASEO-7K2Q**: Caro y Felipe esperan que alguien los reclame.

> La semilla crea usuarios de prueba: es solo para local. No la corras en el proyecto remoto.

## Configurar Supabase (una vez)

### 1. Esquema

```bash
npx supabase link --project-ref <tu-project-ref>
npx supabase db push          # aplica supabase/migrations
```

### 2. URLs de Auth

En **Authentication → URL Configuration**:

- **Site URL**: tu dominio de producción (en desarrollo, `http://localhost:3000`).
- **Redirect URLs**: `http://localhost:3000/**`, `https://tu-dominio.co/**` y, si usas previews de Vercel, `https://*-tu-equipo.vercel.app/**`.

### 3. Correos con la marca

En **Authentication → Email Templates**, pega el HTML de [`supabase/templates/magic-link.html`](supabase/templates/magic-link.html) en *Magic Link* (asunto «Tu enlace para entrar a Lucas») y el de [`confirmation.html`](supabase/templates/confirmation.html) en *Confirm signup* (asunto «Entra a Lucas»). Estas plantillas mandan un `token_hash`, así que el enlace sirve aunque lo abran en otro dispositivo, por ejemplo en el celular.

### 4. SMTP con Resend

El correo por defecto de Supabase es solo para pruebas y manda muy pocos por hora.

1. En [Resend](https://resend.com), verifica tu dominio (registros SPF y DKIM en tu DNS) y crea una **API key** con permiso *Sending access*.
2. En Supabase, **Project Settings → Authentication → SMTP Settings**, activa *Custom SMTP*:

   | Campo | Valor |
   |---|---|
   | Host | `smtp.resend.com` |
   | Puerto | `465` (SSL) o `587` (STARTTLS) |
   | Usuario | `resend` |
   | Contraseña | la API key de Resend (**secreta**: vive solo en Supabase) |
   | Remitente | `Lucas <hola@tu-dominio.co>` |

3. En **Authentication → Rate Limits**, sube *Emails sent per hour* (con SMTP propio el tope lo pones tú; 30 alcanza para empezar).

### 5. Google

1. En [Google Cloud Console](https://console.cloud.google.com/): **APIs y servicios → Pantalla de consentimiento de OAuth** (externa, nombre «Lucas», alcances `openid`, `email` y `profile`).
2. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**:
   - Orígenes de JavaScript autorizados: `https://tu-dominio.co` y `http://localhost:3000`.
   - URI de redireccionamiento autorizado: `https://<tu-project-ref>.supabase.co/auth/v1/callback`.
3. En Supabase, **Authentication → Sign In / Providers → Google**: pega el Client ID y el Client Secret (**secreto**) y actívalo.

### 6. Llaves

- La **publishable key** (`sb_publishable_…`) va en `apps/web/.env.local` y en Vercel. Es pública: la seguridad la da RLS.
- La **secret / service role key** jamás toca la web. Solo la usan `services/connector` y `services/worker` (cada uno tiene su `.env.example` documentado).

## Permisos

Todas las tablas tienen RLS forzado. Lo delicado (unirse, cambiar roles, sacar gente, cerrar la cuenta) solo pasa por funciones RPC que validan todo adentro, y hay privilegios por columna para que nadie cambie `owner_id`, `status` ni `claimed_by` por fuera de ellas.

| | Titular | Admin | Miembro |
|---|:---:|:---:|:---:|
| Ver gastos, personas y presupuestos | ✓ | ✓ | ✓ |
| Reportar gastos (quedan por revisar) | ✓ | ✓ | ✓ |
| Confirmar, corregir o borrar gastos | ✓ | ✓ | |
| Agregar personas que solo están en WhatsApp | ✓ | ✓ | |
| Crear y anular códigos de invitación | ✓ | ✓ | |
| Nombrar admins y sacar miembros | ✓ | ✓ | |
| Quitarle el rol a un admin o sacarlo | ✓ | | |
| Cerrar la cuenta | ✓ | ✓ | |
| Borrar la cuenta | ✓ | | |
| Salirse de la cuenta | | ✓ | ✓ |

Nadie cambia su propio rol, nadie se vuelve titular y al titular no lo toca nadie. Cada regla tiene su prueba en [`supabase/tests/permissions.test.ts`](supabase/tests/permissions.test.ts).

**Datos personales (Ley 1581 de 2012):** el esquema ya guarda el consentimiento (`profiles.privacy_accepted_at`, `people.consent_at`) y los días de retención de evidencias por cuenta (`accounts.evidence_retention_days`). El flujo de aceptación y el borrado por persona llegan en la fase 6.

## Diseño

La fuente de verdad visual es [`lucas-design-kit/`](lucas-design-kit/LUCAS_DISENO.md): identidad colombiana y vibrante, con colores de billete. Verde (el de 100 mil) para la marca y lo confirmado, morado (el de 50 mil) para eventos y correcciones hechas por personas, naranja para lo pendiente y coral para las alertas. Tarjeta billete con guilloche para la cifra protagonista, stickers rotados para los estados, un color fijo por persona y montos siempre en pesos: **$84.300**.

**Animaciones:** Lottie solo en los momentos que el kit reserva (vacío, procesando, registrado, conectando WhatsApp y cierre de evento). Son animaciones gratuitas de [LottieFiles](https://lottiefiles.com) bajo la *Lottie Simple License*, recoloreadas a la paleta del kit: «Empty» de Ali Azgar, «Scan a receipt» de Musa, «success» de Biswajit Rout, «Chat» de Mahendra, «Success» de Mildred y «Money stack» de JuanMakes. Con `prefers-reduced-motion` se quedan quietas en el último cuadro.

---

<div align="center">
<sub>Hecho en Colombia por <b>Christian Rey Mora</b> · Proyecto privado</sub>
</div>
