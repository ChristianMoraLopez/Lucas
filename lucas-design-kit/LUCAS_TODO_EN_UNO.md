# LUCAS — kit de diseño en un solo archivo

Este archivo reúne el manual, el CSS y los componentes para adjuntarlo en un chat. Las fuentes y las capturas van aparte.

# Lucas — sistema de diseño

Lucas convierte lo que la gente manda a un grupo de WhatsApp (fotos de recibos, PDFs, mensajes) en gastos clasificados y divididos. El nombre viene de cómo se dice la plata en Colombia, «me debes 40 lucas», y la identidad es **colombiana y vibrante**: colores saturados tomados de los billetes, formas redondas, un color fijo para cada persona y el tono de un parche entre amigos. Aun así es una herramienta de plata, así que las cifras son claras, densas y exactas.

## Voz y contenido

- Español colombiano, cercano y sin rodeos. Háblale al usuario de **tú** y al grupo de «ustedes»: «Revisen lo pendiente y después liquidan».
- Las preguntas sirven de títulos: «¿En qué se fue?», «¿Quién puso más?», «¿Quién le paga a quién?».
- Las transferencias llevan nombre y verbo: **«Juan Camilo le paga a Valeria $132.500»**, y debajo, en `tinta-2`, la forma hablada con `lucas()`: «132,5 lucas».
- Se permite un signo de exclamación en momentos de celebración («¡Todo pagado!», «¡La encontramos!»). En instrucciones y errores no se usan.
- Mayúscula de oración en títulos, botones y etiquetas. Las MAYÚSCULAS quedan solo para la denominación de la tarjeta billete («LUCAS», «8 PERSONAS»).
- Nada de emojis en la interfaz. Si un mensaje de WhatsApp que se muestra como evidencia los trae, se dejan tal cual.
- Nombres de ejemplo: Valeria, Juan Camilo, Mafe, Andrés, Laura, Santi, Caro, Felipe. Comercios: Panadería La Espiga, Tienda Don Beto, Parqueadero Calle 85, Estanco El Paisa.
- Evita frases de marketing vacías como «Potencia tus finanzas».

## Montos

- Todo monto va en la familia `num` (Bricolage Grotesque con cifras tabulares) usando `Amount` o `formatCOP`: signo pesos, punto de miles y sin decimales, por ejemplo **$84.300**.
- Negativos con signo menos (−$280.000) y `tone="neg"` en `coral-texto`; a favor con `+` y `tone="pos"` en `verde`.
- **Resaltado amarillo**: solo en la cifra clave de la vista (el total del periodo o del paseo) y una por pantalla. Se aplica con `highlight` en `Amount` o `BillCard`, o con `lu-mark` para una palabra del título.
- Cuando un total cambia en pantalla, sus dígitos ruedan (`roll`).

## Color

- La página va en `fondo`, las tarjetas y hojas en `superficie`, y las zonas agrupadas en `superficie-2`. En modo Noche el fondo es violeta profundo, no negro.
- **Verde** (billete de 100 mil) es la marca: el botón principal, lo confirmado, lo pagado y el saldo a favor. Hay un solo botón `primary` por vista.
- **Morado** (billete de 50 mil) identifica las cuentas tipo evento y las **correcciones hechas por personas**. Lo que corrigió alguien se ve en morado sobre `morado-suave`, con su avatar y «corrigió Mafe». La IA nunca usa morado.
- **Naranja** significa pendiente o por revisar (sticker REVISAR, contador de pendientes, campo con baja confianza).
- **Coral** es la alerta: presupuesto superado y deuda.
- **Amarillo** se reserva para el resaltado de la cifra clave y la celebración (el panel «¡Todo pagado!»).
- Los `tono-*` (morado, naranja, azul, coral, verde, amarillo, turquesa, rosa) dan su color a cada **persona** y cada **categoría**. Son iguales en ambos temas y siempre llevan el texto en `tinta-fija`. Cada persona conserva su tono en toda la app (`setTones`).
- Los rellenos vivos (naranja, amarillo, verde-vivo, tono-*) siempre llevan texto en `tinta-fija`; los sólidos (verde, morado, coral) llevan `on-*`.
- Ningún estado depende solo del color: los stickers dicen la palabra, la confianza dice «Seguro, Casi seguro, Revísalo» y el presupuesto dice «Te pasaste $36.900».
- Nada de gradientes de fondo, blobs, glassmorphism ni neón. La única textura es la **trama guilloche de billete** dentro de `BillCard`.

## Tipografía

- **Bricolage Grotesque** a 800 para títulos (`display-xl`, `display`, `title`), con tracking negativo. Es gruesa y con carácter.
- **Figtree** para cuerpo e interfaz (`body`, `body-strong`, `small`, `label`).
- **Bricolage Grotesque** tabular para cifras (`amount-*`), de modo que la plata se lee con la misma voz que los títulos.

## Elementos de firma

- **Tarjeta billete** (`BillCard`): la cifra protagonista de la pantalla, en verde para hogar y en morado para evento, con guilloche, denominación en cápsula y el monto resaltado. Pon una sola por pantalla.
- **Stickers** (`Sticker`): los estados (Pagado, Revisar, Pendiente, Te pasaste, Saldado) son calcomanías rotadas de −8° a 6°, con borde del color de la superficie y sombra corta. Al aparecer, caen con rebote.
- **Personas con color** (`Avatar`, `Person`, `Chip`): el círculo con las iniciales en su tono. Quien no tiene cuenta aparece en círculo vacío con contorno.
- **Categorías** (`CategoryTag`): una letra en un cuadro redondeado de color (C Café, L Licor, M Mercado, T Transporte, H Hospedaje, R Restaurante, S Servicios). No se usan íconos de categoría.
- **Pares de transferencia**: el avatar de quien paga, una flecha y el avatar de quien recibe.

## Composición

- Primero móvil. La navegación va en pestañas con íconos de trazo abajo en móvil y en un riel a la izquierda desde 760px de contenedor (`AppShell`).
- La composición es asimétrica: una columna principal (1,4–1,6fr) y otra lateral. No hay grillas de tarjetas idénticas.
- Los radios cambian según el papel de cada pieza: campos `radius-sm`, botones `radius-md`, tarjetas `radius-lg`, billete y paneles `radius-xl`, chips, stickers y avatares `radius-pill`.
- Solo las tarjetas sueltas llevan `shadow-card`. Las filas dentro de un panel se separan con `borde`, sin sombra. El botón principal tiene una base sólida que se hunde al presionarlo (`shadow-press`).
- La densidad es de herramienta: filas de 40–48px y márgenes `space-4` en móvil y `space-8` en escritorio.
- Foco: anillo de 2px en `foco` (morado) con 2px de aire.

## Movimiento

- **Gasto registrado** (`ExpenseCard appear`): la tarjeta sube y aparece con un rebote corto.
- **Sticker** (`Sticker animate`): cae de escala 1,3 a 1 con giro.
- **Montos**: los dígitos ruedan (`roll`).
- Todo dura entre 150 y 250 ms, sin bucles decorativos. Con `prefers-reduced-motion` todo aparece sin animar.
- Hay espacios reservados para Lottie (`LottieSlot`): `vacio`, `escaneo`, `gasto-registrado`, `conectando-whatsapp` / `whatsapp-conectado` y `cierre-evento`.

## Íconos

- Íconos de trazo de 2px, redondeados, de 24px, dibujados en el bundle (`ICONS`): resumen, revisar, gastos, liquidar, personas y presupuestos. No se usan emojis ni ilustraciones 3D.
- El logo (`Logo`) son dos billetes redondeados, morado y verde, con una moneda amarilla, junto a «lucas» en minúscula en Bricolage 800.

## Pantallas de referencia

El grupo **Pantallas** trae las 8 vistas en móvil y escritorio con datos de ejemplo: Selector de cuentas, Bandeja de revisión, Resumen hogar («Casa»), Resumen evento («Paseo Santa Marta», 8 personas, $4.816.000), Liquidación, Entrar con código (PASEO-7K2Q), Conectar WhatsApp y Personas.


## Tokens de color

Todos están definidos como variables CSS en `styles/tokens.css`. Tema Día por defecto; Noche con `data-theme="dark"` en `<html>`.

| Variable | Día | Noche | Uso |
|---|---|---|---|
| `--fondo` | #FFFBF6 | #15111F | Fondo de página. Blanco cálido de día, violeta profundo de noche. |
| `--superficie` | #FFFFFF | #221C33 | Tarjetas, hojas, barra superior, campos. |
| `--superficie-2` | #F3EDF7 | #2C2542 | Zonas agrupadas, pista de barras, burbujas de chat, fila seleccionada. |
| `--borde` | #E6DEEE | #3A3152 | Bordes de tarjeta y divisores de 1px. |
| `--tinta` | #1C1433 | #F7F2FF | Texto principal y cifras, sobre fondo, superficie y superficie-2 (17:1 · 15:1). |
| `--tinta-2` | #625A78 | #B4AACB | Texto secundario y metadatos sobre fondo, superficie y superficie-2 (≥5,6:1 · ≥7,4:1). |
| `--verde` | #0A7A4C | #3DDC97 | Marca Lucas (el verde del billete de 100 mil): botón principal, confirmado, pagado, saldo a favor. Como texto ≥4,7:1 en ambos temas. |
| `--on-verde` | #FFFFFF | #15111F | Texto sobre relleno verde (5,4:1 · 10,5:1). |
| `--verde-vivo` | #2BD48A | #2BD48A | Relleno alegre de éxito (sticker PAGADO, barra dentro del presupuesto). Siempre con texto en tinta-fija. |
| `--verde-suave` | #DDF7EA | #173A2C | Fondo de avisos de éxito, fila pagada. |
| `--morado` | #6A35E6 | #AE92FF | El morado del billete de 50 mil: cuentas tipo evento, correcciones hechas por personas, foco. Como texto 5,6:1 · 6,5:1. |
| `--on-morado` | #FFFFFF | #15111F | Texto sobre relleno morado (6,4:1 · 7,4:1). |
| `--morado-suave` | #ECE4FF | #2E2352 | Fondo de campo corregido a mano; chip seleccionado. |
| `--naranja` | #FF7A1A | #FF9A4D | Pendiente / por revisar: sticker REVISAR, contador de pendientes. Como relleno, con texto tinta-fija. |
| `--naranja-texto` | #B04800 | #FF9A4D | Texto de pendiente en tamaño pequeño (5,4:1 · 8,8:1). |
| `--naranja-suave` | #FFEBDB | #3D2616 | Fondo de aviso de pendientes y de campo con baja confianza. |
| `--coral` | #DB2F47 | #FF6F82 | Alerta: presupuesto superado, deuda, error. Relleno con on-coral. |
| `--coral-texto` | #C4283F | #FF6F82 | Texto de alerta pequeño: '−$280.000', 'Te pasaste $36.900' (5,5:1 · 6,9:1). |
| `--on-coral` | #FFFFFF | #15111F | Texto sobre relleno coral. |
| `--coral-suave` | #FFE3E7 | #3F1C26 | Fondo de aviso de alerta. |
| `--amarillo` | #FFC53D | #FFD466 | Resaltado de la cifra clave (una por vista) y avisos alegres. Siempre con texto tinta-fija. |
| `--azul` | #1E6FD0 | #6AB0FF | Color de persona y enlaces secundarios. Como texto 4,8:1 · 8,2:1. |
| `--tono-morado` | #B79CFF | #B79CFF | Tono vivo para personas y categorías (Licor). Igual en ambos temas; texto encima en tinta-fija (≥8:1). |
| `--tono-naranja` | #FF9A4D | #FF9A4D | Tono vivo para personas y categorías (Café). |
| `--tono-azul` | #7DB8FF | #7DB8FF | Tono vivo para personas y categorías (Transporte). |
| `--tono-coral` | #FF8A99 | #FF8A99 | Tono vivo para personas y categorías (Restaurante). |
| `--tono-verde` | #2BD48A | #2BD48A | Tono vivo para personas y categorías (Mercado). |
| `--tono-amarillo` | #FFC53D | #FFC53D | Tono vivo para personas y categorías (Servicios). |
| `--tono-turquesa` | #3FD6CC | #3FD6CC | Tono vivo para personas y categorías (Hospedaje). |
| `--tono-rosa` | #FF8FC0 | #FF8FC0 | Tono vivo para personas. |
| `--tinta-fija` | #1C1433 | #1C1433 | Texto sobre rellenos vivos (naranja, amarillo, verde-vivo y todos los tono-*) en ambos temas. |
| `--foco` | {morado} | (igual) | Anillo de foco: 2px sólido + 2px de aire. |

## Estilos de texto

| Estilo | Familia | Tamaño / interlínea · peso | Uso |
|---|---|---|---|
| `display-xl` | display | 52px / 50px · 800 | Nombre de la cuenta en su resumen. Una vez por pantalla. |
| `display` | display | 36px / 38px · 800 | Título de pantalla. |
| `title` | display | 22px / 26px · 700 | Título de sección y de tarjeta. |
| `body` | sans | 16px / 24px · 400 | Texto corrido e interfaz. |
| `body-strong` | sans | 16px / 22px · 700 | Nombres, filas de lista. |
| `small` | sans | 14px / 20px · 500 | Ayudas, pies, metadatos. |
| `label` | sans | 12px / 16px · 700 | Etiquetas de campo y sección, en tinta-2. Mayúscula de oración, no todo en mayúsculas. |
| `amount-xl` | num | 48px / 50px · 800 | Total del periodo o evento, en la tarjeta billete. |
| `amount-lg` | num | 26px / 30px · 700 | Total de un gasto, monto de transferencia. |
| `amount` | num | 16px / 22px · 600 | Montos en filas. |
| `amount-sm` | num | 13px / 18px · 600 | Montos secundarios. |

Familias: `--font-display` y `--font-num` = Bricolage Grotesque; `--font-sans` = Figtree. Los archivos están en `fonts/` y `tokens.css` ya trae los `@font-face`.

## Espacios, radios, sombras y movimiento

