# Mi comida — fase 1

App web instalable (PWA) para Android. Gratis, sin servidor: los datos se guardan en tu móvil.

## Publicarla gratis (GitHub Pages)
1. Crea una cuenta en github.com y un repositorio **público** nuevo, por ejemplo `mi-comida`.
2. Sube todos los archivos de esta carpeta (botón «Add file» > «Upload files»).
3. En el repositorio: Settings > Pages > Source: «Deploy from a branch», rama `main`, carpeta `/ (root)`.
4. En 1-2 minutos tendrás una dirección como `https://TU-USUARIO.github.io/mi-comida/`.
5. Ábrela en Chrome del móvil > menú ⋮ > «Instalar aplicación» (o «Añadir a pantalla de inicio»).

El repositorio público solo contiene el código, nunca tus datos ni tu clave.

## Estimar con IA (opcional, gratis)
1. Ve a aistudio.google.com, entra con tu cuenta de Google y crea una clave de API de Gemini.
2. En la app: Ajustes > pega la clave > Guardar ajustes.
3. Si el modelo `gemini-2.5-flash` deja de existir, cambia su nombre en el mismo apartado.

Sin clave, la app funciona igual: rellenas las calorías y macros a mano.

## Cómo calcula
- Presupuesto semanal = calorías base × 7, más o menos 350 kcal por cada sesión de gimnasio que cambies respecto a tu rutina (lunes a jueves).
- Cada día, el objetivo se recalcula: (presupuesto − lo consumido en días anteriores) ÷ días que quedan.
- Un día pasado sin ningún registro cuenta como si hubieras comido tu objetivo, para no regalarte margen.
- El mínimo diario (1.500 kcal por defecto) evita objetivos demasiado bajos tras un exceso grande.

## Copia de seguridad
Ajustes > Descargar copia. Si borras los datos del navegador, se pierden.
