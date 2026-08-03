/**
 * Sesión bidireccional con Gemini Live.
 *
 * No son turnos de pregunta y respuesta: es una conversación abierta. El audio
 * del micrófono fluye hacia arriba, los cuadros de pantalla también, y el
 * modelo decide cuándo contestar. Por eso esto es un emisor de eventos y no
 * una función que devuelve una respuesta.
 *
 * Cuatro cosas que costaron descubrir y están acá por eso:
 *
 * 1. **Los modelos `native-audio` NO aceptan salida de texto.** Vertex corta
 *    con "Text output is not supported for native audio output model". La
 *    modalidad la manda el modelo, no la configuración.
 * 2. **La transcripción llega en fragmentos** ("Veo", " el gráfico", " en
 *    M15") intercalados con el audio, y sigue después de `generationComplete`.
 *    El único final real de un turno es `turnComplete`.
 * 3. **La imagen viaja como medio, no como resultado de función.** Una
 *    `functionResponse` es JSON y no puede llevar píxeles.
 * 4. **El audio de entrada va a 16 kHz y el de salida viene a 24 kHz.** No es
 *    la misma frecuencia y confundirlas suena a chipmunk.
 */

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import {
  HERRAMIENTAS_LIVE,
  type LlamadaHerramienta,
  type RespuestaHerramienta,
} from '../herramientas-definicion.js';
import { obtenerToken, olvidarToken } from './credenciales.js';
import { armarInstruccion, type ContextoSesion } from './constitucion.js';

export const FRECUENCIA_ENTRADA = 16_000;
export const FRECUENCIA_SALIDA = 24_000;

/**
 * Cuánto se espera el `setupComplete` antes de darlo por perdido.
 *
 * Generoso a propósito: es una sola vez por sesión y la alternativa —cortar
 * antes— es peor que esperar de más.
 */
const ESPERA_LISTA_MS = 20_000;

export interface OpcionesSesion {
  proyecto: string;
  region: string;
  modelo: string;
}

export type EstadoSesion = 'cerrada' | 'conectando' | 'lista' | 'error';

export class SesionLive extends EventEmitter {
  private ws: WebSocket | null = null;
  private estadoActual: EstadoSesion = 'cerrada';
  private reconectando = false;
  private cerradaPorNosotros = false;
  private contexto: ContextoSesion = { observando: false };

  constructor(private readonly opciones: OpcionesSesion) {
    super();
  }

  get estado(): EstadoSesion {
    return this.estadoActual;
  }

  get lista(): boolean {
    return this.estadoActual === 'lista' && this.ws?.readyState === WebSocket.OPEN;
  }

  /** Los modelos de audio nativo sólo saben contestar hablando. */
  private get soloAudio(): boolean {
    return this.opciones.modelo.includes('native-audio');
  }