| Variable | Valor | Uso |
|---|---|---|
| `--space-1` | 4px | Separación mínima. |
| `--space-2` | 8px | Entre chips y botones. |
| `--space-3` | 12px | Entre filas; relleno de chip. |
| `--space-4` | 16px | Margen de pantalla en móvil; relleno de fila. |
| `--space-5` | 20px | Relleno de tarjeta. |
| `--space-6` | 24px | Relleno de tarjeta billete; margen en escritorio. |
| `--space-8` | 32px | Entre secciones. |
| `--space-10` | 40px | Aire superior de pantalla en escritorio. |
| `--radius-sm` | 10px | Campos, avatares de categoría, botones pequeños. |
| `--radius-md` | 16px | Botones, filas agrupadas, burbujas. |
| `--radius-lg` | 22px | Tarjetas de gasto y paneles. |
| `--radius-xl` | 30px | Tarjeta billete (hero) y hojas en móvil. |
| `--radius-pill` | 999px | Chips, stickers, avatares de persona, barras. |
| `--shadow-card` | 0 1px 0 rgba(28,20,51,.06), 0 8px 24px -12px rgba(28,20,51,.18) | Tarjetas de gasto y de cuenta. Las filas dentro de un panel no llevan sombra. |
| `--shadow-sticker` | 0 3px 0 rgba(28,20,51,.18) | Stickers de estado: sombra corta y dura, como calcomanía. |
| `--shadow-press` | 0 4px 0 #064B2F | Botón principal: base sólida que se hunde al presionar. |
| `--dur-fast` | 150ms | Hover, presionado. |
| `--dur-base` | 200ms | Cambios de estado. |
| `--dur-slow` | 250ms | Tarjeta que aparece, sticker que cae, dígitos que ruedan. Techo. |
| `--ease-out` | cubic-bezier(.2, .8, .2, 1) | Entradas y dígitos. |
| `--ease-pop` | cubic-bezier(.3, 1.6, .5, 1) | Stickers y tarjeta registrada: rebote corto. |

## Componentes (components/lucas-ui.jsx)

Todos se importan de `components/lucas-ui.jsx`. Las clases CSS usan el prefijo `lu-` y viven en `styles/lucas.css`. Utilidades de texto: `lu-display-xl`, `lu-display`, `lu-title`, `lu-label`, `lu-small`, `lu-muted`, `lu-num`, `lu-mark` (resaltado amarillo de una palabra).

Funciones: `formatCOP(n)` → "$84.300" · `lucas(n)` → "84,3 lucas" · `setTones({ Valeria: 'morado', … })` fija el color de cada persona · `CATEGORIES` mapa categoría → [letra, tono].

### AppShell

Estructura de la app: barra con el logo y el selector de cuenta, más la navegación.

- Props: `account`, `accountTone`, `accountGlyph`, `tabs` ([{id, label, count, icon}]), `active`, `onTab`, `onAccount`, `children`.
- Por debajo de 760px de contenedor la navegación va en pestañas abajo; desde 760px, en un riel a la izquierda. `count` muestra los pendientes en naranja.

### Logo

Logo de Lucas: dos billetes (morado y verde) con moneda amarilla, junto a «lucas» en minúscula.

- Props: `size` (px del texto; la marca mide 1,25×).
- No lo pongas sobre rellenos de color. Va sobre `fondo` o `superficie`.

### BillCard

Tarjeta billete: la cifra protagonista de la pantalla, con trama guilloche, denominación en cápsula y el monto resaltado.

- Props: `label`, `amount`, `tone` (`verde` para hogar, `morado` para evento), `denom` («LUCAS», «8 PERSONAS»), `aside` (reemplaza la denominación: un sticker, flechas de mes), `roll`, `highlight` y `children` (pie con datos; usa `<b>` para las cifras).
- Pon una sola por pantalla.

### ExpenseCard

Tarjeta de gasto: categoría, comercio, quién pagó, total y la parte de cada uno.

- Props: `merchant`, `category`, `meta` («Ayer · pagó Valeria»), `total`, `each` («÷ 2 · $23.450»), `sticker`, `appear` (entra con rebote al registrarse), `onClick`, `flat` (sin sombra, dentro de un panel) y `children` (normalmente `Row`).

### Row

Fila de detalle: concepto a la izquierda y monto o valor a la derecha.

- Props: `label`, `amount` o `value`, `muted`, `total` (con línea arriba y monto grande).

### Amount

Monto en pesos colombianos con cifras tabulares: $84.300.

- Props: `value`, `size` (`sm`, `md`, `lg`, `xl`), `highlight` (fondo amarillo, uno por pantalla), `roll` (los dígitos ruedan), `tone` (`pos`, `neg`), `sign`.
- `formatCOP(n)` da el texto y `lucas(n)` la forma hablada («280 lucas», «1,2 palos»).

### Sticker

Sticker de estado: calcomanía rotada con borde del color de la superficie.

- Props: `tone` (`pagado`/`confirmado` en verde vivo, `revisar` en naranja, `pendiente` neutro, `alerta` en coral, `cerrado` en morado), `children`, `sub` (fecha), `size` (`sm`, `md`, `lg`), `rotate` (−8 a 6) y `animate` (cae con rebote).
- Pon como máximo uno por tarjeta, siempre con la palabra escrita. Nunca lo uses como botón.

### Button

Botón.

- Props: `variant` (`primary` en verde con base que se hunde, uno por vista; `secondary` sobre superficie-2; `outline`; `ghost` subrayado), `size` (`md` de 48px, `sm` de 36px), `kbd` (atajo, «Enter»). Admite todos los atributos de `<button>`.
- El texto es un verbo en mayúscula de oración: «Confirmar gasto», «Marcar pagada».

### Field

Campo con los datos que leyó la IA, su confianza y la marca de corrección.

- Props: `label`, `value`, `original` (lo leído), `confidence` (0–1), `correctedBy`, `num` (cifras y fechas), `inputMode`, `onChange`, `children` (sustituye el input, por ejemplo un `<select>`).
- Con confianza baja (< 0,75) va en naranja; si alguien lo corrige pasa a morado con «corrigió Mafe».

### Confidence

Confianza de lectura de la IA: tres puntos, una palabra y el porcentaje.

- Props: `value` (0–1: Seguro ≥ 0,9, Casi seguro ≥ 0,75, Revísalo < 0,75), `corrected`.

### Correction

Corrección hecha por una persona: el valor anterior tachado, el nuevo en morado y quién lo corrigió con su avatar.

- Props: `was`, `children` (valor nuevo), `by` (nombre).
- Úsalo solo para cambios humanos, nunca para la IA.

### Chip

Chip de persona para elegir «entre quiénes» se divide un gasto.

- Props: `name`, `tone`, `pressed`, `onToggle`.
- Si está desmarcado, el borde es discontinuo y el avatar gris, de modo que se entiende sin color.

### Avatar

Avatar de persona: sus iniciales en un círculo de su tono.

- Props: `name`, `tone` (por defecto el que fijó `setTones`), `size` (`xs`, `sm`, `md`), `registered` (con `false` queda como círculo vacío con contorno).
- Llama a `setTones({ Valeria: 'morado', … })` una vez por cuenta para que cada quien conserve su color.

### Person

Persona: avatar, nombre, detalle y rol.

- Props: `name`, `sub`, `tone`, `registered` (`false` → «Sin cuenta · solo en WhatsApp»), `role` (`owner`, `admin`, `member`), `size`, `aside`.

### CategoryTag

Categoría: una letra en un cuadro de color.

- Props: `name` (Café, Licor, Mercado, Transporte, Hospedaje, Restaurante, Servicios), `showName`, `size` (`sm`, `md`, `lg`).
- Reemplaza los íconos de categoría.

### BudgetBar

Barra de presupuesto por categoría.

- Props: `name` (categoría), `spent`, `budget`, `category` (`false` para quitar el cuadro de categoría).
- Es verde hasta el 85 %, naranja desde el 85 % y coral pasado el 100 %, cuando dice «Te pasaste $36.900».

### Evidence

Evidencia de un gasto tal como llegó al grupo: foto de recibo, PDF o mensaje, con quién lo mandó.

- Props: `kind` (`foto`, `pdf`, `mensaje`), `sender`, `time`, `group`, `receipt` ({title, sub, lines, total, foot}), `box` (marca amarilla sobre lo leído), `file`, `pages`, `messages` ([{who, whoColor, text, time, dim, target}]).

### CodeInput

Código de una cuenta, grande y con borde grueso: PASEO-7K2Q.

- Props: `value`, `onChange`, `label`, `hint`, `error`, `readOnly`, `id`.
- Formatea mientras se escribe. Correcto se marca en verde y el error en coral, con texto.

### ConnectionStatus

Estado de la conexión con el grupo de WhatsApp, anunciado con `aria-live`.

- Props: `state` (`esperando`, `conectado`, `error`), `children`, `sub`.

### Divider

Divisor.

- Props: `variant` (`line`, `wave`), `label` (texto entre dos líneas).

### LottieSlot

Espacio reservado para una animación Lottie, con su nombre y medidas.

- Props: `name` (`vacio`, `escaneo`, `gasto-registrado`, `conectando-whatsapp`, `whatsapp-conectado`, `cierre-evento`), `width`, `height`, `square`, `label`, `src`.
- Reemplázalo por el reproductor con las mismas medidas. Con movimiento reducido, muestra el último cuadro.


---

## Archivo: styles/tokens.css

```css
/* Lucas — tokens.css (generado de tokens.json). Tema Día por defecto; Noche con data-theme="dark" en <html>
   o automático con prefers-color-scheme si no hay data-theme. */
@font-face { font-family: 'Bricolage Grotesque'; src: url('../fonts/BricolageGrotesque-500.woff2') format('woff2'); font-weight: 500; font-style: normal; font-display: swap; }
@font-face { font-family: 'Bricolage Grotesque'; src: url('../fonts/BricolageGrotesque-600.woff2') format('woff2'); font-weight: 600; font-style: normal; font-display: swap; }
@font-face { font-family: 'Bricolage Grotesque'; src: url('../fonts/BricolageGrotesque-700.woff2') format('woff2'); font-weight: 700; font-style: normal; font-display: swap; }
@font-face { font-family: 'Bricolage Grotesque'; src: url('../fonts/BricolageGrotesque-800.woff2') format('woff2'); font-weight: 800; font-style: normal; font-display: swap; }
@font-face { font-family: 'Figtree'; src: url('../fonts/Figtree-400.woff2') format('woff2'); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: 'Figtree'; src: url('../fonts/Figtree-500.woff2') format('woff2'); font-weight: 500; font-style: normal; font-display: swap; }
@font-face { font-family: 'Figtree'; src: url('../fonts/Figtree-600.woff2') format('woff2'); font-weight: 600; font-style: normal; font-display: swap; }
@font-face { font-family: 'Figtree'; src: url('../fonts/Figtree-700.woff2') format('woff2'); font-weight: 700; font-style: normal; font-display: swap; }
@font-face { font-family: 'Figtree'; src: url('../fonts/Figtree-800.woff2') format('woff2'); font-weight: 800; font-style: normal; font-display: swap; }

:root, [data-theme="light"] {
  --fondo: #FFFBF6;
  --superficie: #FFFFFF;
  --superficie-2: #F3EDF7;
  --borde: #E6DEEE;
  --tinta: #1C1433;
  --tinta-2: #625A78;
  --verde: #0A7A4C;
  --on-verde: #FFFFFF;
  --verde-vivo: #2BD48A;
  --verde-suave: #DDF7EA;
  --morado: #6A35E6;
  --on-morado: #FFFFFF;
  --morado-suave: #ECE4FF;
  --naranja: #FF7A1A;
  --naranja-texto: #B04800;
  --naranja-suave: #FFEBDB;
  --coral: #DB2F47;
  --coral-texto: #C4283F;
  --on-coral: #FFFFFF;
  --coral-suave: #FFE3E7;
  --amarillo: #FFC53D;
  --azul: #1E6FD0;
  --tono-morado: #B79CFF;
  --tono-naranja: #FF9A4D;
  --tono-azul: #7DB8FF;
  --tono-coral: #FF8A99;
  --tono-verde: #2BD48A;
  --tono-amarillo: #FFC53D;
  --tono-turquesa: #3FD6CC;
  --tono-rosa: #FF8FC0;
  --tinta-fija: #1C1433;
  --foco: var(--morado);
  --shadow-card: 0 1px 0 rgba(28,20,51,.06), 0 8px 24px -12px rgba(28,20,51,.18);
  --shadow-sticker: 0 3px 0 rgba(28,20,51,.18);
  --shadow-press: 0 4px 0 #064B2F;
}
[data-theme="dark"] {
  --fondo: #15111F;
  --superficie: #221C33;
  --superficie-2: #2C2542;
  --borde: #3A3152;
  --tinta: #F7F2FF;
  --tinta-2: #B4AACB;
  --verde: #3DDC97;
  --on-verde: #15111F;
  --verde-vivo: #2BD48A;
  --verde-suave: #173A2C;
  --morado: #AE92FF;
  --on-morado: #15111F;
  --morado-suave: #2E2352;
  --naranja: #FF9A4D;
  --naranja-texto: #FF9A4D;
  --naranja-suave: #3D2616;
  --coral: #FF6F82;
  --coral-texto: #FF6F82;
  --on-coral: #15111F;
  --coral-suave: #3F1C26;
  --amarillo: #FFD466;
  --azul: #6AB0FF;
  --tono-morado: #B79CFF;
  --tono-naranja: #FF9A4D;
  --tono-azul: #7DB8FF;
  --tono-coral: #FF8A99;
  --tono-verde: #2BD48A;
  --tono-amarillo: #FFC53D;
  --tono-turquesa: #3FD6CC;
  --tono-rosa: #FF8FC0;
  --tinta-fija: #1C1433;
  --shadow-card: 0 1px 0 rgba(0,0,0,.4), 0 10px 26px -12px rgba(0,0,0,.6);
  --shadow-sticker: 0 3px 0 rgba(0,0,0,.5);
  --shadow-press: 0 4px 0 #1B8A5C;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    --fondo: #15111F;
    --superficie: #221C33;
    --superficie-2: #2C2542;
    --borde: #3A3152;
    --tinta: #F7F2FF;
    --tinta-2: #B4AACB;
    --verde: #3DDC97;
    --on-verde: #15111F;
    --verde-vivo: #2BD48A;
    --verde-suave: #173A2C;
    --morado: #AE92FF;
    --on-morado: #15111F;
    --morado-suave: #2E2352;
    --naranja: #FF9A4D;
    --naranja-texto: #FF9A4D;
    --naranja-suave: #3D2616;
    --coral: #FF6F82;
    --coral-texto: #FF6F82;
    --on-coral: #15111F;
    --coral-suave: #3F1C26;
    --amarillo: #FFD466;
    --azul: #6AB0FF;
    --tono-morado: #B79CFF;
    --tono-naranja: #FF9A4D;
    --tono-azul: #7DB8FF;
    --tono-coral: #FF8A99;
    --tono-verde: #2BD48A;
    --tono-amarillo: #FFC53D;
    --tono-turquesa: #3FD6CC;
    --tono-rosa: #FF8FC0;
    --tinta-fija: #1C1433;
    --shadow-card: 0 1px 0 rgba(0,0,0,.4), 0 10px 26px -12px rgba(0,0,0,.6);
    --shadow-sticker: 0 3px 0 rgba(0,0,0,.5);
    --shadow-press: 0 4px 0 #1B8A5C;
  }
}
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --radius-sm: 10px;
  --radius-md: 16px;
  --radius-lg: 22px;
  --radius-xl: 30px;
  --radius-pill: 999px;
  --dur-fast: 150ms;
  --dur-base: 200ms;
  --dur-slow: 250ms;
  --ease-out: cubic-bezier(.2, .8, .2, 1);
  --ease-pop: cubic-bezier(.3, 1.6, .5, 1);
  --font-display: "Bricolage Grotesque", "Figtree", system-ui, sans-serif;
  --font-sans: "Figtree", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-num: "Bricolage Grotesque", "Figtree", system-ui, sans-serif;
}

```

