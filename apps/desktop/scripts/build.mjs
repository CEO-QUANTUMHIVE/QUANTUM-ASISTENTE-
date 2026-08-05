/**
 * Compilación de producción sin cargar el archivo de configuración mediante
 * esbuild. En entornos restringidos, el cargador de configuración de Vite
 * recorre directorios padre de Windows y puede chocar con carpetas protegidas.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { externalizeDepsPlugin } from 'electron-vite';
import { build } from 'vite';

const raiz = resolve(fileURLToPath(new URL('..', import.meta.url)));
const salida = resolve(raiz, 'out');

async function compilarNode(nombre, entrada, plugins, externos = undefined) {
  await build({
    configFile: false,
    root: raiz,
    plugins,
    build: {
      ssr: resolve(raiz, entrada),
      outDir: resolve(salida, nombre),
      emptyOutDir: true,
      target: 'node20',
      minify: false,
      sourcemap: false,
      rollupOptions: {
        external: externos,
        output: {
          format: 'cjs',
          entryFileNames: 'index.js',
        },
      },
    },
  });
}

await compilarNode('main', 'electron/main/index.ts', [externalizeDepsPlugin()]);
await compilarNode('preload', 'electron/preload/index.ts', [], ['electron']);

await build({
  configFile: false,
  root: resolve(raiz, 'src'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(salida, 'renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        orbe: resolve(raiz, 'src/orbe.html'),
      },
    },
  },
});
