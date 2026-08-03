/**
 * Prueba de humo del cerebro portado a TypeScript.
 *
 * Llama a Vertex de verdad, le manda una imagen y espera que hable. No usa
 * Electron: `SesionLive` sólo depende de `ws` y de gcloud, así que corre con
 * tsx directamente.
 *
 *     pnpm --filter @qh/desktop exec tsx scripts/probar-sesion.ts
 */

import { SesionLive } from '../electron/main/live/sesion.js';

const OPCIONES = {
  proyecto: process.env['GCP_PROJECT_ID'] ?? 'bubbly-stone-502214-u7',
  region: process.env['GCP_REGION'] ?? 'us-east4',
  modelo: process.env['GEMINI_LIVE_MODEL'] ?? 'gemini-live-2.5-flash-native-audio',
};

/** Un PNG chico y reconocible: un rectángulo rojo sobre fondo negro. */
function imagenDePrueba(): Buffer {
  const ancho = 320;
  const alto = 180;
  const jpegMinimo: number[] = [];
  // Se arma un JPEG a mano sería una locura; se usa un PNG crudo vía canvas
  // no existe en Node. En su lugar se manda un JPEG base64 fijo: un cuadrado
  // rojo. Alcanza para comprobar que la visión llega y se interpreta.
  void ancho;
  void alto;
  void jpegMinimo;
  return Buffer.from(JPEG_CUADRADO_ROJO, 'base64');
}

// JPEG 8x8 rojo puro. Chico a propósito: lo que se prueba es que el canal de
// visión funciona, no la agudeza del modelo.
const JPEG_CUADRADO_ROJO =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIA' +
  'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
  'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
  'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
  'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA' +
  'AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx' +
  'BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK' +
  'U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3' +
  'uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii' +
  'gD//2Q==';

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log(`${OPCIONES.proyecto} · ${OPCIONES.region} · ${OPCIONES.modelo}\n`);

  const sesion = new SesionLive(OPCIONES);
  let dicho = '';
  let bytesDeAudio = 0;

  sesion.on('estado', (e: string) => console.log(`  [estado] ${e}`));
  sesion.on('texto', (f: string) => {
    dicho += f;
  });
  sesion.on('audio', (pcm: Buffer) => {
    bytesDeAudio += pcm.length;
  });
  sesion.on('error', (d: string) => console.error(`  [error] ${d}`));

  const listo = new Promise<void>((r) => sesion.once('lista', r));
  await sesion.conectar({ observando: true, ventana: 'Prueba' });
  await Promise.race([listo, esperar(30_000)]);

  if (!sesion.lista) {
    console.error('\nNo llegó a abrir la sesión.');
    process.exit(1);
  }

  const preguntas = [
    'Hola. Decime en una sola frase quién sos.',
    'Te acabo de mandar una imagen. ¿De qué color es?',
  ];

  for (const pregunta of preguntas) {
    dicho = '';
    bytesDeAudio = 0;
    console.log(`\n  yo> ${pregunta}`);

    if (pregunta.includes('imagen')) sesion.enviarCuadro(imagenDePrueba());
    sesion.enviarTexto(pregunta);

    const fin = new Promise<void>((r) => sesion.once('turno-fin', r));
    await Promise.race([fin, esperar(45_000)]);

    console.log(`  copiloto> ${dicho.trim() || '(nada)'}`);
    console.log(`  [audio: ${(bytesDeAudio / 1024).toFixed(0)} KB de PCM a 24 kHz]`);
  }

  sesion.cerrar();

  const ok = dicho.trim().length > 0 && bytesDeAudio > 0;
  console.log(`\n${ok ? 'Habla y suena.' : 'FALLÓ: no hubo texto o no hubo audio.'}`);
  process.exit(ok ? 0 : 1);
}

void main();