## Archivo: styles/lucas.css

```css
/* ============ Lucas — bundle.css ============
   Colores, espacios y radios salen de tokens.css. Prefijo: lu-  */

:root { --lu-guilloche: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 480 300' width='480' height='300'%3E%3Cg fill='none' stroke='%23fff' stroke-width='1'%3E%3Cpath d='M0 121.4 L6 136.3 L12 150.7 L18 164.2 L24 176.2 L30 186.4 L36 194.4 L42 200.2 L48 203.5 L54 204.2 L60 202.6 L66 198.7 L72 192.8 L78 185.3 L84 176.5 L90 166.8 L96 156.6 L102 146.6 L108 137.0 L114 128.2 L120 120.7 L126 114.6 L132 110.2 L138 107.5 L144 106.6 L150 107.3 L156 109.5 L162 113.0 L168 117.4 L174 122.4 L180 127.6 L186 132.6 L192 137.0 L198 140.4 L204 142.5 L210 143.0 L216 141.9 L222 138.9 L228 134.2 L234 127.7 L240 119.6 L246 110.3 L252 100.0 L258 89.2 L264 78.2 L270 67.6 L276 57.8 L282 49.2 L288 42.2 L294 37.2 L300 34.5 L306 34.2 L312 36.5 L318 41.3 L324 48.5 L330 57.9 L336 69.3 L342 82.3 L348 96.4 L354 111.1 L360 126.0 L366 140.6 L372 154.3 L378 166.8 L384 177.6 L390 186.4 L396 192.9 L402 197.1 L408 198.8 L414 198.2 L420 195.4 L426 190.5 L432 183.9 L438 176.1 L444 167.3 L450 158.0 L456 148.8 L462 139.9 L468 131.8 L474 124.9 L480 119.3'/%3E%3Cpath d='M0 146.0 L6 160.4 L12 173.7 L18 185.7 L24 195.9 L30 203.9 L36 209.6 L42 212.8 L48 213.4 L54 211.4 L60 207.1 L66 200.6 L72 192.3 L78 182.5 L84 171.7 L90 160.3 L96 148.8 L102 137.6 L108 127.2 L114 118.0 L120 110.2 L126 104.1 L132 99.8 L138 97.4 L144 96.8 L150 98.0 L156 100.6 L162 104.4 L168 109.1 L174 114.3 L180 119.5 L186 124.5 L192 128.7 L198 132.0 L204 133.9 L210 134.2 L216 132.9 L222 129.9 L228 125.2 L234 118.9 L240 111.3 L246 102.7 L252 93.4 L258 83.8 L264 74.4 L270 65.6 L276 57.9 L282 51.6 L288 47.1 L294 44.7 L300 44.6 L306 46.9 L312 51.7 L318 58.8 L324 68.2 L330 79.4 L336 92.3 L342 106.3 L348 121.1 L354 136.0 L360 150.7 L366 164.5 L372 177.2 L378 188.1 L384 197.1 L390 203.7 L396 207.9 L402 209.6 L408 208.8 L414 205.6 L420 200.2 L426 193.0 L432 184.2 L438 174.4 L444 163.9 L450 153.1 L456 142.7 L462 132.9 L468 124.1 L474 116.8 L480 111.0'/%3E%3Cpath d='M0 168.6 L6 181.6 L12 193.3 L18 203.2 L24 211.0 L30 216.4 L36 219.3 L42 219.5 L48 217.2 L54 212.4 L60 205.3 L66 196.2 L72 185.6 L78 173.8 L84 161.2 L90 148.5 L96 136.0 L102 124.2 L108 113.5 L114 104.2 L120 96.7 L126 91.0 L132 87.4 L138 85.8 L144 86.0 L150 88.0 L156 91.5 L162 96.1 L168 101.5 L174 107.3 L180 113.0 L186 118.3 L192 122.9 L198 126.3 L204 128.3 L210 128.9 L216 127.7 L222 125.0 L228 120.6 L234 114.9 L240 108.0 L246 100.4 L252 92.2 L258 84.1 L264 76.3 L270 69.4 L276 63.7 L282 59.5 L288 57.3 L294 57.2 L300 59.4 L306 63.9 L312 70.7 L318 79.7 L324 90.5 L330 102.9 L336 116.5 L342 130.9 L348 145.5 L354 159.9 L360 173.5 L366 186.0 L372 196.8 L378 205.6 L384 212.2 L390 216.2 L396 217.7 L402 216.6 L408 212.9 L414 207.0 L420 199.1 L426 189.4 L432 178.6 L438 166.9 L444 154.8 L450 142.9 L456 131.6 L462 121.3 L468 112.3 L474 104.9 L480 99.3'/%3E%3Cpath d='M0 187.3 L6 198.3 L12 207.7 L18 215.1 L24 220.1 L30 222.7 L36 222.6 L42 219.8 L48 214.5 L54 206.9 L60 197.3 L66 185.9 L72 173.3 L78 159.8 L84 146.1 L90 132.5 L96 119.5 L102 107.6 L108 97.2 L114 88.5 L120 81.8 L126 77.2 L132 74.8 L138 74.5 L144 76.1 L150 79.4 L156 84.2 L162 90.0 L168 96.5 L174 103.2 L180 109.7 L186 115.7 L192 120.8 L198 124.7 L204 127.1 L210 128.0 L216 127.3 L222 124.9 L228 121.1 L234 116.0 L240 110.0 L246 103.3 L252 96.3 L258 89.5 L264 83.3 L270 78.1 L276 74.2 L282 71.9 L288 71.6 L294 73.4 L300 77.4 L306 83.5 L312 91.7 L318 101.8 L324 113.4 L330 126.3 L336 139.9 L342 153.8 L348 167.6 L354 180.8 L360 192.8 L366 203.2 L372 211.7 L378 217.9 L384 221.6 L390 222.7 L396 221.2 L402 217.1 L408 210.7 L414 202.1 L420 191.7 L426 179.9 L432 167.2 L438 154.1 L444 141.0 L450 128.3 L456 116.6 L462 106.3 L468 97.5 L474 90.7 L480 85.8'/%3E%3Cpath d='M0 200.6 L6 209.4 L12 216.2 L18 220.7 L24 222.9 L30 222.4 L36 219.3 L42 213.7 L48 205.7 L54 195.6 L60 183.7 L66 170.6 L72 156.5 L78 142.0 L84 127.6 L90 113.8 L96 101.1 L102 89.8 L108 80.3 L114 72.8 L120 67.6 L126 64.7 L132 64.0 L138 65.5 L144 68.9 L150 74.0 L156 80.4 L162 87.7 L168 95.5 L174 103.4 L180 111.0 L186 117.8 L192 123.5 L198 128.0 L204 130.9 L210 132.1 L216 131.8 L222 129.9 L228 126.5 L234 122.0 L240 116.7 L246 110.8 L252 104.8 L258 99.2 L264 94.2 L270 90.3 L276 87.9 L282 87.1 L288 88.2 L294 91.4 L300 96.5 L306 103.7 L312 112.6 L318 123.2 L324 134.9 L330 147.5 L336 160.5 L342 173.3 L348 185.7 L354 197.0 L360 206.8 L366 214.7 L372 220.5 L378 223.8 L384 224.6 L390 222.7 L396 218.2 L402 211.3 L408 202.2 L414 191.2 L420 178.8 L426 165.3 L432 151.3 L438 137.2 L444 123.6 L450 110.8 L456 99.4 L462 89.6 L468 81.8 L474 76.1 L480 72.6'/%3E%3Cpath d='M0 207.9 L6 214.1 L12 218.2 L18 219.9 L24 219.2 L30 215.9 L36 210.1 L42 201.9 L48 191.6 L54 179.6 L60 166.1 L66 151.7 L72 136.8 L78 122.0 L84 107.7 L90 94.5 L96 82.7 L102 72.7 L108 64.8 L114 59.2 L120 56.0 L126 55.3 L132 56.8 L138 60.5 L144 66.1 L150 73.2 L156 81.5 L162 90.5 L168 99.7 L174 108.8 L180 117.4 L186 125.0 L192 131.3 L198 136.2 L204 139.4 L210 141.0 L216 140.8 L222 139.1 L228 136.0 L234 131.9 L240 126.9 L246 121.6 L252 116.3 L258 111.4 L264 107.3 L270 104.4 L276 102.9 L282 103.1 L288 105.1 L294 109.0 L300 114.9 L306 122.4 L312 131.5 L318 141.9 L324 153.1 L330 164.8 L336 176.6 L342 187.9 L348 198.3 L354 207.4 L360 214.7 L366 220.0 L372 222.9 L378 223.3 L384 221.1 L390 216.3 L396 209.1 L402 199.7 L408 188.3 L414 175.5 L420 161.5 L426 146.9 L432 132.2 L438 117.9 L444 104.5 L450 92.3 L456 81.8 L462 73.4 L468 67.1 L474 63.1 L480 61.5'/%3E%3Cpath d='M0 209.0 L6 212.7 L12 214.2 L18 213.3 L24 209.9 L30 204.2 L36 196.1 L42 185.9 L48 173.9 L54 160.5 L60 146.1 L66 131.3 L72 116.4 L78 102.0 L84 88.6 L90 76.6 L96 66.4 L102 58.4 L108 52.7 L114 49.5 L120 48.8 L126 50.7 L132 54.8 L138 60.9 L144 68.8 L150 78.0 L156 88.2 L162 98.8 L168 109.4 L174 119.6 L180 129.0 L186 137.1 L192 143.8 L198 148.8 L204 152.1 L210 153.6 L216 153.3 L222 151.5 L228 148.3 L234 144.1 L240 139.2 L246 134.1 L252 129.0 L258 124.5 L264 120.8 L270 118.4 L276 117.4 L282 118.0 L288 120.4 L294 124.6 L300 130.5 L306 138.0 L312 146.7 L318 156.4 L324 166.7 L330 177.1 L336 187.3 L342 196.7 L348 205.0 L354 211.6 L360 216.3 L366 218.9 L372 219.0 L378 216.6 L384 211.7 L390 204.4 L396 194.9 L402 183.5 L408 170.5 L414 156.4 L420 141.6 L426 126.6 L432 112.0 L438 98.2 L444 85.7 L450 74.9 L456 66.0 L462 59.5 L468 55.3 L474 53.6 L480 54.4'/%3E%3Cpath d='M0 204.6 L6 206.0 L12 205.1 L18 202.0 L24 196.5 L30 188.8 L36 179.0 L42 167.5 L48 154.5 L54 140.5 L60 126.0 L66 111.4 L72 97.2 L78 84.0 L84 72.1 L90 62.1 L96 54.1 L102 48.6 L108 45.6 L114 45.2 L120 47.4 L126 51.9 L132 58.7 L138 67.4 L144 77.5 L150 88.8 L156 100.6 L162 112.6 L168 124.3 L174 135.2 L180 145.0 L186 153.3 L192 159.9 L198 164.7 L204 167.6 L210 168.5 L216 167.7 L222 165.3 L228 161.6 L234 156.9 L240 151.7 L246 146.3 L252 141.0 L258 136.4 L264 132.8 L270 130.4 L276 129.4 L282 130.1 L288 132.5 L294 136.6 L300 142.1 L306 149.1 L312 157.1 L318 165.8 L324 174.8 L330 183.8 L336 192.2 L342 199.6 L348 205.6 L354 209.9 L360 212.1 L366 212.1 L372 209.7 L378 205.0 L384 197.9 L390 188.6 L396 177.4 L402 164.6 L408 150.7 L414 136.0 L420 121.1 L426 106.6 L432 92.8 L438 80.2 L444 69.3 L450 60.5 L456 53.9 L462 49.8 L468 48.2 L474 49.2 L480 52.6'/%3E%3Cpath d='M0 195.9 L6 195.3 L12 192.6 L18 187.7 L24 180.7 L30 171.7 L36 160.9 L42 148.7 L48 135.4 L54 121.6 L60 107.6 L66 94.0 L72 81.3 L78 69.9 L84 60.2 L90 52.6 L96 47.3 L102 44.7 L108 44.6 L114 47.2 L120 52.2 L126 59.6 L132 69.0 L138 79.9 L144 92.1 L150 105.0 L156 118.2 L162 131.1 L168 143.4 L174 154.5 L180 164.2 L186 172.2 L192 178.2 L198 182.1 L204 184.0 L210 184.0 L216 182.1 L222 178.7 L228 174.0 L234 168.4 L240 162.4 L246 156.3 L252 150.6 L258 145.6 L264 141.6 L270 138.9 L276 137.7 L282 138.1 L288 140.2 L294 143.8 L300 148.9 L306 155.1 L312 162.2 L318 169.8 L324 177.5 L330 184.8 L336 191.5 L342 197.0 L348 200.9 L354 203.1 L360 203.1 L366 201.0 L372 196.6 L378 190.0 L384 181.2 L390 170.6 L396 158.4 L402 145.0 L408 130.8 L414 116.4 L420 102.2 L426 88.8 L432 76.5 L438 65.8 L444 57.2 L450 50.8 L456 46.9 L462 45.7 L468 47.0 L474 50.9 L480 57.1'/%3E%3Cpath d='M0 184.5 L6 182.6 L12 178.5 L18 172.5 L24 164.5 L30 154.9 L36 143.8 L42 131.6 L48 118.7 L54 105.7 L60 93.0 L66 81.0 L72 70.2 L78 61.1 L84 54.0 L90 49.2 L96 46.9 L102 47.2 L108 50.2 L114 55.7 L120 63.5 L126 73.4 L132 85.0 L138 97.9 L144 111.7 L150 125.7 L156 139.7 L162 152.9 L168 165.2 L174 175.9 L180 184.9 L186 191.8 L192 196.6 L198 199.2 L204 199.6 L210 198.0 L216 194.6 L222 189.7 L228 183.7 L234 176.9 L240 169.8 L246 162.7 L252 156.2 L258 150.5 L264 145.9 L270 142.8 L276 141.2 L282 141.2 L288 142.9 L294 146.0 L300 150.5 L306 156.0 L312 162.2 L318 168.7 L324 175.2 L330 181.1 L336 186.2 L342 190.0 L348 192.3 L354 192.7 L360 191.1 L366 187.3 L372 181.4 L378 173.5 L384 163.8 L390 152.5 L396 140.0 L402 126.7 L408 113.1 L414 99.6 L420 86.8 L426 75.1 L432 64.9 L438 56.7 L444 50.7 L450 47.1 L456 46.2 L462 48.0 L468 52.3 L474 59.0 L480 67.8'/%3E%3Cpath d='M0 172.5 L6 169.7 L12 164.9 L18 158.3 L24 150.0 L30 140.3 L36 129.5 L42 118.0 L48 106.1 L54 94.4 L60 83.4 L66 73.5 L72 65.0 L78 58.5 L84 54.2 L90 52.3 L96 53.0 L102 56.2 L108 62.0 L114 70.1 L120 80.4 L126 92.4 L132 105.8 L138 120.0 L144 134.7 L150 149.3 L156 163.3 L162 176.2 L168 187.7 L174 197.4 L180 204.9 L186 210.3 L192 213.3 L198 213.9 L204 212.4 L210 208.8 L216 203.5 L222 196.8 L228 189.1 L234 180.9 L240 172.5 L246 164.3 L252 156.9 L258 150.5 L264 145.4 L270 141.8 L276 139.8 L282 139.5 L288 140.8 L294 143.5 L300 147.5 L306 152.4 L312 157.9 L318 163.6 L324 169.1 L330 174.0 L336 177.9 L342 180.5 L348 181.4 L354 180.6 L360 177.8 L366 173.0 L372 166.2 L378 157.7 L384 147.6 L390 136.4 L396 124.2 L402 111.7 L408 99.2 L414 87.2 L420 76.3 L426 66.8 L432 59.1 L438 53.6 L444 50.5 L450 50.0 L456 52.1 L462 56.8 L468 63.9 L474 73.2 L480 84.4'/%3E%3Cpath d='M0 161.7 L6 158.5 L12 153.5 L18 146.9 L24 138.9 L30 129.6 L36 119.6 L42 109.1 L48 98.7 L54 88.8 L60 79.7 L66 72.1 L72 66.2 L78 62.3 L84 60.7 L90 61.6 L96 65.0 L102 70.9 L108 79.1 L114 89.5 L120 101.6 L126 115.1 L132 129.6 L138 144.5 L144 159.4 L150 173.7 L156 187.0 L162 198.9 L168 208.9 L174 216.9 L180 222.4 L186 225.6 L192 226.2 L198 224.5 L204 220.6 L210 214.8 L216 207.4 L222 198.7 L228 189.3 L234 179.5 L240 169.8 L246 160.7 L252 152.4 L258 145.4 L264 139.9 L270 136.0 L276 133.9 L282 133.4 L288 134.6 L294 137.3 L300 141.0 L306 145.7 L312 150.8 L318 156.0 L324 160.9 L330 165.2 L336 168.3 L342 170.1 L348 170.3 L354 168.7 L360 165.2 L366 159.9 L372 152.9 L378 144.4 L384 134.6 L390 123.9 L396 112.6 L402 101.4 L408 90.5 L414 80.5 L420 71.7 L426 64.7 L432 59.7 L438 57.1 L444 56.9 L450 59.2 L456 64.1 L462 71.5 L468 81.0 L474 92.5 L480 105.4'/%3E%3Cpath d='M0 153.9 L6 150.8 L12 146.0 L18 139.7 L24 132.3 L30 123.9 L36 114.9 L42 105.8 L48 97.0 L54 89.0 L60 82.1 L66 76.7 L72 73.2 L78 71.9 L84 72.8 L90 76.2 L96 82.0 L102 90.0 L108 100.1 L114 112.0 L120 125.3 L126 139.6 L132 154.4 L138 169.3 L144 183.6 L150 196.9 L156 208.9 L162 219.0 L168 226.9 L174 232.5 L180 235.6 L186 236.1 L192 234.1 L198 229.7 L204 223.3 L210 215.0 L216 205.4 L222 194.8 L228 183.7 L234 172.6 L240 161.8 L246 151.9 L252 143.2 L258 135.9 L264 130.3 L270 126.5 L276 124.5 L282 124.3 L288 125.8 L294 128.7 L300 132.7 L306 137.5 L312 142.7 L318 147.8 L324 152.6 L330 156.5 L336 159.4 L342 160.8 L348 160.7 L354 158.9 L360 155.3 L366 150.0 L372 143.2 L378 135.1 L384 126.0 L390 116.3 L396 106.3 L402 96.6 L408 87.6 L414 79.7 L420 73.4 L426 68.9 L432 66.5 L438 66.6 L444 69.0 L450 74.0 L456 81.3 L462 90.8 L468 102.2 L474 115.2 L480 129.4'/%3E%3Cpath d='M0 150.3 L6 147.5 L12 143.2 L18 137.6 L24 130.9 L30 123.5 L36 115.8 L42 108.1 L48 100.9 L54 94.7 L60 89.8 L66 86.6 L72 85.2 L78 86.1 L84 89.1 L90 94.5 L96 102.1 L102 111.6 L108 123.0 L114 135.7 L120 149.5 L126 163.9 L132 178.3 L138 192.2 L144 205.3 L150 216.9 L156 226.8 L162 234.6 L168 240.0 L174 242.8 L180 243.0 L186 240.6 L192 235.8 L198 228.7 L204 219.7 L210 209.2 L216 197.6 L222 185.3 L228 172.8 L234 160.7 L240 149.2 L246 138.9 L252 130.1 L258 123.0 L264 117.8 L270 114.6 L276 113.3 L282 113.9 L288 116.1 L294 119.7 L300 124.3 L306 129.7 L312 135.3 L318 140.8 L324 145.8 L330 149.9 L336 152.9 L342 154.4 L348 154.4 L354 152.7 L360 149.3 L366 144.4 L372 138.1 L378 130.7 L384 122.6 L390 114.1 L396 105.7 L402 97.7 L408 90.6 L414 84.8 L420 80.8 L426 78.6 L432 78.7 L438 81.1 L444 85.8 L450 92.8 L456 102.0 L462 113.1 L468 125.7 L474 139.5 L480 154.1'/%3E%3Cpath d='M0 151.6 L6 149.2 L12 145.5 L18 140.5 L24 134.6 L30 128.2 L36 121.6 L42 115.3 L48 109.6 L54 105.0 L60 101.8 L66 100.3 L72 100.7 L78 103.2 L84 107.9 L90 114.6 L96 123.4 L102 133.8 L108 145.7 L114 158.6 L120 172.1 L126 185.8 L132 199.1 L138 211.5 L144 222.7 L150 232.1 L156 239.5 L162 244.5 L168 246.9 L174 246.8 L180 244.0 L186 238.7 L192 231.1 L198 221.4 L204 210.1 L210 197.6 L216 184.4 L222 170.8 L228 157.5 L234 144.8 L240 133.3 L246 123.2 L252 114.9 L258 108.6 L264 104.3 L270 102.2 L276 102.1 L282 103.9 L288 107.3 L294 112.1 L300 117.8 L306 124.1 L312 130.6 L318 136.8 L324 142.4 L330 147.0 L336 150.3 L342 152.2 L348 152.4 L354 151.1 L360 148.2 L366 143.8 L372 138.2 L378 131.7 L384 124.6 L390 117.4 L396 110.4 L402 104.0 L408 98.7 L414 94.9 L420 92.8 L426 92.7 L432 94.7 L438 99.0 L444 105.4 L450 114.0 L456 124.4 L462 136.3 L468 149.4 L474 163.3 L480 177.5'/%3E%3Cpath d='M0 157.7 L6 155.8 L12 152.4 L18 148.0 L24 142.7 L30 137.1 L36 131.4 L42 126.1 L48 121.6 L54 118.2 L60 116.3 L66 116.1 L72 117.7 L78 121.4 L84 127.1 L90 134.6 L96 143.8 L102 154.5 L108 166.2 L114 178.6 L120 191.2 L126 203.6 L132 215.2 L138 225.6 L144 234.4 L150 241.3 L156 245.8 L162 247.9 L168 247.4 L174 244.2 L180 238.5 L186 230.5 L192 220.4 L198 208.5 L204 195.4 L210 181.4 L216 167.1 L222 152.9 L228 139.3 L234 126.8 L240 115.8 L246 106.6 L252 99.4 L258 94.5 L264 91.8 L270 91.3 L276 92.9 L282 96.4 L288 101.5 L294 107.8 L300 114.9 L306 122.4 L312 130.0 L318 137.1 L324 143.4 L330 148.6 L336 152.5 L342 154.8 L348 155.4 L354 154.5 L360 152.0 L366 148.2 L372 143.2 L378 137.5 L384 131.4 L390 125.2 L396 119.5 L402 114.5 L408 110.7 L414 108.4 L420 107.9 L426 109.3 L432 112.8 L438 118.4 L444 126.0 L450 135.3 L456 146.2 L462 158.3 L468 171.2 L474 184.5 L480 197.6'/%3E%3Cpath d='M0 168.1 L6 166.2 L12 163.1 L18 158.8 L24 153.9 L30 148.7 L36 143.6 L42 138.9 L48 135.1 L54 132.5 L60 131.4 L66 132.0 L72 134.4 L78 138.6 L84 144.7 L90 152.4 L96 161.6 L102 171.9 L108 182.9 L114 194.2 L120 205.4 L126 216.1 L132 225.6 L138 233.7 L144 240.0 L150 244.0 L156 245.7 L162 244.9 L168 241.5 L174 235.6 L180 227.3 L186 216.9 L192 204.8 L198 191.3 L204 176.9 L210 162.1 L216 147.4 L222 133.2 L228 120.1 L234 108.5 L240 98.7 L246 91.1 L252 85.7 L258 82.7 L264 82.0 L270 83.7 L276 87.4 L282 93.0 L288 100.0 L294 108.0 L300 116.8 L306 125.7 L312 134.4 L318 142.4 L324 149.5 L330 155.3 L336 159.6 L342 162.2 L348 163.2 L354 162.5 L360 160.3 L366 156.9 L372 152.4 L378 147.2 L384 141.7 L390 136.4 L396 131.5 L402 127.6 L408 124.9 L414 123.7 L420 124.2 L426 126.7 L432 131.0 L438 137.3 L444 145.3 L450 154.9 L456 165.7 L462 177.3 L468 189.4 L474 201.5 L480 213.0'/%3E%3Cpath d='M0 181.4 L6 179.3 L12 175.9 L18 171.5 L24 166.5 L30 161.3 L36 156.3 L42 151.8 L48 148.3 L54 146.0 L60 145.3 L66 146.1 L72 148.8 L78 153.1 L84 159.1 L90 166.6 L96 175.2 L102 184.6 L108 194.5 L114 204.5 L120 214.0 L126 222.6 L132 229.9 L138 235.6 L144 239.2 L150 240.6 L156 239.6 L162 236.1 L168 230.2 L174 221.9 L180 211.6 L186 199.5 L192 185.9 L198 171.5 L204 156.6 L210 141.7 L216 127.3 L222 114.0 L228 102.1 L234 92.1 L240 84.2 L246 78.6 L252 75.6 L258 75.0 L264 76.9 L270 81.0 L276 87.1 L282 94.9 L288 103.9 L294 113.8 L300 124.1 L306 134.4 L312 144.1 L318 153.0 L324 160.6 L330 166.8 L336 171.3 L342 174.0 L348 175.0 L354 174.3 L360 172.1 L366 168.6 L372 164.2 L378 159.2 L384 154.0 L390 149.1 L396 144.7 L402 141.3 L408 139.2 L414 138.6 L420 139.8 L426 142.7 L432 147.4 L438 153.8 L444 161.8 L450 171.0 L456 181.2 L462 191.9 L468 202.6 L474 213.1 L480 222.7'/%3E%3Cpath d='M0 195.9 L6 193.1 L12 189.0 L18 184.0 L24 178.5 L30 172.9 L36 167.6 L42 163.0 L48 159.3 L54 157.0 L60 156.2 L66 157.0 L72 159.4 L78 163.5 L84 169.1 L90 175.9 L96 183.7 L102 192.1 L108 200.6 L114 209.0 L120 216.7 L126 223.3 L132 228.4 L138 231.7 L144 233.0 L150 232.0 L156 228.6 L162 222.9 L168 215.0 L174 205.0 L180 193.2 L186 180.0 L192 165.8 L198 151.1 L204 136.4 L210 122.2 L216 109.0 L222 97.2 L228 87.2 L234 79.3 L240 73.9 L246 71.0 L252 70.6 L258 72.8 L264 77.4 L270 84.2 L276 92.7 L282 102.8 L288 113.8 L294 125.3 L300 137.0 L306 148.3 L312 158.8 L318 168.1 L324 175.9 L330 182.1 L336 186.4 L342 188.8 L348 189.4 L354 188.2 L360 185.6 L366 181.7 L372 177.0 L378 171.8 L384 166.5 L390 161.5 L396 157.2 L402 153.9 L408 151.9 L414 151.5 L420 152.7 L426 155.7 L432 160.3 L438 166.5 L444 173.9 L450 182.4 L456 191.6 L462 201.0 L468 210.2 L474 218.8 L480 226.3'/%3E%3Cpath d='M0 209.8 L6 205.8 L12 200.6 L18 194.6 L24 188.2 L30 181.8 L36 175.9 L42 170.7 L48 166.7 L54 164.0 L60 162.8 L66 163.3 L72 165.4 L78 169.0 L84 174.0 L90 180.0 L96 186.9 L102 194.1 L108 201.3 L114 208.2 L120 214.1 L126 218.9 L132 222.0 L138 223.3 L144 222.6 L150 219.6 L156 214.4 L162 207.0 L168 197.7 L174 186.6 L180 174.1 L186 160.6 L192 146.5 L198 132.3 L204 118.6 L210 105.8 L216 94.3 L222 84.6 L228 77.1 L234 71.9 L240 69.3 L246 69.3 L252 71.9 L258 77.0 L264 84.3 L270 93.6 L276 104.5 L282 116.5 L288 129.2 L294 142.1 L300 154.7 L306 166.6 L312 177.3 L318 186.6 L324 194.2 L330 199.8 L336 203.4 L342 204.9 L348 204.6 L354 202.5 L360 199.0 L366 194.3 L372 188.8 L378 182.9 L384 177.1 L390 171.7 L396 167.0 L402 163.5 L408 161.4 L414 160.8 L420 161.8 L426 164.4 L432 168.7 L438 174.3 L444 181.0 L450 188.5 L456 196.5 L462 204.5 L468 212.1 L474 218.8 L480 224.4'/%3E%3Cpath d='M0 221.1 L6 215.5 L12 208.8 L18 201.5 L24 194.0 L30 186.6 L36 179.8 L42 174.0 L48 169.4 L54 166.2 L60 164.6 L66 164.7 L72 166.4 L78 169.5 L84 173.9 L90 179.2 L96 185.2 L102 191.4 L108 197.5 L114 203.0 L120 207.5 L126 210.7 L132 212.3 L138 212.0 L144 209.7 L150 205.3 L156 198.9 L162 190.5 L168 180.4 L174 168.9 L180 156.4 L186 143.3 L192 130.0 L198 117.0 L204 104.9 L210 94.0 L216 84.9 L222 77.7 L228 73.0 L234 70.7 L240 71.1 L246 74.1 L252 79.6 L258 87.5 L264 97.4 L270 109.0 L276 121.8 L282 135.3 L288 149.2 L294 162.9 L300 175.9 L306 187.8 L312 198.2 L318 206.9 L324 213.5 L330 218.0 L336 220.3 L342 220.5 L348 218.7 L354 215.3 L360 210.4 L366 204.4 L372 197.8 L378 191.0 L384 184.3 L390 178.2 L396 173.0 L402 169.0 L408 166.4 L414 165.4 L420 166.0 L426 168.3 L432 172.0 L438 176.9 L444 182.9 L450 189.4 L456 196.3 L462 202.9 L468 209.0 L474 214.1 L480 217.9'/%3E%3Cpath d='M0 228.2 L6 220.7 L12 212.4 L18 203.6 L24 194.8 L30 186.3 L36 178.7 L42 172.2 L48 167.0 L54 163.5 L60 161.6 L66 161.4 L72 162.7 L78 165.5 L84 169.5 L90 174.4 L96 179.7 L102 185.2 L108 190.4 L114 194.9 L120 198.4 L126 200.5 L132 201.0 L138 199.6 L144 196.3 L150 191.1 L156 184.1 L162 175.3 L168 165.2 L174 153.9 L180 142.0 L186 129.8 L192 117.9 L198 106.7 L204 96.6 L210 88.1 L216 81.5 L222 77.2 L228 75.4 L234 76.1 L240 79.4 L246 85.3 L252 93.5 L258 103.8 L264 115.8 L270 129.2 L276 143.4 L282 157.9 L288 172.4 L294 186.2 L300 198.9 L306 210.1 L312 219.5 L318 226.8 L324 231.9 L330 234.7 L336 235.2 L342 233.5 L348 229.9 L354 224.7 L360 218.1 L366 210.6 L372 202.6 L378 194.6 L384 186.9 L390 179.9 L396 174.0 L402 169.5 L408 166.5 L414 165.1 L420 165.4 L426 167.2 L432 170.4 L438 174.9 L444 180.1 L450 185.9 L456 191.7 L462 197.3 L468 202.2 L474 206.0 L480 208.3'/%3E%3Cpath d='M0 229.9 L6 220.5 L12 210.5 L18 200.2 L24 190.2 L30 180.8 L36 172.4 L42 165.4 L48 160.0 L54 156.3 L60 154.3 L66 154.1 L72 155.5 L78 158.3 L84 162.2 L90 166.9 L96 172.0 L102 177.2 L108 181.9 L114 185.9 L120 188.8 L126 190.2 L132 190.1 L138 188.2 L144 184.5 L150 179.0 L156 171.8 L162 163.2 L168 153.5 L174 143.1 L180 132.2 L186 121.5 L192 111.3 L198 102.1 L204 94.4 L210 88.4 L216 84.6 L222 83.1 L228 84.1 L234 87.6 L240 93.6 L246 102.0 L252 112.4 L258 124.6 L264 138.2 L270 152.7 L276 167.6 L282 182.4 L288 196.7 L294 209.8 L300 221.6 L306 231.4 L312 239.1 L318 244.5 L324 247.5 L330 248.1 L336 246.3 L342 242.4 L348 236.6 L354 229.3 L360 220.8 L366 211.6 L372 202.2 L378 192.9 L384 184.2 L390 176.5 L396 170.1 L402 165.1 L408 161.8 L414 160.2 L420 160.3 L426 161.9 L432 164.9 L438 169.0 L444 173.9 L450 179.2 L456 184.4 L462 189.3 L468 193.3 L474 196.2 L480 197.7'/%3E%3Cpath d='M0 225.8 L6 214.5 L12 202.9 L18 191.4 L24 180.4 L30 170.4 L36 161.7 L42 154.6 L48 149.3 L54 145.8 L60 144.2 L66 144.4 L72 146.2 L78 149.4 L84 153.7 L90 158.7 L96 163.9 L102 169.2 L108 173.9 L114 177.8 L120 180.5 L126 181.8 L132 181.5 L138 179.5 L144 175.7 L150 170.4 L156 163.6 L162 155.6 L168 146.8 L174 137.4 L180 128.0 L186 118.9 L192 110.7 L198 103.7 L204 98.3 L210 94.8 L216 93.6 L222 94.7 L228 98.2 L234 104.2 L240 112.4 L246 122.7 L252 134.8 L258 148.3 L264 162.7 L270 177.6 L276 192.4 L282 206.7 L288 220.0 L294 231.9 L300 241.9 L306 249.7 L312 255.2 L318 258.1 L324 258.6 L330 256.5 L336 252.2 L342 245.8 L348 237.6 L354 228.2 L360 217.8 L366 207.1 L372 196.3 L378 186.0 L384 176.5 L390 168.2 L396 161.5 L402 156.4 L408 153.1 L414 151.6 L420 151.8 L426 153.7 L432 156.8 L438 161.0 L444 165.9 L450 171.1 L456 176.1 L462 180.7 L468 184.3 L474 186.8 L480 187.9'/%3E%3Cpath d='M0 215.8 L6 203.0 L12 190.2 L18 177.9 L24 166.5 L30 156.3 L36 147.8 L42 141.1 L48 136.3 L54 133.6 L60 132.9 L66 134.0 L72 136.7 L78 140.8 L84 145.8 L90 151.5 L96 157.4 L102 163.0 L108 168.1 L114 172.3 L120 175.2 L126 176.7 L132 176.6 L138 174.8 L144 171.4 L150 166.5 L156 160.3 L162 153.2 L168 145.4 L174 137.3 L180 129.4 L186 122.1 L192 115.7 L198 110.8 L204 107.6 L210 106.4 L216 107.4 L222 110.8 L228 116.4 L234 124.2 L240 134.1 L246 145.7 L252 158.7 L258 172.7 L264 187.2 L270 201.7 L276 215.7 L282 228.8 L288 240.5 L294 250.3 L300 258.0 L306 263.3 L312 266.1 L318 266.2 L324 263.8 L330 259.0 L336 251.9 L342 243.0 L348 232.6 L354 221.2 L360 209.2 L366 197.0 L372 185.3 L378 174.2 L384 164.4 L390 156.0 L396 149.4 L402 144.6 L408 141.8 L414 140.9 L420 141.7 L426 144.2 L432 147.9 L438 152.6 L444 157.9 L450 163.4 L456 168.7 L462 173.4 L468 177.1 L474 179.6 L480 180.6'/%3E%3Cpath d='M0 200.9 L6 187.1 L12 173.7 L18 161.1 L24 149.8 L30 140.1 L36 132.3 L42 126.6 L48 123.0 L54 121.6 L60 122.3 L66 124.8 L72 128.9 L78 134.2 L84 140.5 L90 147.2 L96 154.0 L102 160.4 L108 166.1 L114 170.8 L120 174.2 L126 176.1 L132 176.3 L138 174.9 L144 172.0 L150 167.7 L156 162.3 L162 156.0 L168 149.2 L174 142.4 L180 135.9 L186 130.1 L192 125.5 L198 122.4 L204 121.1 L210 121.8 L216 124.6 L222 129.6 L228 136.7 L234 145.7 L240 156.5 L246 168.7 L252 181.9 L258 195.7 L264 209.6 L270 223.0 L276 235.6 L282 246.8 L288 256.3 L294 263.6 L300 268.6 L306 271.0 L312 270.8 L318 268.0 L324 262.6 L330 255.0 L336 245.4 L342 234.2 L348 221.9 L354 208.8 L360 195.5 L366 182.5 L372 170.2 L378 159.0 L384 149.3 L390 141.3 L396 135.4 L402 131.5 L408 129.7 L414 129.8 L420 131.8 L426 135.3 L432 140.1 L438 145.8 L444 151.9 L450 158.1 L456 164.0 L462 169.1 L468 173.2 L474 176.0 L480 177.3'/%3E%3C/g%3E%3Ccircle cx='360' cy='150' r='70' fill='none' stroke='%23fff' stroke-width='1.5'/%3E%3Ccircle cx='360' cy='150' r='58' fill='none' stroke='%23fff' stroke-width='1'/%3E%3C/svg%3E"); }

body { margin: 0; background: var(--fondo); color: var(--tinta); font-family: var(--font-sans); font-size: 16px; line-height: 24px; -webkit-font-smoothing: antialiased; }
*, *::before, *::after { box-sizing: border-box; }
.lu-page { background: var(--fondo); color: var(--tinta); }

/* ---------- tipografía ---------- */
.lu-display { font-family: var(--font-display); font-weight: 800; font-size: 36px; line-height: 38px; letter-spacing: -.03em; margin: 0; }
.lu-display-xl { font-family: var(--font-display); font-weight: 800; font-size: 52px; line-height: 50px; letter-spacing: -.035em; margin: 0; }
.lu-title { font-family: var(--font-display); font-weight: 700; font-size: 22px; line-height: 26px; letter-spacing: -.015em; margin: 0; }
.lu-label { font-size: 12px; line-height: 16px; font-weight: 700; letter-spacing: .02em; color: var(--tinta-2); }
.lu-small { font-size: 14px; line-height: 20px; font-weight: 500; }
.lu-muted { color: var(--tinta-2); }
.lu-num { font-family: var(--font-num); font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; }
/* palabra marcada con amarillo: una por pantalla */
.lu-mark { background: var(--amarillo); color: var(--tinta-fija); border-radius: 8px; padding: 0 .18em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }

/* ---------- divisor ---------- */
.lu-divider { border: 0; height: 1px; background: var(--borde); margin: var(--space-3) 0; }
.lu-divider--wave { height: 8px; background: none; -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='8'%3E%3Cpath d='M0 4 Q6 0 12 4 T24 4' fill='none' stroke='%23000' stroke-width='2'/%3E%3C/svg%3E") left center / 24px 8px repeat-x; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='8'%3E%3Cpath d='M0 4 Q6 0 12 4 T24 4' fill='none' stroke='%23000' stroke-width='2'/%3E%3C/svg%3E") left center / 24px 8px repeat-x; background-color: var(--borde); }
.lu-divider--label { display: flex; align-items: center; gap: var(--space-3); height: auto; background: none; }
.lu-divider--label::before, .lu-divider--label::after { content: ""; flex: 1; height: 1px; background: var(--borde); }

/* ---------- montos ---------- */
.lu-amount { font-family: var(--font-num); font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1; font-weight: 600; white-space: nowrap; letter-spacing: -.01em; }
.lu-amount--sm { font-size: 13px; line-height: 18px; }
.lu-amount--md { font-size: 16px; line-height: 22px; }
.lu-amount--lg { font-size: 26px; line-height: 30px; font-weight: 700; letter-spacing: -.02em; }
.lu-amount--xl { font-size: 48px; line-height: 52px; font-weight: 800; letter-spacing: -.04em; }
.lu-amount--neg { color: var(--coral-texto); }
.lu-amount--pos { color: var(--verde); }
.lu-amount--hl { background: var(--amarillo); color: var(--tinta-fija); border-radius: 10px; padding: 0 .16em; }
.lu-roll { display: inline-flex; align-items: flex-start; height: 1.1em; line-height: 1.1em; overflow: hidden; vertical-align: bottom; }
.lu-roll__col { flex: none; display: flex; flex-direction: column; transition: transform var(--dur-slow) var(--ease-out); }
.lu-roll__col > span { height: 1.1em; display: block; }
.lu-lucas { font-family: var(--font-sans); font-weight: 600; font-size: 13px; color: var(--tinta-2); }

/* ---------- tarjeta billete (hero) ---------- */
.lu-bill { position: relative; overflow: hidden; border-radius: var(--radius-xl); padding: var(--space-6); color: var(--on-verde); background: var(--verde); isolation: isolate; }
.lu-bill::before { content: ""; position: absolute; inset: 0; z-index: -1; background: var(--lu-guilloche) right -40px top -30px / 460px auto no-repeat; opacity: .22; }
.lu-bill--morado { background: var(--morado); color: var(--on-morado); }
.lu-bill__top { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--space-3); }
.lu-bill__label { font-size: 13px; line-height: 18px; font-weight: 700; opacity: .92; }
.lu-bill__denom { font-family: var(--font-display); font-weight: 800; font-size: 13px; letter-spacing: .12em; border: 2px solid currentColor; border-radius: var(--radius-pill); padding: 2px 10px; opacity: .9; white-space: nowrap; }
.lu-bill__amount { display: block; margin-top: var(--space-2); }
.lu-bill__amount .lu-amount--hl { background: var(--amarillo); color: var(--tinta-fija); }
.lu-bill__foot { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin-top: var(--space-4); font-size: 14px; line-height: 20px; font-weight: 600; }
.lu-bill__foot b { font-family: var(--font-num); font-weight: 700; }

/* ---------- tarjeta de gasto ---------- */
.lu-card { position: relative; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radius-lg); box-shadow: var(--shadow-card); padding: var(--space-5); color: var(--tinta); }
.lu-card--flat { box-shadow: none; }
.lu-card--click { cursor: pointer; transition: transform var(--dur-fast) ease; }
.lu-card--click:hover { transform: translateY(-2px); }
.lu-expense { display: grid; grid-template-columns: auto 1fr auto; gap: 2px var(--space-3); align-items: center; }
.lu-expense__cat { grid-row: span 2; }
.lu-expense__m { font-weight: 800; font-size: 16px; line-height: 21px; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.lu-expense__amt .lu-amount--lg { font-size: 22px; line-height: 26px; }
.lu-expense__meta { font-size: 13px; line-height: 18px; color: var(--tinta-2); grid-column: 2; }
.lu-expense__amt { grid-row: 1; grid-column: 3; text-align: right; }
.lu-expense__each { grid-row: 2; grid-column: 3; text-align: right; font-size: 12px; color: var(--tinta-2); font-family: var(--font-num); font-weight: 600; }
.lu-expense__body { margin-top: var(--space-3); }
.lu-card__sticker { position: absolute; right: -6px; top: -12px; z-index: 3; pointer-events: none; }
.lu-appear { animation: lu-appear var(--dur-slow) var(--ease-pop) both; }
@keyframes lu-appear { from { opacity: 0; transform: translateY(18px) scale(.96); } to { opacity: 1; transform: none; } }

.lu-row { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); font-size: 15px; line-height: 22px; padding: 4px 0; }
.lu-row__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lu-row--muted { color: var(--tinta-2); }
.lu-row--total { border-top: 1px solid var(--borde); margin-top: var(--space-2); padding-top: var(--space-3); font-weight: 700; }

/* ---------- sticker de estado ---------- */
.lu-sticker { --rot: -4deg; display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-display); font-weight: 800; font-size: 14px; line-height: 18px; letter-spacing: .01em; padding: 5px 12px 6px; border-radius: var(--radius-pill); border: 3px solid var(--superficie); box-shadow: var(--shadow-sticker); transform: rotate(var(--rot)); white-space: nowrap; user-select: none; }
.lu-sticker--pagado, .lu-sticker--confirmado { background: var(--verde-vivo); color: var(--tinta-fija); }
.lu-sticker--revisar { background: var(--naranja); color: var(--tinta-fija); }
.lu-sticker--pendiente { background: var(--superficie-2); color: var(--tinta); }
.lu-sticker--alerta { background: var(--coral); color: var(--on-coral); }
.lu-sticker--cerrado { background: var(--morado); color: var(--on-morado); }
.lu-sticker--sm { font-size: 12px; line-height: 14px; padding: 3px 9px 4px; border-width: 2px; }
.lu-sticker--lg { font-size: 22px; line-height: 26px; padding: 8px 20px 10px; border-width: 4px; }
.lu-sticker__sub { font-family: var(--font-sans); font-weight: 700; font-size: .72em; opacity: .8; }
.lu-sticker__dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.lu-sticker--pop { animation: lu-pop var(--dur-slow) var(--ease-pop) both; }
@keyframes lu-pop {
  0% { opacity: 0; transform: rotate(calc(var(--rot) - 10deg)) scale(1.3); }
  60% { opacity: 1; transform: rotate(calc(var(--rot) + 2deg)) scale(.95); }
  100% { opacity: 1; transform: rotate(var(--rot)) scale(1); }
}

/* ---------- corrección humana ---------- */
.lu-fix { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.lu-fix__was { font-family: var(--font-num); font-weight: 600; font-size: 13px; color: var(--tinta-2); text-decoration: line-through; text-decoration-color: var(--morado); text-decoration-thickness: 2px; }
.lu-fix__now { font-weight: 700; color: var(--morado); background: var(--morado-suave); border-radius: 8px; padding: 0 6px; }
.lu-fix__by { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; line-height: 16px; font-weight: 700; color: var(--morado); }

/* ---------- botones ---------- */
.lu-btn { font: inherit; font-weight: 700; font-size: 16px; line-height: 20px; display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); min-height: 48px; padding: 0 var(--space-6); border-radius: var(--radius-md); border: 0; cursor: pointer; transition: transform var(--dur-fast) ease, box-shadow var(--dur-fast) ease, background-color var(--dur-fast) ease; white-space: nowrap; text-decoration: none; }
.lu-btn:focus-visible, .lu-field input:focus-visible, .lu-field select:focus-visible, .lu-chip:focus-visible, .lu-code__input:focus-visible { outline: 2px solid var(--foco); outline-offset: 2px; }
.lu-btn--primary { background: var(--verde); color: var(--on-verde); box-shadow: var(--shadow-press); margin-bottom: 4px; }
.lu-btn--primary:active { transform: translateY(3px); box-shadow: 0 1px 0 #064B2F; }
.lu-btn--secondary { background: var(--superficie-2); color: var(--tinta); }
.lu-btn--secondary:hover { background: var(--borde); }
.lu-btn--outline { background: transparent; color: var(--tinta); box-shadow: inset 0 0 0 2px var(--tinta); }
.lu-btn--ghost { background: transparent; color: var(--tinta); padding: 0 var(--space-3); text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; text-decoration-color: var(--borde); }
.lu-btn--sm { min-height: 36px; font-size: 14px; padding: 0 var(--space-4); border-radius: var(--radius-sm); }
.lu-btn--sm.lu-btn--primary { box-shadow: 0 3px 0 #064B2F; margin-bottom: 3px; }
.lu-btn[disabled] { opacity: .4; cursor: not-allowed; transform: none; }
.lu-btn__kbd { font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 6px; background: rgba(255,255,255,.2); }

/* ---------- campos ---------- */
.lu-field { display: grid; gap: 6px; }
.lu-field__top { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); }
.lu-field input, .lu-field select { font: inherit; font-size: 16px; line-height: 22px; font-weight: 600; color: var(--tinta); background: var(--superficie); border: 1.5px solid var(--borde); border-radius: var(--radius-sm); padding: 10px 12px; width: 100%; }
.lu-field input:hover, .lu-field select:hover { border-color: var(--tinta-2); }
.lu-field--num input { font-family: var(--font-num); font-variant-numeric: tabular-nums; font-weight: 700; }
.lu-field--low input, .lu-field--low select { border-color: var(--naranja); background: var(--naranja-suave); }
.lu-field--fixed input, .lu-field--fixed select { border-color: var(--morado); background: var(--morado-suave); color: var(--morado); }

/* ---------- confianza ---------- */
.lu-conf { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; font-weight: 700; color: var(--tinta-2); white-space: nowrap; }
.lu-conf__dots { display: inline-flex; gap: 3px; }
.lu-conf__dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--borde); }
.lu-conf--alta .lu-conf__dots i { background: var(--verde); }
.lu-conf--media .lu-conf__dots i:nth-child(-n+2) { background: var(--tinta-2); }
.lu-conf--baja { color: var(--naranja-texto); }
.lu-conf--baja .lu-conf__dots i:nth-child(1) { background: var(--naranja); }
.lu-conf--humano { color: var(--morado); }

/* ---------- presupuesto ---------- */
.lu-budget { display: grid; gap: 6px; }
.lu-budget__row { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-2); }
.lu-budget__name { font-weight: 700; font-size: 15px; display: inline-flex; gap: 8px; align-items: center; }
.lu-budget__bar { position: relative; height: 12px; background: var(--superficie-2); border-radius: var(--radius-pill); overflow: hidden; }
.lu-budget__fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: var(--radius-pill); background: var(--verde-vivo); transition: width var(--dur-slow) var(--ease-out), background-color var(--dur-base) ease; }
.lu-budget--near .lu-budget__fill { background: var(--naranja); }
.lu-budget--over .lu-budget__fill { background: var(--coral); }
.lu-budget__foot { font-size: 13px; line-height: 18px; color: var(--tinta-2); font-weight: 500; }
.lu-budget--over .lu-budget__foot { color: var(--coral-texto); font-weight: 700; }

/* ---------- categoría ---------- */
.lu-cat { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; line-height: 20px; font-weight: 600; white-space: nowrap; }
.lu-cat__glyph { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: var(--radius-sm); font-family: var(--font-display); font-weight: 800; font-size: 15px; background: var(--c, var(--superficie-2)); color: var(--cf, var(--tinta-fija)); }
.lu-cat--sm .lu-cat__glyph { width: 24px; height: 24px; font-size: 12px; border-radius: 7px; }
.lu-cat--lg .lu-cat__glyph { width: 44px; height: 44px; font-size: 20px; border-radius: 14px; }

/* ---------- chips ---------- */
.lu-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.lu-chip { font: inherit; font-size: 14px; line-height: 18px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px 4px 4px; min-height: 36px; border-radius: var(--radius-pill); border: 2px solid var(--tinta); background: var(--superficie); color: var(--tinta); cursor: pointer; }
.lu-chip[aria-pressed="false"] { border-color: var(--borde); border-style: dashed; color: var(--tinta-2); background: transparent; font-weight: 600; }
.lu-chip[aria-pressed="false"] .lu-avatar { filter: grayscale(1); opacity: .45; }
.lu-chip__x { font-size: 12px; margin-left: 2px; }

/* ---------- persona ---------- */
.lu-avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-family: var(--font-display); font-weight: 800; font-size: 15px; background: var(--c); color: var(--cf); }
.lu-avatar--sm { width: 28px; height: 28px; font-size: 12px; }
.lu-avatar--xs { width: 24px; height: 24px; font-size: 11px; }
.lu-avatar--ghost { background: transparent; color: var(--tinta-2); box-shadow: inset 0 0 0 2px var(--tinta-2); }
.lu-person { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.lu-person__name { font-weight: 700; font-size: 16px; line-height: 22px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lu-person__sub { font-size: 13px; line-height: 18px; color: var(--tinta-2); font-weight: 500; }
.lu-role { font-size: 12px; line-height: 16px; font-weight: 800; padding: 3px 10px; border-radius: var(--radius-pill); background: var(--superficie-2); color: var(--tinta); white-space: nowrap; }
.lu-role--owner { background: var(--tinta); color: var(--fondo); }
.lu-role--admin { background: var(--morado-suave); color: var(--morado); }
.lu-avatars { display: inline-flex; }
.lu-avatars .lu-avatar { box-shadow: 0 0 0 2px var(--superficie); }
.lu-avatars .lu-avatar + .lu-avatar { margin-left: -8px; }

/* ---------- espacio Lottie ---------- */
.lu-lottie { position: relative; display: grid; place-items: center; text-align: center; color: var(--tinta-2); font-size: 10px; line-height: 13px; font-weight: 700; border-radius: 50%; background: var(--superficie-2); box-shadow: inset 0 0 0 2px var(--borde); }
.lu-lottie b { display: block; font-size: 10px; letter-spacing: .1em; color: var(--morado); }
.lu-lottie--square { border-radius: var(--radius-lg); }

/* ---------- código de cuenta ---------- */
.lu-code { display: grid; gap: var(--space-2); }
.lu-code__label { font-size: 12px; font-weight: 700; color: var(--tinta-2); }
.lu-code__input { font-family: var(--font-display); font-variant-numeric: tabular-nums; font-size: 32px; line-height: 40px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--tinta); background: var(--superficie); border: 3px solid var(--tinta); border-radius: var(--radius-md); padding: 10px 16px; width: 100%; max-width: 320px; box-shadow: 0 4px 0 var(--tinta); }
.lu-code__input::placeholder { color: var(--borde); }
.lu-code--ok .lu-code__input { border-color: var(--verde); box-shadow: 0 4px 0 var(--verde); }
.lu-code--error .lu-code__input { border-color: var(--coral); box-shadow: 0 4px 0 var(--coral); }
.lu-code__hint { font-size: 13px; line-height: 18px; font-weight: 600; color: var(--tinta-2); }
.lu-code--ok .lu-code__hint { color: var(--verde); }
.lu-code--error .lu-code__hint { color: var(--coral-texto); }

/* ---------- evidencia ---------- */
.lu-evi { display: grid; gap: var(--space-3); margin: 0; }
.lu-evi__from { display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 18px; }
.lu-evi__from b { font-weight: 800; }
.lu-evi__from span { color: var(--tinta-2); font-size: 13px; }
.lu-evi__photo { position: relative; background: #2a2433; border-radius: var(--radius-lg); overflow: hidden; display: grid; place-items: center; min-height: 300px; }
.lu-evi__photo::after { content: ""; position: absolute; inset: 0; background: radial-gradient(120% 90% at 30% 20%, rgba(255,255,255,.14), transparent 60%); pointer-events: none; }
.lu-evi__receipt { width: 62%; background: #f6f3ee; color: #2a2825; transform: rotate(-3deg); padding: 12px 10px 16px; font-family: ui-monospace, Menlo, monospace; font-size: 8.5px; line-height: 12px; box-shadow: 0 10px 18px rgba(0,0,0,.45); filter: blur(.2px); }
.lu-evi__receipt b { display: block; text-align: center; font-size: 10px; }
.lu-evi__receipt i { font-style: normal; display: flex; justify-content: space-between; gap: 6px; }
.lu-evi__receipt hr { border: 0; border-top: 1px dashed #8a857b; margin: 5px 0; }
.lu-evi__box { position: absolute; z-index: 2; border: 2px solid var(--amarillo); border-radius: 4px; }
.lu-evi__box span { position: absolute; bottom: -18px; right: -2px; background: var(--amarillo); color: var(--tinta-fija); font-family: var(--font-sans); font-size: 10px; line-height: 16px; padding: 0 6px; font-weight: 800; white-space: nowrap; border-radius: 6px; }
.lu-evi__pdf { background: var(--superficie-2); border-radius: var(--radius-lg); padding: var(--space-5); display: grid; gap: var(--space-3); }
.lu-evi__page { background: #fff; color: #2a2825; aspect-ratio: 1 / 1.25; padding: 14px; font-size: 9px; line-height: 13px; border-radius: 6px; box-shadow: 0 8px 18px -8px rgba(28,20,51,.35); display: grid; align-content: start; gap: 6px; }
.lu-evi__page b { font-size: 11px; }
.lu-evi__page .bar { height: 5px; background: #e4dfea; border-radius: 3px; }
.lu-evi__file { display: flex; justify-content: space-between; gap: var(--space-2); font-size: 13px; font-weight: 700; }
.lu-evi__chat { background: var(--superficie-2); border-radius: var(--radius-lg); padding: var(--space-4) var(--space-3); display: grid; gap: var(--space-2); }
.lu-evi__msg { justify-self: start; max-width: 88%; background: var(--superficie); padding: 7px 12px 6px; border-radius: 4px var(--radius-md) var(--radius-md) var(--radius-md); font-size: 15px; line-height: 21px; }
.lu-evi__msg .who { display: block; font-size: 12px; font-weight: 800; color: var(--c, var(--morado)); }
.lu-evi__msg .t { display: block; text-align: right; font-size: 11px; color: var(--tinta-2); }
.lu-evi__msg--dim { opacity: .5; }
.lu-evi__msg--target { box-shadow: 0 0 0 3px var(--amarillo); }

/* ---------- conexión ---------- */
.lu-conn { display: inline-flex; align-items: center; gap: var(--space-3); font-size: 15px; line-height: 20px; font-weight: 700; }
.lu-conn__dot { width: 14px; height: 14px; border-radius: 50%; flex: none; }
.lu-conn--esperando { color: var(--tinta); }
.lu-conn--esperando .lu-conn__dot { background: var(--naranja); box-shadow: 0 0 0 4px var(--naranja-suave); }
.lu-conn--conectado { color: var(--verde); }
.lu-conn--conectado .lu-conn__dot { background: var(--verde-vivo); box-shadow: 0 0 0 4px var(--verde-suave); }
.lu-conn--error { color: var(--coral-texto); }
.lu-conn--error .lu-conn__dot { background: var(--coral); box-shadow: 0 0 0 4px var(--coral-suave); }
.lu-conn__sub { font-weight: 500; font-size: 13px; color: var(--tinta-2); }

/* ---------- AppShell ---------- */
.lu-app { container: app / inline-size; min-height: 100%; display: flex; flex-direction: column; background: var(--fondo); }
.lu-app__bar { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--fondo); position: sticky; top: 0; z-index: 5; }
.lu-logo { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-display); font-weight: 800; font-size: 24px; line-height: 26px; letter-spacing: -.04em; color: var(--tinta); white-space: nowrap; }
.lu-logo__mark { width: 30px; height: 30px; flex: none; }
.lu-logo__mark .a { fill: var(--verde); } .lu-logo__mark .b { fill: var(--amarillo); } .lu-logo__mark .c { fill: var(--morado); }
.lu-app__acct { margin-left: auto; display: flex; align-items: center; gap: 8px; font: inherit; font-size: 14px; font-weight: 700; padding: 4px 12px 4px 4px; border: 0; border-radius: var(--radius-pill); background: var(--superficie-2); color: var(--tinta); max-width: 60%; cursor: pointer; }
.lu-app__acct span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lu-app__acct .lu-cat__glyph { width: 28px; height: 28px; border-radius: 50%; font-size: 12px; }
.lu-app__body { flex: 1; display: flex; min-height: 0; }
.lu-app__main { flex: 1; min-width: 0; }
.lu-app__rail { display: none; }
.lu-tabs { position: sticky; bottom: 0; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; padding: 6px 8px 10px; background: var(--superficie); border-top: 1px solid var(--borde); z-index: 5; }
.lu-tab { font: inherit; background: none; border: 0; color: var(--tinta-2); display: grid; justify-items: center; gap: 2px; padding: 6px 2px; font-size: 11px; line-height: 14px; font-weight: 700; cursor: pointer; position: relative; border-radius: var(--radius-md); }
.lu-tab svg { width: 24px; height: 24px; }
.lu-tab[aria-current="page"] { color: var(--verde); }
.lu-tab[aria-current="page"] svg { background: var(--verde-suave); border-radius: var(--radius-pill); width: 48px; padding: 0 12px; box-sizing: content-box; margin: 0 -12px; }
.lu-tab__count { position: absolute; top: 0; left: calc(50% + 8px); font-family: var(--font-num); font-size: 11px; line-height: 16px; font-weight: 800; min-width: 18px; padding: 0 5px; border-radius: var(--radius-pill); background: var(--naranja); color: var(--tinta-fija); border: 2px solid var(--superficie); }
@container app (min-width: 760px) {
  .lu-app__rail { display: flex; flex-direction: column; gap: 4px; width: 216px; flex: none; padding: var(--space-4) var(--space-3); }
  .lu-app__rail .lu-tab { grid-auto-flow: column; justify-content: start; align-items: center; gap: var(--space-3); font-size: 15px; line-height: 20px; padding: 10px 12px; }
  .lu-app__rail .lu-tab[aria-current="page"] { background: var(--verde-suave); }
  .lu-app__rail .lu-tab[aria-current="page"] svg { background: none; width: 24px; padding: 0; margin: 0; }
  .lu-app__rail .lu-tab__count { position: static; margin-left: auto; }
  .lu-tabs { display: none; }
  .lu-app__bar { padding: var(--space-4) var(--space-6); }
  .lu-app__acct { margin-left: var(--space-8); }
}

@media (prefers-reduced-motion: reduce) {
  .lu-appear, .lu-sticker--pop { animation: none; }
  .lu-roll__col, .lu-budget__fill, .lu-btn, .lu-card--click { transition: none; }
}

```

