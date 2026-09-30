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