  private get url(): string {
    const host = `${this.opciones.region}-aiplatform.googleapis.com`;
    return `wss://${host}/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;
  }

  private get modeloCompleto(): string {
    const { proyecto, region, modelo } = this.opciones;
    return `projects/${proyecto}/locations/${region}/publishers/google/models/${modelo}`;
  }

  // --- ciclo de vida -----------------------------------------------------

  async conectar(contexto: ContextoSesion): Promise<void> {
    this.contexto = contexto;
    this.cerradaPorNosotros = false;

    if (this.ws !== null) this.cerrar();
    this.cambiarEstado('conectando');

    let token: string;
    try {
      token = await obtenerToken();
    } catch (error) {
      this.cambiarEstado('error');
      this.emit('error', error instanceof Error ? error.message : String(error));
      return;
    }

    const ws = new WebSocket(this.url, {
      headers: { Authorization: `Bearer ${token}` },
      maxPayload: 0,
    });
    this.ws = ws;

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          setup: {
            model: this.modeloCompleto,
            generationConfig: {
              responseModalities: [this.soloAudio ? 'AUDIO' : 'TEXT'],
            },
            systemInstruction: { parts: [{ text: armarInstruccion(this.contexto) }] },
            tools: HERRAMIENTAS_LIVE,
            // Con salida de audio, la transcripción no es opcional: el chat y
            // la memoria guardan texto, no un WAV.
            ...(this.soloAudio ? { outputAudioTranscription: {} } : {}),
            // Para ver en el chat lo que uno mismo dijo.
            inputAudioTranscription: {},
          },
        }),
      );
    });

    ws.on('message', (crudo: WebSocket.RawData) => this.recibir(crudo));

    ws.on('close', (codigo, motivo) => {
      this.ws = null;
      const texto = motivo?.toString() || '';
      if (this.cerradaPorNosotros) {
        this.cambiarEstado('cerrada');
        return;
      }
      // 1008 es política: token vencido, modelo inexistente, cuota. Reintentar
      // con el mismo token no arregla nada, así que se descarta el cacheado.
      if (codigo === 1008) olvidarToken();
      this.cambiarEstado('error');
      this.emit('error', texto || `la sesión se cerró (${codigo})`);
      void this.reconectar();
    });

    ws.on('error', (error: Error) => {
      this.emit('error', error.message);
    });

    // No alcanza con haber creado el socket: hasta que no llega `setupComplete`
    // la sesión descarta todo lo que se le mande. Si `conectar()` resolviera
    // antes, el que hace `await conectar()` y se pone a hablar pierde las
    // primeras palabras sin enterarse.
    await this.esperarLista();
  }

  /** Resuelve cuando la sesión quedó lista, o cuando falló. Nunca rechaza. */
  private esperarLista(): Promise<void> {
    if (this.lista) return Promise.resolve();

    return new Promise((resolver) => {
      const limpiar = (): void => {
        clearTimeout(reloj);
        this.off('lista', alListo);
        this.off('error', alFallo);
      };
      const alListo = (): void => {
        limpiar();
        resolver();
      };
      // Se resuelve igual, no se rechaza: el estado ya quedó en 'error' y el
      // orbe lo muestra. Rechazar acá sólo convertiría esto en una promesa
      // colgada del otro lado del IPC.
      const alFallo = (): void => {
        limpiar();
        resolver();
      };
      const reloj = setTimeout(() => {
        this.cambiarEstado('error');
        this.emit('error', `el modelo no contestó el saludo en ${ESPERA_LISTA_MS / 1000} s`);
        limpiar();
        resolver();
      }, ESPERA_LISTA_MS);

      this.once('lista', alListo);
      this.once('error', alFallo);
    });
  }

  private async reconectar(): Promise<void> {
    if (this.reconectando || this.cerradaPorNosotros) return;
    this.reconectando = true;
    await new Promise((r) => setTimeout(r, 2000));
    this.reconectando = false;
    if (!this.cerradaPorNosotros) await this.conectar(this.contexto);
  }

  cerrar(): void {
    this.cerradaPorNosotros = true;
    this.ws?.close();
    this.ws = null;
    this.cambiarEstado('cerrada');
  }

  private cambiarEstado(estado: EstadoSesion): void {
    if (this.estadoActual === estado) return;
    this.estadoActual = estado;
    this.emit('estado', estado);
  }

  // --- entrada -----------------------------------------------------------

  /** Un pedazo de micrófono: PCM 16 bits little-endian, 16 kHz, mono. */
  enviarAudio(pcm: Buffer): void {
    if (!this.lista) return;
    this.enviar({
      realtimeInput: {
        mediaChunks: [
          { mimeType: `audio/pcm;rate=${FRECUENCIA_ENTRADA}`, data: pcm.toString('base64') },
        ],
      },
    });
  }

  /** Un cuadro de la pantalla. */
  enviarCuadro(jpeg: Buffer): void {
    if (!this.lista) return;
    this.enviar({
      realtimeInput: {
        mediaChunks: [{ mimeType: 'image/jpeg', data: jpeg.toString('base64') }],
      },
    });
  }

  /** Un mensaje escrito. Cierra el turno y espera respuesta. */
  enviarTexto(texto: string): void {
    if (!this.lista) return;
    this.enviar({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: texto }] }],
        turnComplete: true,
      },
    });
  }

  /** Devuelve a Gemini el resultado de las acciones pedidas por function calling. */
  responderHerramientas(respuestas: RespuestaHerramienta[]): void {
    if (!this.lista || respuestas.length === 0) return;
    this.enviar({ toolResponse: { functionResponses: respuestas } });
  }

  // No hay un `interrumpir()`: interrumpir no se manda, se hace hablando
  // encima. La detección de voz automática viene encendida (no se toca
  // `realtimeInputConfig`), el modelo se calla solo y avisa con `interrupted`,
  // que ya se maneja más abajo. Los `activityStart`/`activityEnd` son de la
  // otra modalidad —la manual— y con la automática encendida el servidor los
  // rechaza.

  private enviar(mensaje: unknown): void {
    this.ws?.send(JSON.stringify(mensaje));
  }

  // --- salida ------------------------------------------------------------

  private recibir(crudo: WebSocket.RawData): void {
    let mensaje: Record<string, any>;
    try {
      mensaje = JSON.parse(crudo.toString());
    } catch {
      return;
    }

    if (mensaje['setupComplete']) {
      this.cambiarEstado('lista');
      this.emit('lista');
      return;
    }

    const llamadas = mensaje['toolCall']?.functionCalls;
    if (Array.isArray(llamadas) && llamadas.length > 0) {
      const validas = llamadas.filter(
        (llamada: unknown): llamada is LlamadaHerramienta =>
          typeof llamada === 'object' &&
          llamada !== null &&
          typeof (llamada as LlamadaHerramienta).id === 'string' &&
          typeof (llamada as LlamadaHerramienta).name === 'string',
      );
      if (validas.length > 0) this.emit('herramientas', validas);
    }

    const contenido = mensaje['serverContent'];
    if (!contenido) return;

    // Lo que dijo el usuario, transcrito.
    const entrada = contenido.inputTranscription?.text;
    if (entrada) this.emit('transcripcion-usuario', entrada);

    // Lo que dice el modelo, en fragmentos.
    const salida = contenido.outputTranscription?.text;
    if (salida) this.emit('texto', salida);

    for (const parte of contenido.modelTurn?.parts ?? []) {
      if (parte.text) this.emit('texto', parte.text);
      const tipo: string = parte.inlineData?.mimeType ?? '';
      if (tipo.startsWith('audio/')) {
        this.emit('audio', Buffer.from(parte.inlineData.data, 'base64'));
      }
    }

    // El modelo se calló porque el usuario empezó a hablar encima.
    if (contenido.interrupted) this.emit('interrumpido');

    // `generationComplete` es "terminé el audio", pero la transcripción sigue
    // llegando después. Cortar ahí deja la frase por la mitad.
    if (contenido.turnComplete) this.emit('turno-fin');
  }
}
