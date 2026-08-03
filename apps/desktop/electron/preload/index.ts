/**
 * El puente entre el orbe y el proceso principal.
 *
 * Superficie mínima y explícita: el renderer no ve `ipcRenderer` crudo ni
 * puede inventar un canal. Cada argumento se vuelve a validar del otro lado.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { AUDIO, CANALES, type EstadoOrbe } from '../canales.js';

type Baja = () => void;

function escuchar<T>(canal: string, manejar: (carga: T) => void): Baja {
  const oyente = (_evento: IpcRendererEvent, carga: T): void => manejar(carga);
  ipcRenderer.on(canal, oyente);
  return () => ipcRenderer.off(canal, oyente);
}

const api = {
  audio: AUDIO,

  // --- sesión ------------------------------------------------------------
  conectar: (): Promise<EstadoOrbe> => ipcRenderer.invoke(CANALES.conectar),
  desconectar: (): Promise<EstadoOrbe> => ipcRenderer.invoke(CANALES.desconectar),
  estadoActual: (): Promise<EstadoOrbe> => ipcRenderer.invoke('orbe:estado-actual'),

  // --- hablar ------------------------------------------------------------
  /** Un pedazo de micrófono: PCM 16 bits, 16 kHz, mono. */
  enviarAudio: (pcm: ArrayBuffer): void => ipcRenderer.send(CANALES.audio, pcm),
  enviarTexto: (texto: string): Promise<boolean> => ipcRenderer.invoke(CANALES.texto, texto),

  // --- ver ---------------------------------------------------------------
  listarFuentes: (): Promise<Array<{ source_id: string; name: string; kind: string }>> =>
    ipcRenderer.invoke(CANALES.listarFuentes),
  elegirFuente: (id: string): Promise<EstadoOrbe> => ipcRenderer.invoke(CANALES.elegirFuente, id),
  vision: (encendida: boolean): Promise<EstadoOrbe> => ipcRenderer.invoke(CANALES.vision, encendida),

  // --- ventana -----------------------------------------------------------
  expandir: (expandido: boolean): Promise<boolean> => ipcRenderer.invoke(CANALES.expandir, expandido),
  frenar: (activar = true): Promise<EstadoOrbe> => ipcRenderer.invoke(CANALES.frenar, activar),

  // --- eventos -----------------------------------------------------------
  alEstado: (f: (e: EstadoOrbe) => void): Baja => escuchar(CANALES.estado, f),
  alTexto: (f: (fragmento: string) => void): Baja => escuchar(CANALES.textoModelo, f),
  alAudio: (f: (pcm: Uint8Array) => void): Baja => escuchar(CANALES.audioModelo, f),
  alTranscripcion: (f: (texto: string) => void): Baja =>
    escuchar(CANALES.transcripcionUsuario, f),
  alTurnoFin: (f: () => void): Baja => escuchar(CANALES.turnoFin, f),
  alInterrumpido: (f: () => void): Baja => escuchar(CANALES.interrumpido, f),
  alDesconexionInactividad: (f: (detalle: string) => void): Baja =>
    escuchar(CANALES.desconexionInactividad, f),
  alError: (f: (detalle: string) => void): Baja => escuchar(CANALES.error, f),
} as const;

export type ApiOrbe = typeof api;

contextBridge.exposeInMainWorld('qh', api);
