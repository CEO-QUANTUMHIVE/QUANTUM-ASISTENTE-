import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(__dirname, 'electron/main/index.ts') },
    },
  },
  preload: {
    // El preload se empaqueta completo. En el sandbox solo se deja Electron
    // como dependencia externa.
    build: {
      lib: { entry: resolve(__dirname, 'electron/preload/index.ts') },
      rollupOptions: { external: ['electron'] },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          orbe: resolve(__dirname, 'src/orbe.html'),
        },
      },
    },
  },
});
