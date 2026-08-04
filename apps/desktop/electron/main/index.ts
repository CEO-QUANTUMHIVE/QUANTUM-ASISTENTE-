/**
 * Proceso principal — Fase 1: el orbe que ve y habla.
 *
 * Una ventana, una sesión con Vertex, y nada más en el medio. Sin servidor
 * local, sin puerto, sin proceso hijo: el modelo con visión y voz ES el
 * producto, y lo único que hay que construir es mostrarle la pantalla,
 * escucharlo y dejarlo hablar.
 *
 * Lo que quedó guardado en el repo y fuera del camino: el Tool Router, el
 * overlay de anotaciones, el seguimiento de ventana y el núcleo Python. Vuelven
 * cuando el copiloto pueda ejecutar algo con consecuencias.
 */

import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Tray } from 'electron';
import { CANALES, NOMBRE_VOZ, VOCES_DISPONIBLES, type EstadoOrbe, type VozDisponible } from '../canales.js';
import { ScreenCapturer, listSources } from './capture.js';
import { ejecutarHerramientas } from './herramientas.js';
import type { LlamadaHerramienta } from './herramientas-definicion.js';
import { ControlInactividad } from './inactividad.js';
import { SesionLive } from './live/sesion.js';
import { NavegadorQuantum } from './navegador.js';
import { SesionTexto } from './sesion-texto.js';
import { crearOrbe, expandirOrbe } from './ventanas.js';

app.setName('Quantum Assistant');

const ATAJO_FRENO = 'Control+Shift+F12';

/**
 * El saludo del modo voz, para el mic-on y para probar una voz. Con nombre
 * propio e indicaciones de calidez, pausas y pronunciación: sin esto el
 * modelo de audio nativo lee "Quantum" como se escribe en español y suena mal.
 */
function saludoVoz(voz: VozDisponible): string {
  const nombre = NOMBRE_VOZ[voz];
  return (
    'Saludá una sola vez, con calidez y una sonrisa en la voz, hablando despacio y bien claro. ' +
    'Pronunciá "Quantum" como se dice en inglés — "Kuantum" — nunca como se lee en español. ' +
    `Decí exactamente esto, con una pausa breve después de "Hola" y otra después de "${nombre} de QuantumHive": ` +
    `"Hola, soy ${nombre} de QuantumHive. ¿En qué te ayudo hoy?" ` +
    'No agregues nada más ni digas que esto es una instrucción.'
  );
}

/** La Live API acepta ~1 imagen por segundo. Muestrear más rápido es tirar CPU. */
const INTERVALO_VISION_MS = 1000;

let orbe: BrowserWindow | null = null;
let bandeja: Tray | null = null;
let temporizadorVision: NodeJS.Timeout | null = null;

const capturador = new ScreenCapturer();
const navegador = new NavegadorQuantum();
let sesion: SesionLive | null = null;
let sesionPrevia: SesionLive | null = null;
let vozElegida: VozDisponible = 'Puck';

// El modo texto no tiene conexión que mantener viva ni credenciales que
// cambien en caliente: se crea una sola vez y se reusa siempre.
const sesionTexto = new SesionTexto(configuracionTexto(), navegador);
sesionTexto.on('texto', (fragmento: string) => {
  publicar({ hablando: true });
  avisar(CANALES.textoModelo, fragmento);
});
sesionTexto.on('turno-fin', () => {
  publicar({ hablando: false });
  avisar(CANALES.turnoFin);
});
sesionTexto.on('error', (detalle: string) => avisar(CANALES.error, detalle));

