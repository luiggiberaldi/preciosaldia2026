// postcss.config.js
//
// ISSUES cubiertos:
// - INFRA-027: postcss-import añadido al array de plugins. Antes estaba
//   instalado como dependencia (devDependencies en package.json) pero no
//   registrado aquí, por lo que cualquier `@import` en CSS no se resolvía.
// - Escala de interfaz: viewportZoom compensa vh/vw bajo `zoom` (ver el plugin).
//   Va después de Tailwind (reescribe también sus clases arbitrarias).

import postcssImport from 'postcss-import';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import viewportZoom from './postcss-viewport-zoom.js';

export default {
  plugins: [
    postcssImport(),   // INFRA-027: resolver @import en CSS antes de Tailwind.
    tailwindcss(),
    viewportZoom(),
    autoprefixer(),
  ],
}
