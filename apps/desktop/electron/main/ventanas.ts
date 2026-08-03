/**
 * La ventana del orbe.
 *
 * Una sola: colapsada es el orbe, expandida muestra el chat abajo. Dos
 * ventanas separadas obligarían a sincronizar estado entre ellas para que la
 * conversación se vea igual en las dos, y no hay ninguna razón para pagar eso.
 *
 * Postura de seguridad, sin excepciones: sin `nodeIntegration`, con
 * `contextIsolation`. `sandbox` queda apagado a propósito y está explicado
 * abajo.
 */

import { BrowserWindow, screen, shell } from 'electron';
import { join } from 'node:path';

const PRECARGA = join(__dirname, '../preload/index.js');

export const ORBE_COLAPSADO = { width: 132, height: 132 };
export const ORBE_EXPANDIDO = { width: 384, height: 560 };
const MARGEN = 24;

function urlDe(nombre: string): { url?: string; archivo?: string } {
  const dev = process.env['ELECTRON_RENDERER_URL'];
  if (dev) return { url: `${dev}/${nombre}.html` };
  return { archivo: join(__dirname, `../renderer/${nombre}.html`) };
}

export function crearOrbe(): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea;

  const ventana = new BrowserWindow({
    ...ORBE_COLAPSADO,
    x: area.x + area.width - ORBE_COLAPSADO.width - MARGEN,
    y: area.y + area.height - ORBE_COLAPSADO.height - MARGEN,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: PRECARGA,
      nodeIntegration: false,
      contextIsolation: true,
      // El micrófono no funciona con `sandbox: true`: el renderer sandboxeado
      // no puede pedir `getUserMedia`. Se compensa con contextIsolation, un
      // preload de superficie mínima y CSP en el documento.
      sandbox: false,
      webSecurity: true,
    },
  });

  // `screen-saver` lo mantiene encima incluso de aplicaciones en pantalla
  // completa, que es el caso de uso: el usuario está trabajando y el orbe mira.
  ventana.setAlwaysOnTop(true, 'screen-saver');
  ventana.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const destino = urlDe('orbe');
  if (destino.url) void ventana.loadURL(destino.url);
  else if (destino.archivo) void ventana.loadFile(destino.archivo);

  ventana.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  ventana.webContents.on('will-navigate', (evento) => evento.preventDefault());

  // Sin esto, un renderer que explota en una ventana transparente y sin marco
  // es indistinguible de uno que todavía no arrancó: queda un rectángulo vacío
  // y nada más.
  ventana.webContents.on('console-message', (_e, nivel, mensaje, linea, origen) => {
    const etiqueta = ['log', 'warn', 'error'][nivel] ?? 'log';
    process.stdout.write(`[orbe:${etiqueta}] ${mensaje} (${origen}:${linea})\n`);
  });
  ventana.webContents.on('preload-error', (_e, ruta, error) => {
    process.stdout.write(`[orbe:preload-error] ${ruta}: ${error.message}\n`);
  });

  ventana.once('ready-to-show', () => ventana.show());
  return ventana;
}

/**
 * Crece hacia arriba y hacia la izquierda: el orbe queda clavado en su esquina
 * y el chat aparece desde ahí. Si creciera hacia abajo se metería debajo de la
 * barra de tareas.
 */
export function expandirOrbe(ventana: BrowserWindow, expandido: boolean): void {
  if (ventana.isDestroyed()) return;

  const area = screen.getPrimaryDisplay().workArea;
  const tamano = expandido ? ORBE_EXPANDIDO : ORBE_COLAPSADO;

  ventana.setBounds({
    width: tamano.width,
    height: tamano.height,
    x: area.x + area.width - tamano.width - MARGEN,
    y: area.y + area.height - tamano.height - MARGEN,
  });
}