const controlInactividad = new ControlInactividad({
  avisar: () => {
    avisar(
      CANALES.desconexionInactividad,
      '¿Seguís ahí? Si no respondés en cinco minutos voy a desconectarme.',
    );
    sesion?.enviarTexto(
      'Preguntale brevemente al usuario si todavía te necesita. Explicale que, si no responde, la sesión se cerrará en cinco minutos.',
    );
  },
  desconectar: () => {
    controlInactividad.detener();
    pararVision();
    sesion?.cerrar();
    sesion = null;
    publicar({ sesion: 'cerrada', hablando: false });
    avisar(
      CANALES.desconexionInactividad,
      'Cerré la sesión por inactividad. Tocá el micrófono o escribime para volver.',
    );
  },
});

const estado: EstadoOrbe = {
  sesion: 'cerrada',
  voz: vozElegida,
  observando: false,
  hablando: false,
  frenado: false,
  expandido: false,
  fuente: null,
  ventana: null,
};

/** Redimensiona la ventana y avisa, en ese orden y siempre juntos. */
function expandir(abierto: boolean): void {
  if (orbe === null || orbe.isDestroyed()) return;
  expandirOrbe(orbe, abierto);
  publicar({ expandido: abierto });
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

function publicar(cambios: Partial<EstadoOrbe> = {}): void {
  Object.assign(estado, cambios);
  if (orbe && !orbe.isDestroyed()) {
    orbe.webContents.send(CANALES.estado, estado);
  }
}

function avisar(canal: string, carga?: unknown): void {
  if (orbe && !orbe.isDestroyed()) orbe.webContents.send(canal, carga);
}

// ---------------------------------------------------------------------------
// Sesión de voz (Live API, audio nativo)
// ---------------------------------------------------------------------------

function configuracion() {
  return {
    proyecto: process.env['GCP_PROJECT_ID'] ?? 'bubbly-stone-502214-u7',
    region: process.env['GCP_REGION'] ?? 'us-east4',
    modelo: process.env['GEMINI_LIVE_MODEL'] ?? 'gemini-live-2.5-flash-native-audio',
    voz: vozElegida,
  };
}

/** El modo texto usa un modelo de texto estándar, aparte y mucho más barato. */
function configuracionTexto() {
  return {
    proyecto: process.env['GCP_PROJECT_ID'] ?? 'bubbly-stone-502214-u7',
    region: process.env['GCP_REGION'] ?? 'us-east4',
    modelo: process.env['GEMINI_TEXT_MODEL'] ?? 'gemini-2.5-flash',
  };
}

async function conectar(): Promise<void> {
  // Ya está lista: no hay nada que hacer. Sin esto, cada mensaje de texto o
  // cada click en el micrófono tirarían la sesión abajo y la reconectarían de
  // nuevo, perdiendo el contexto por las puras.
  if (sesion !== null && sesion.lista) return;

  if (sesion !== null) sesion.cerrar();

  sesion = new SesionLive(configuracion());

  sesion.on('estado', (s) => {
    if (s !== 'lista') controlInactividad.detener();
    publicar({ sesion: s });
  });
  sesion.on('lista', () => {
    controlInactividad.iniciar();
    publicar({ sesion: 'lista', detalle: undefined });
  });
  sesion.on('texto', (fragmento: string) => {
    publicar({ hablando: true });
    avisar(CANALES.textoModelo, fragmento);
  });
  sesion.on('audio', (pcm: Buffer) => avisar(CANALES.audioModelo, pcm));
  sesion.on('transcripcion-usuario', (t: string) => {
    controlInactividad.registrarActividad();
    avisar(CANALES.transcripcionUsuario, t);
  });
  sesion.on('herramientas', (llamadas: LlamadaHerramienta[]) => {
    controlInactividad.registrarActividad();
    const sesionActiva = sesion;
    void ejecutarHerramientas(llamadas, navegador).then((respuestas) => {
      if (sesion === sesionActiva) sesionActiva?.responderHerramientas(respuestas);
    });
  });
  sesion.on('turno-fin', () => {
    publicar({ hablando: false });
    avisar(CANALES.turnoFin);
  });
  sesion.on('interrumpido', () => {
    publicar({ hablando: false });
    avisar(CANALES.interrumpido);
  });
  sesion.on('error', (detalle: string) => {
    publicar({ sesion: 'error', hablando: false, detalle });
    avisar(CANALES.error, detalle);
  });

  await sesion.conectar({
    observando: estado.observando,
    ventana: estado.ventana,
  });
}

// ---------------------------------------------------------------------------
// Visión
// ---------------------------------------------------------------------------

/** El modo texto arma su propio prompt en cada pedido; que lea lo mismo que ve el modo voz. */
function sincronizarContextoTexto(): void {
  sesionTexto.actualizarContexto({ observando: estado.observando, ventana: estado.ventana });
}

function arrancarVision(): void {
  if (temporizadorVision !== null) return;
  fallosSeguidos = 0;
  temporizadorVision = setInterval(() => {
    void mirar();
  }, INTERVALO_VISION_MS);
  publicar({ observando: true });
  sincronizarContextoTexto();
}

function pararVision(): void {
  if (temporizadorVision !== null) {
    clearInterval(temporizadorVision);
    temporizadorVision = null;
  }
  publicar({ observando: false });
  sincronizarContextoTexto();
}

/**
 * Cuántas capturas seguidas pueden fallar antes de apagar el ojo.
 *
 * `desktopCapturer` falla de a ratos —la ventana se minimiza un instante, el
 * compositor está ocupado, la lista de fuentes tarda— y apagar la visión al
 * primer tropiezo la deja muerta para el resto de la sesión sin que el usuario
 * entienda por qué dejó de ver.
 */
const FALLOS_TOLERADOS = 5;
let fallosSeguidos = 0;

async function mirar(): Promise<void> {
  if (sesion === null || !sesion.lista || capturador.selectedSource === null) return;
  try {
    const cuadro = await capturador.capture('passive');
    fallosSeguidos = 0;
    // `capture` devuelve el JPEG sólo cuando el cuadro cambió: si la pantalla
    // está quieta no tiene sentido gastar contexto del modelo en repetirla.
    if (cuadro.jpegBase64 !== null) {
      sesion.enviarCuadro(Buffer.from(cuadro.jpegBase64, 'base64'));
    }
  } catch (error) {
    fallosSeguidos += 1;
    if (fallosSeguidos < FALLOS_TOLERADOS) return;
    pararVision();
    avisar(
      CANALES.error,
      `Dejé de ver: ${FALLOS_TOLERADOS} capturas seguidas fallaron. ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Freno
// ---------------------------------------------------------------------------

function frenar(): void {
  controlInactividad.detener();
  pararVision();
  // El micrófono lo cierra el orbe cuando ve `frenado`: es el que lo tiene
  // abierto. Acá se corta lo que sí depende del proceso principal.
  publicar({ frenado: true, hablando: false });
  sesion?.cerrar();
  sesion = null;
  publicar({ sesion: 'cerrada' });
  sesionTexto.reiniciar();
}

function soltarFreno(): void {
  publicar({ frenado: false });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registrarIpc(): void {
  // Este canal sólo lo pide el orbe al prender el micrófono: conecta (o
  // reusa) la sesión de voz y siempre saluda, haya hecho falta reconectar o
  // no. Es la única manera de garantizar el saludo en cada mic-on: si sólo
  // saludara al conectar de cero, prender-apagar-prender se quedaría mudo la
  // segunda vez porque la sesión ya estaba lista.
  ipcMain.handle(CANALES.conectar, async () => {
    if (estado.frenado) soltarFreno();
    await conectar();
    if (sesion?.lista) sesion.enviarTexto(saludoVoz(vozElegida));
    return estado;
  });

  ipcMain.handle(CANALES.desconectar, () => {
    controlInactividad.detener();
    sesion?.cerrar();
    sesion = null;
    pararVision();
    publicar({ sesion: 'cerrada' });
    return estado;
  });

  // El audio del micrófono llega crudo y seguido: `on` y no `handle`, porque
  // no hay nada que contestar y un round-trip por cada pedacito de voz sería
  // latencia regalada.
  ipcMain.on(CANALES.audio, (_evento, pcm: ArrayBuffer) => {
    if (estado.frenado) return;
    sesion?.enviarAudio(Buffer.from(pcm));
  });

  // El texto siempre está disponible: no hay conexión que mantener viva acá,
  // sólo un pedido HTTP con el historial completo. Si la visión está
  // prendida, se le adjunta el cuadro actual para que conteste sobre lo que
  // se ve, igual que en modo voz.
  ipcMain.handle(CANALES.texto, async (_evento, texto: unknown) => {
    if (typeof texto !== 'string' || !texto.trim() || estado.frenado) return false;
    controlInactividad.registrarActividad();
    let cuadro: string | null = null;
    if (estado.observando && capturador.selectedSource !== null) {
      try {
        cuadro = (await capturador.capture('conversation')).jpegBase64;
      } catch {
        cuadro = null;
      }
    }
    void sesionTexto.responder(texto.trim(), cuadro);
    return true;
  });

  ipcMain.handle(CANALES.listarFuentes, async () => listSources());

  ipcMain.handle(CANALES.elegirFuente, (_evento, id: unknown, nombre: unknown) => {
    if (typeof id !== 'string' || !id) return estado;
    capturador.select(id);
    publicar({ fuente: id, ventana: typeof nombre === 'string' ? nombre : estado.ventana });
    sincronizarContextoTexto();
    return estado;
  });

  ipcMain.handle(CANALES.elegirVoz, (_evento, voz: unknown) => {
    if (typeof voz !== 'string' || !(VOCES_DISPONIBLES as readonly string[]).includes(voz)) return estado;
    vozElegida = voz as VozDisponible;
    publicar({ voz: vozElegida });
    // La voz se fija al conectar: si había una sesión de voz abierta, se
    // cierra para que el próximo mic-on reconecte ya con la voz nueva.
    sesion?.cerrar();
    sesion = null;
    publicar({ sesion: 'cerrada' });
    return estado;
  });

  // Una sesión de voz descartable, sólo para que se escuche antes de elegir:
  // conecta, dice una frase cortita con esa voz, y se cierra sola.
  ipcMain.handle(CANALES.probarVoz, async (_evento, voz: unknown) => {
    if (typeof voz !== 'string' || !(VOCES_DISPONIBLES as readonly string[]).includes(voz)) return false;
    const vozPedida = voz as VozDisponible;

    sesionPrevia?.cerrar();
    sesionPrevia = new SesionLive({ ...configuracion(), voz: vozPedida });
    const previa = sesionPrevia;

    previa.on('audio', (pcm: Buffer) => {
      publicar({ hablando: true });
      avisar(CANALES.audioModelo, pcm);
    });
    const terminar = () => {
      publicar({ hablando: false });
      avisar(CANALES.turnoFin);
      if (sesionPrevia === previa) sesionPrevia = null;
      previa.cerrar();
    };
    previa.on('turno-fin', terminar);
    previa.on('error', terminar);

    await previa.conectar({ observando: false });
    if (previa.lista) previa.enviarTexto(saludoVoz(vozPedida));
    else terminar();
    return true;
  });

  ipcMain.handle(CANALES.vision, (_evento, encendida: unknown) => {
    if (typeof encendida !== 'boolean') return estado;
    if (encendida && capturador.selectedSource === null) {
      avisar(CANALES.error, 'Elegí primero qué ventana querés que mire.');
      return estado;
    }
    if (encendida) arrancarVision();
    else pararVision();
    return estado;
  });

  ipcMain.handle(CANALES.expandir, (_evento, abierto: unknown) => {
    if (typeof abierto !== 'boolean') return estado.expandido;
    expandir(abierto);
    return estado.expandido;
  });

  ipcMain.handle(CANALES.frenar, (_evento, activar: unknown) => {
    if (activar === false) soltarFreno();
    else frenar();
    return estado;
  });

  // El micrófono se pide desde el renderer; sin esto Electron lo niega en
  // silencio y el orbe se queda mudo sin explicación.
  ipcMain.handle('orbe:estado-actual', () => estado);
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

function crearBandeja(): void {
  bandeja = new Tray(nativeImage.createEmpty());
  bandeja.setToolTip('Quantum Assistant');
  bandeja.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mostrar', click: () => orbe?.show() },
      { type: 'separator' },
      { label: `Frenar (${ATAJO_FRENO})`, click: () => frenar() },
      { type: 'separator' },
      { label: 'Salir', click: () => app.quit() },
    ]),
  );
}

app.whenReady().then(() => {
  registrarIpc();
  orbe = crearOrbe();
  crearBandeja();

  // El freno responde aunque la sesión esté caída: lo registra Electron y no
  // depende de que haya conexión con el modelo.
  globalShortcut.register(ATAJO_FRENO, () => frenar());

  const dirCaptura = process.env['QH_SNAPSHOT_DIR'];
  if (dirCaptura) orbe.once('ready-to-show', () => void fotografiar(dirCaptura));

  orbe.webContents.session.setPermissionRequestHandler((_wc, permiso, conceder) => {
    // El orbe necesita el micrófono y nada más. Cualquier otro permiso —
    // cámara, ubicación, notificaciones— se niega sin preguntar.
    //
    // `media` cubre micrófono y cámara juntos, así que el filtro fino va en
    // el `getUserMedia` del renderer, que sólo pide audio.
    conceder(permiso === 'media');
  });
});

/**
 * Capturas de regresión de la interfaz. Se activa con `QH_SNAPSHOT_DIR`.
 *
 * Existe porque el orbe es una ventana transparente y siempre encima:
 * `PrintWindow` y las capturas de escritorio del sistema devuelven negro con
 * composición por GPU. La única forma de ver lo que renderiza es pedírselo a
 * Electron.
 */
async function fotografiar(dir: string): Promise<void> {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

  mkdirSync(dir, { recursive: true });
  const informe: string[] = [];

  const tirar = async (nombre: string) => {
    if (orbe === null || orbe.isDestroyed()) return;
    const imagen = await orbe.webContents.capturePage();
    if (imagen.isEmpty()) {
      informe.push(`${nombre}: captura vacía`);
      return;
    }
    writeFileSync(join(dir, `${nombre}.png`), imagen.toPNG());
    const t = imagen.getSize();
    informe.push(`${nombre}: ${t.width}x${t.height}`);
  };

  await esperar(1500);
  await tirar('orbe-colapsado');

  expandir(true);
  await esperar(1200);

  const fuentes = await listSources();
  const elegida = fuentes[0];
  if (elegida !== undefined) {
    capturador.select(elegida.source_id);
    publicar({ fuente: elegida.source_id, ventana: elegida.name });
    informe.push(`fuente: ${elegida.name}`);
  }

  await conectar();
  await esperar(2500);
  await tirar('orbe-abierto');

  // Con el ojo prendido: es lo único que prueba que el bucle de visión llega
  // hasta el modelo. Sin esto, la captura sólo demuestra que la ventana pinta.
  arrancarVision();
  await esperar(3000);

  sesion?.enviarTexto('Mirá mi pantalla y decime en una frase qué aplicación estoy usando.');
  await esperar(11_000);
  await tirar('orbe-conversando');
  informe.push(`cuadros enviados: ${estado.observando ? 'sí' : 'no'}`);

  informe.push(`sesión: ${estado.sesion}`);
  writeFileSync(join(dir, 'informe.txt'), `${informe.join('\n')}\n`, 'utf8');
  process.stdout.write(`[captura]\n${informe.join('\n')}\n`);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  controlInactividad.detener();
  pararVision();
  sesion?.cerrar();
  bandeja?.destroy();
  navegador.cerrar();
});