## Archivo: components/lucas-ui.jsx

```jsx
'use client';
/* Lucas — componentes React (Next.js / Vite). Requiere styles/tokens.css y styles/lucas.css cargados globalmente. */
import React, { useState, useEffect } from 'react';
const cx = (...a) => a.filter(Boolean).join(' ');

/** Pesos colombianos: 84300 → "$84.300" */
export function formatCOP(n, { sign = false } = {}) {
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (v < 0 ? '−' : sign && v > 0 ? '+' : '') + '$' + s;
}
/** "412 lucas" — la forma de decirlo en voz alta (miles de pesos) */
export function lucas(n) {
  const k = Math.abs(Number(n) || 0) / 1000;
  const t = k >= 1000 ? (k / 1000).toFixed(1).replace('.0', '').replace('.', ',') + ' palos' : (Number.isInteger(k) ? k : k.toFixed(1).replace('.', ',')) + ' lucas';
  return t;
}

/* ---------- tonos: personas y categorías ---------- */
export const TONES = ['morado', 'naranja', 'azul', 'coral', 'verde', 'amarillo', 'turquesa', 'rosa'];
const toneVars = t => ({ '--c': `var(--tono-${t})`, '--cf': 'var(--tinta-fija)' });
const TONE_MAP = {};
/** Fija el tono de cada persona de una cuenta: setTones({ Valeria: 'morado', ... }) */
export function setTones(map) { Object.assign(TONE_MAP, map); }
export function toneFor(name) {
  if (TONE_MAP[name]) return TONE_MAP[name];
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}
export const CATEGORIES = {
  'Café': ['C', 'naranja'], 'Licor': ['L', 'morado'], 'Mercado': ['M', 'verde'], 'Transporte': ['T', 'azul'],
  'Hospedaje': ['H', 'turquesa'], 'Restaurante': ['R', 'coral'], 'Servicios': ['S', 'amarillo'], 'Otros': ['O', 'rosa'],
};

/* ---------- Divider ---------- */
export function Divider({ variant = 'line', label, className }) {
  if (label) return <div role="separator" className={cx('lu-divider lu-divider--label lu-label', className)}>{label}</div>;
  return <hr className={cx('lu-divider', variant === 'wave' && 'lu-divider--wave', className)} />;
}

/* ---------- Amount ---------- */
function Rolling({ text }) {
  return (
    <span aria-hidden="true">
      {text.split('').map((ch, i) => /\d/.test(ch) ? (
        <span className="lu-roll" key={i}>
          <span className="lu-roll__col" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
            {'0123456789'.split('').map(d => <span key={d}>{d}</span>)}
          </span>
        </span>
      ) : <span key={i}>{ch}</span>)}
    </span>
  );
}
export function Amount({ value, size = 'md', highlight = false, roll = false, tone, sign = false, className }) {
  const text = formatCOP(value, { sign });
  return (
    <span className={cx('lu-amount', 'lu-amount--' + size, tone && 'lu-amount--' + tone, highlight && 'lu-amount--hl', className)} aria-label={roll ? text : undefined}>
      {roll ? <Rolling text={text} /> : text}
    </span>
  );
}

/* ---------- BillCard (hero) ---------- */
export function BillCard({ label, amount, denom = 'LUCAS', tone = 'verde', roll = false, highlight = true, children, aside }) {
  return (
    <section className={cx('lu-bill', tone === 'morado' && 'lu-bill--morado')}>
      <div className="lu-bill__top">
        <span className="lu-bill__label">{label}</span>
        {aside || <span className="lu-bill__denom">{denom}</span>}
      </div>
      <span className="lu-bill__amount"><Amount value={amount} size="xl" roll={roll} highlight={highlight} /></span>
      {children && <div className="lu-bill__foot">{children}</div>}
    </section>
  );
}

/* ---------- Sticker ---------- */
const STICKER_TEXT = { pagado: 'Pagado', confirmado: 'Listo', revisar: 'Revisar', pendiente: 'Pendiente', alerta: 'Ojo', cerrado: 'Saldado' };
export function Sticker({ tone = 'pagado', children, sub, size = 'md', rotate = -4, animate = false, className }) {
  return (
    <span role="img" aria-label={(children || STICKER_TEXT[tone]) + (sub ? ', ' + sub : '')}
      className={cx('lu-sticker', 'lu-sticker--' + tone, size !== 'md' && 'lu-sticker--' + size, animate && 'lu-sticker--pop', className)}
      style={{ '--rot': rotate + 'deg' }}>
      {children || STICKER_TEXT[tone]}
      {sub ? <span className="lu-sticker__sub">{sub}</span> : null}
    </span>
  );
}

/* ---------- CategoryTag ---------- */
export function CategoryTag({ name, showName = true, size = 'md' }) {
  const [g, t] = CATEGORIES[name] || [String(name)[0], 'rosa'];
  return (
    <span className={cx('lu-cat', size !== 'md' && 'lu-cat--' + size)}>
      <span className="lu-cat__glyph" style={toneVars(t)} aria-hidden={showName}>{g}</span>
      {showName && name}
    </span>
  );
}

/* ---------- ExpenseCard ---------- */
export function ExpenseCard({ merchant, category, meta, total, each, sticker, appear = false, onClick, children, flat = false, className, style }) {
  return (
    <article className={cx('lu-card', flat && 'lu-card--flat', onClick && 'lu-card--click', appear && 'lu-appear', className)} style={style}
      onClick={onClick} tabIndex={onClick ? 0 : undefined}>
      <div className="lu-expense">
        {category && <span className="lu-expense__cat"><CategoryTag name={category} showName={false} size="lg" /></span>}
        <span className="lu-expense__m">{merchant}</span>
        {total != null && <span className="lu-expense__amt"><Amount value={total} size="lg" /></span>}
        {meta && <span className="lu-expense__meta">{meta}</span>}
        {each && <span className="lu-expense__each">{each}</span>}
      </div>
      {children && <div className="lu-expense__body">{children}</div>}
      {sticker && <div className="lu-card__sticker">{sticker}</div>}
    </article>
  );
}
export function Row({ label, value, amount, muted = false, total = false }) {
  return (
    <div className={cx('lu-row', muted && 'lu-row--muted', total && 'lu-row--total')}>
      <span className="lu-row__label">{label}</span>
      {amount != null ? <Amount value={amount} size={total ? 'lg' : 'md'} /> : <span className="lu-num" style={{ fontWeight: 600 }}>{value}</span>}
    </div>
  );
}

/* ---------- Avatar / Person ---------- */
const initials = n => n.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
export function Avatar({ name, tone, size = 'md', registered = true }) {
  return (
    <span className={cx('lu-avatar', size !== 'md' && 'lu-avatar--' + size, !registered && 'lu-avatar--ghost')}
      style={registered ? toneVars(tone || toneFor(name)) : undefined} aria-hidden="true">{initials(name)}</span>
  );
}
export function Person({ name, sub, tone, registered = true, role, size = 'md', aside }) {
  return (
    <div className="lu-person">
      <Avatar name={name} tone={tone} size={size} registered={registered} />
      <span style={{ minWidth: 0, display: 'grid' }}>
        <span className="lu-person__name">{name}</span>
        {(sub || !registered) && <span className="lu-person__sub">{sub || 'Sin cuenta · solo en WhatsApp'}</span>}
      </span>
      {role && <span className={cx('lu-role', 'lu-role--' + role)} style={{ marginLeft: 'auto' }}>{{ owner: 'Dueña', admin: 'Admin', member: 'Miembro' }[role]}</span>}
      {aside}
    </div>
  );
}

/* ---------- Correction ---------- */
export function Correction({ was, children, by, tone }) {
  return (
    <span className="lu-fix">
      {was != null && <span className="lu-fix__was">{was}</span>}
      <span className="lu-fix__now">{children}</span>
      {by && <span className="lu-fix__by"><Avatar name={by} tone={tone} size="xs" />corrigió {by}</span>}
    </span>
  );
}

/* ---------- Button ---------- */
export function Button({ variant = 'primary', size = 'md', kbd, children, className, ...rest }) {
  return (
    <button type="button" {...rest} className={cx('lu-btn', 'lu-btn--' + variant, size === 'sm' && 'lu-btn--sm', className)}>
      {children}{kbd && <span className="lu-btn__kbd" aria-hidden="true">{kbd}</span>}
    </button>
  );
}

/* ---------- Confidence ---------- */
export function Confidence({ value, corrected = false }) {
  if (corrected) return <span className="lu-conf lu-conf--humano">Corregido a mano</span>;
  const lvl = value >= 0.9 ? 'alta' : value >= 0.75 ? 'media' : 'baja';
  return (
    <span className={cx('lu-conf', 'lu-conf--' + lvl)} title={'Confianza de lectura: ' + Math.round(value * 100) + ' %'}>
      <span className="lu-conf__dots" aria-hidden="true"><i /><i /><i /></span>
      {{ alta: 'Seguro', media: 'Casi seguro', baja: 'Revísalo' }[lvl]} · {Math.round(value * 100)} %
    </span>
  );
}

/* ---------- Field ---------- */
export function Field({ label, value, onChange, confidence, original, corrected, correctedBy, num = false, inputMode, id, children }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => { setV(value ?? ''); }, [value]);
  const isFixed = corrected ?? (original != null && String(v) !== String(original));
  const low = !isFixed && confidence != null && confidence < 0.75;
  const fid = id || 'f-' + String(label).toLowerCase().normalize('NFD').replace(/[^a-z]+/g, '-');
  return (
    <div className={cx('lu-field', num && 'lu-field--num', low && 'lu-field--low', isFixed && 'lu-field--fixed')}>
      <div className="lu-field__top">
        <label className="lu-label" htmlFor={fid}>{label}</label>
        {confidence != null && <Confidence value={confidence} corrected={isFixed} />}
      </div>
      {children || <input id={fid} value={v} inputMode={inputMode} onChange={e => { setV(e.target.value); onChange && onChange(e.target.value); }} />}
      {isFixed && original != null && (
        <span className="lu-fix"><span className="lu-fix__was">{original}</span>
          <span className="lu-fix__by">{correctedBy ? <><Avatar name={correctedBy} size="xs" />corrigió {correctedBy}</> : 'Tu corrección'}</span></span>
      )}
    </div>
  );
}

/* ---------- Chip ---------- */
export function Chip({ pressed = true, onToggle, name, tone, children }) {
  return (
    <button type="button" className="lu-chip" aria-pressed={pressed} onClick={onToggle}>
      {name && <Avatar name={name} tone={tone} size="sm" />}{children || name}
    </button>
  );
}

/* ---------- BudgetBar ---------- */
export function BudgetBar({ name, spent, budget, category }) {
  const pct = budget > 0 ? spent / budget : 0;
  const state = pct > 1 ? 'over' : pct >= 0.85 ? 'near' : null;
  return (
    <div className={cx('lu-budget', state && 'lu-budget--' + state)}>
      <div className="lu-budget__row">
        <span className="lu-budget__name">{category !== false && <CategoryTag name={name} showName={false} size="sm" />}{name}</span>
        <span className="lu-amount lu-amount--sm">{formatCOP(spent)} <span className="lu-muted">/ {formatCOP(budget)}</span></span>
      </div>
      <div className="lu-budget__bar" role="meter" aria-valuemin={0} aria-valuemax={budget} aria-valuenow={spent} aria-label={name}>
        <div className="lu-budget__fill" style={{ width: Math.min(pct, 1) * 100 + '%' }} />
      </div>
      <div className="lu-budget__foot">{pct > 1 ? 'Te pasaste ' + formatCOP(spent - budget) : 'Quedan ' + formatCOP(budget - spent) + ' · ' + Math.round(pct * 100) + ' %'}</div>
    </div>
  );
}

/* ---------- LottieSlot ---------- */
export function LottieSlot({ name, width = 120, height = 120, label, src, square = false }) {
  return (
    <div className={cx('lu-lottie', square && 'lu-lottie--square')} role="img" aria-label={label || name} data-lottie={src || name + '.json'} style={{ width, height }}>
      {width < 56 ? <b>L</b> : <span><b>LOTTIE</b>{name}<br />{width}×{height}</span>}
    </div>
  );
}

/* ---------- CodeInput ---------- */
export const CODE_RE = /^[A-Z]{3,8}-[A-Z0-9]{4}$/;
export function formatCode(raw) {
  const s = String(raw).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const [a = '', b] = s.split('-');
  if (b != null) return a.slice(0, 8) + '-' + b.replace(/-/g, '').slice(0, 4);
  return a.slice(0, 13);
}
export function CodeInput({ value = '', onChange, label = 'Código de la cuenta', hint, error, readOnly = false, id = 'codigo' }) {
  const [v, setV] = useState(value);
  const ok = CODE_RE.test(v) && !error;
  const err = !!error;
  return (
    <div className={cx('lu-code', ok && 'lu-code--ok', err && 'lu-code--error')}>
      <label className="lu-code__label" htmlFor={id}>{label}</label>
      <input id={id} className="lu-code__input" value={v} readOnly={readOnly} placeholder="PASEO-7K2Q" autoCapitalize="characters" autoComplete="off" spellCheck={false}
        onChange={e => { const n = formatCode(e.target.value); setV(n); onChange && onChange(n); }} />
      <span className="lu-code__hint" aria-live="polite">{err ? error : ok ? (hint || 'Código completo') : 'Una palabra, un guion y 4 letras o números'}</span>
    </div>
  );
}

/* ---------- Evidence ---------- */
export function Evidence({ kind = 'foto', sender, time, group, file, pages, receipt, messages, box }) {
  return (
    <figure className="lu-evi">
      <figcaption className="lu-evi__from">
        <Avatar name={sender} size="sm" />
        <span style={{ display: 'grid' }}><b>{sender}</b>
          <span>{kind === 'foto' ? 'mandó una foto' : kind === 'pdf' ? 'mandó un PDF' : 'escribió'} · {time}{group ? ' · ' + group : ''}</span></span>
      </figcaption>
      {kind === 'foto' && (
        <div className="lu-evi__photo">
          <div className="lu-evi__receipt">
            <b>{receipt?.title}</b>
            <div style={{ textAlign: 'center', opacity: .8 }}>{receipt?.sub}</div>
            <hr />
            {(receipt?.lines || []).map((l, i) => <i key={i}><span>{l[0]}</span><span>{l[1]}</span></i>)}
            <hr />
            <i style={{ fontWeight: 700, fontSize: 10, position: 'relative' }}>
              <span>TOTAL</span><span>{receipt?.total}</span>
              {box && <span className="lu-evi__box" style={{ inset: '-3px -4px' }}><span>{box}</span></span>}
            </i>
            <div style={{ textAlign: 'center', marginTop: 10, opacity: .7 }}>{receipt?.foot}</div>
          </div>
        </div>
      )}
      {kind === 'pdf' && (
        <div className="lu-evi__pdf">
          <div className="lu-evi__page">
            <b>{receipt?.title}</b><span>{receipt?.sub}</span>
            <div className="bar" style={{ width: '70%' }} /><div className="bar" style={{ width: '90%' }} /><div className="bar" style={{ width: '55%' }} />
            {(receipt?.lines || []).map((l, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}><span>{l[0]}</span><span>{l[1]}</span></div>)}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, position: 'relative', marginTop: 4 }}>
              <span>Total a pagar</span><span>{receipt?.total}</span>
              {box && <span className="lu-evi__box" style={{ inset: '-3px -4px' }}><span>{box}</span></span>}
            </div>
          </div>
          <div className="lu-evi__file"><span>{file}</span><span className="lu-muted">{pages} pág.</span></div>
        </div>
      )}
      {kind === 'mensaje' && (
        <div className="lu-evi__chat">
          {(messages || []).map((m, i) => (
            <div key={i} className={cx('lu-evi__msg', m.dim && 'lu-evi__msg--dim', m.target && 'lu-evi__msg--target')} style={{ '--c': `var(--${m.whoColor || 'morado'})` }}>
              <span className="who">{m.who}</span>{m.text}<span className="t">{m.time}</span>
            </div>
          ))}
        </div>
      )}
    </figure>
  );
}

/* ---------- ConnectionStatus ---------- */
export function ConnectionStatus({ state = 'esperando', children, sub }) {
  const txt = { esperando: 'Esperando el código en el grupo', conectado: 'Conectado', error: 'No pudimos conectar' }[state];
  return (
    <span className={cx('lu-conn', 'lu-conn--' + state)} role="status" aria-live="polite">
      <span className="lu-conn__dot" aria-hidden="true" />
      <span style={{ display: 'grid' }}>{children || txt}{sub && <span className="lu-conn__sub">{sub}</span>}</span>
    </span>
  );
}

/* ---------- Logo ---------- */
export function Logo({ size = 24 }) {
  return (
    <span className="lu-logo" style={{ fontSize: size, lineHeight: size + 2 + 'px' }}>
      <svg className="lu-logo__mark" viewBox="0 0 32 32" aria-hidden="true" style={{ width: size * 1.25, height: size * 1.25 }}>
        <rect className="c" x="3" y="7" width="22" height="15" rx="4" transform="rotate(-14 14 14.5)" />
        <rect className="a" x="7" y="10" width="22" height="15" rx="4" transform="rotate(6 18 17.5)" />
        <circle className="b" cx="18" cy="17.5" r="4.2" />
      </svg>
      lucas
    </span>
  );
}

/* ---------- íconos de navegación (trazo, 24px) ---------- */
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
export const ICONS = {
  resumen: <svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M5 20V11M12 20V5M19 20v-6" /></svg>,
  revisar: <svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M4 13l2.5-7h11L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path {...P} d="M4 13h4.5l1 2h5l1-2H20" /></svg>,
  gastos: <svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.5" fill="currentColor" /><circle cx="4.5" cy="12" r="1.5" fill="currentColor" /><circle cx="4.5" cy="18" r="1.5" fill="currentColor" /></svg>,
  liquidar: <svg viewBox="0 0 24 24" aria-hidden="true"><path {...P} d="M4 8h14l-3-3M20 16H6l3 3" /></svg>,
  personas: <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...P} cx="9" cy="8" r="3.5" /><path {...P} d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path {...P} d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.4 3.5 5.2" /></svg>,
  presupuestos: <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...P} cx="12" cy="12" r="8.5" /><path {...P} d="M12 3.5V12l6 6" /></svg>,
};

/* ---------- AppShell ---------- */
export function AppShell({ account, accountTone = 'verde', accountGlyph = 'L', tabs = [], active, onTab, children, onAccount }) {
  const tabEls = tabs.map(t => (
    <button key={t.id} className="lu-tab" aria-current={t.id === active ? 'page' : undefined} onClick={() => onTab && onTab(t.id)}>
      {ICONS[t.icon || t.id]}
      <span>{t.label}</span>
      {t.count ? <span className="lu-tab__count">{t.count}</span> : null}
    </button>
  ));
  return (
    <div className="lu-app">
      <header className="lu-app__bar">
        <Logo />
        {account && <button className="lu-app__acct" onClick={onAccount}>
          <span className="lu-cat__glyph" style={toneVars(accountTone)} aria-hidden="true">{accountGlyph}</span>
          <span>{account}</span><span aria-hidden="true">▾</span></button>}
      </header>
      <div className="lu-app__body">
        {tabs.length > 0 && <nav className="lu-app__rail" aria-label="Secciones">{tabEls}</nav>}
        <main className="lu-app__main">{children}</main>
      </div>
      {tabs.length > 0 && <nav className="lu-tabs" aria-label="Secciones">{tabEls}</nav>}
    </div>
  );
}

```

## Archivo: components/lucas-ui.d.ts

```ts
import type * as React from 'react';
export type Tone = 'morado' | 'naranja' | 'azul' | 'coral' | 'verde' | 'amarillo' | 'turquesa' | 'rosa';
export declare function formatCOP(n: number, opts?: { sign?: boolean }): string;
export declare function lucas(n: number): string;
export declare function setTones(map: Record<string, Tone>): void;
export declare function toneFor(name: string): Tone;
export interface BillCardProps { label: React.ReactNode; amount: number; tone?: 'verde' | 'morado'; denom?: string; aside?: React.ReactNode; roll?: boolean; highlight?: boolean; children?: React.ReactNode }
export declare function BillCard(props: BillCardProps): React.ReactElement;
export interface ExpenseCardProps { merchant: React.ReactNode; category?: string; meta?: React.ReactNode; total?: number; each?: React.ReactNode; sticker?: React.ReactNode; appear?: boolean; onClick?: () => void; flat?: boolean; className?: string; style?: React.CSSProperties; children?: React.ReactNode }
export declare function ExpenseCard(props: ExpenseCardProps): React.ReactElement;
export interface RowProps { label: React.ReactNode; amount?: number; value?: React.ReactNode; muted?: boolean; total?: boolean }
export declare function Row(props: RowProps): React.ReactElement;
export interface StickerProps { tone?: 'pagado' | 'confirmado' | 'revisar' | 'pendiente' | 'alerta' | 'cerrado'; children?: React.ReactNode; sub?: string; size?: 'sm' | 'md' | 'lg'; rotate?: number; animate?: boolean; className?: string }
export declare function Sticker(props: StickerProps): React.ReactElement;
export interface AmountProps { value: number; size?: 'sm' | 'md' | 'lg' | 'xl'; highlight?: boolean; roll?: boolean; tone?: 'pos' | 'neg'; sign?: boolean; className?: string }
export declare function Amount(props: AmountProps): React.ReactElement;
export interface DividerProps { variant?: 'line' | 'wave'; label?: React.ReactNode; className?: string }
export declare function Divider(props: DividerProps): React.ReactElement;
export interface CorrectionProps { was?: React.ReactNode; by?: string; tone?: Tone; children: React.ReactNode }
export declare function Correction(props: CorrectionProps): React.ReactElement;
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'outline' | 'ghost'; size?: 'md' | 'sm'; kbd?: string }
export declare function Button(props: ButtonProps): React.ReactElement;
export interface FieldProps { label: string; value?: string; onChange?: (v: string) => void; confidence?: number; original?: string; corrected?: boolean; correctedBy?: string; num?: boolean; inputMode?: string; id?: string; children?: React.ReactNode }
export declare function Field(props: FieldProps): React.ReactElement;
export interface ConfidenceProps { value: number; corrected?: boolean }
export declare function Confidence(props: ConfidenceProps): React.ReactElement;
export interface ChipProps { name?: string; tone?: Tone; pressed?: boolean; onToggle?: () => void; children?: React.ReactNode }
export declare function Chip(props: ChipProps): React.ReactElement;
export interface BudgetBarProps { name: string; spent: number; budget: number; category?: boolean }
export declare function BudgetBar(props: BudgetBarProps): React.ReactElement;
export interface CategoryTagProps { name: string; showName?: boolean; size?: 'sm' | 'md' | 'lg' }
export declare function CategoryTag(props: CategoryTagProps): React.ReactElement;
export interface AvatarProps { name: string; tone?: Tone; size?: 'xs' | 'sm' | 'md'; registered?: boolean }
export declare function Avatar(props: AvatarProps): React.ReactElement;
export interface PersonProps { name: string; sub?: React.ReactNode; tone?: Tone; registered?: boolean; role?: 'owner' | 'admin' | 'member'; size?: 'xs' | 'sm' | 'md'; aside?: React.ReactNode }
export declare function Person(props: PersonProps): React.ReactElement;
export interface EvidenceProps { kind?: 'foto' | 'pdf' | 'mensaje'; sender: string; time: string; group?: string; file?: string; pages?: number; receipt?: { title: string; sub?: string; lines?: [string, string][]; total: string; foot?: string }; messages?: { who: string; whoColor?: string; text: string; time: string; dim?: boolean; target?: boolean }[]; box?: string }
export declare function Evidence(props: EvidenceProps): React.ReactElement;
export interface CodeInputProps { value?: string; onChange?: (v: string) => void; label?: string; hint?: string; error?: string | null; readOnly?: boolean; id?: string }
export declare function CodeInput(props: CodeInputProps): React.ReactElement;
export interface ConnectionStatusProps { state?: 'esperando' | 'conectado' | 'error'; children?: React.ReactNode; sub?: React.ReactNode }
export declare function ConnectionStatus(props: ConnectionStatusProps): React.ReactElement;
export interface LottieSlotProps { name: string; width?: number; height?: number; square?: boolean; label?: string; src?: string }
export declare function LottieSlot(props: LottieSlotProps): React.ReactElement;
export interface LogoProps { size?: number }
export declare function Logo(props: LogoProps): React.ReactElement;
export interface AppShellProps { account?: string; accountTone?: Tone; accountGlyph?: string; tabs?: { id: string; label: string; count?: number; icon?: string }[]; active?: string; onTab?: (id: string) => void; onAccount?: () => void; children?: React.ReactNode }
export declare function AppShell(props: AppShellProps): React.ReactElement;

```
