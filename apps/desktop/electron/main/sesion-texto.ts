/**
 * Sesión de texto — pregunta y respuesta, sin Live API.
 *
 * El modo voz usa un modelo de audio nativo porque es el único disponible en
 * este proyecto/región para la Live API. Pero reusar esa misma sesión para
 * mensajes escritos significaría pagar tokens de audio por cada "hola": el
 * modelo igual genera el habla aunque nadie la escuche. Por eso el modo texto
 * es otra cosa, más simple y más barata: un pedido HTTP normal
 * (`generateContent`) a un modelo de texto estándar, sin WebSocket ni
 * conexión que mantener viva.
 *
 * Es sin estado del lado de Vertex — cada pedido lleva el historial completo
 * — así que acá se guarda la conversación y se reenvía entera cada vez. Las
 * herramientas (navegador, aplicaciones) se resuelven en un ida y vuelta
 * propio: si el modelo pide una función, se ejecuta y se le manda el
 * resultado en el pedido siguiente, hasta que conteste con texto.
 */

import { EventEmitter } from 'node:events';
import { HERRAMIENTAS_LIVE, type LlamadaHerramienta } from './herramientas-definicion.js';
import { ejecutarHerramientas } from './herramientas.js';
import { obtenerToken, olvidarToken } from './live/credenciales.js';
import { armarInstruccion, type ContextoSesion } from './live/constitucion.js';
import type { NavegadorQuantum } from './navegador.js';

export interface OpcionesTexto {
  proyecto: string;
  region: string;
  modelo: string;
}

interface Parte {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: unknown };
}

interface Contenido {
  role: 'user' | 'model';
  parts: Parte[];
}

/** Cuántas idas y vueltas de herramientas se toleran antes de cortar en seco. */
const MAX_VUELTAS_HERRAMIENTAS = 6;

export class SesionTexto extends EventEmitter {
  private historial: Contenido[] = [];
  private contexto: ContextoSesion = { observando: false };
  private ocupado = false;

  constructor(
    private readonly opciones: OpcionesTexto,
    private readonly navegador: NavegadorQuantum,
  ) {
    super();
  }

  actualizarContexto(contexto: ContextoSesion): void {
    this.contexto = contexto;
  }

  /** Empieza de cero: se usa al frenar o al pedirlo explícitamente. */
  reiniciar(): void {
    this.historial = [];
  }

  private get url(): string {
    const { proyecto, region, modelo } = this.opciones;
    const host = `${region}-aiplatform.googleapis.com`;
    return `https://${host}/v1/projects/${proyecto}/locations/${region}/publishers/google/models/${modelo}:generateContent`;
  }

  /**
   * Manda un mensaje del usuario y dispara los eventos `texto`, `turno-fin`
   * y `error`. `jpegBase64`, si viene, es el cuadro de pantalla actual —sólo
   * tiene sentido si la visión está prendida.
   */
  async responder(texto: string, jpegBase64?: string | null): Promise<void> {
    if (this.ocupado) {
      this.emit('error', 'Todavía estoy contestando lo anterior, esperá un toque.');
      return;
    }
    this.ocupado = true;
    try {
      const partes: Parte[] = [{ text: texto }];
      if (jpegBase64) partes.push({ inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } });
      this.historial.push({ role: 'user', parts: partes });
      await this.ciclo();
    } finally {
      this.ocupado = false;
    }
  }

  private async ciclo(vuelta = 0): Promise<void> {
    let token: string;
    try {
      token = await obtenerToken();
    } catch (error) {
      this.emit('error', error instanceof Error ? error.message : String(error));
      this.historial.pop();
      return;
    }

    let respuesta: Response;
    try {
      respuesta = await fetch(this.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: this.historial,
          systemInstruction: { parts: [{ text: armarInstruccion(this.contexto) }] },
          tools: HERRAMIENTAS_LIVE,
        }),
      });
    } catch (error) {
      this.emit('error', error instanceof Error ? error.message : String(error));
      this.historial.pop();
      return;
    }

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      if (respuesta.status === 401) olvidarToken();
      this.emit('error', `El modelo de texto contestó ${respuesta.status}: ${detalle.slice(0, 300)}`);
      this.historial.pop();
      return;
    }

    const datos = (await respuesta.json()) as {
      candidates?: Array<{ content?: { parts?: Parte[] } }>;
    };
    const partes = datos.candidates?.[0]?.content?.parts ?? [];
    this.historial.push({ role: 'model', parts: partes });

    const texto = partes
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    if (texto) this.emit('texto', texto);

    const llamadas = partes.filter(
      (p): p is Parte & { functionCall: { name: string; args?: Record<string, unknown> } } =>
        p.functionCall !== undefined,
    );

    if (llamadas.length === 0) {
      this.emit('turno-fin');
      return;
    }

    if (vuelta >= MAX_VUELTAS_HERRAMIENTAS) {
      this.emit('error', 'Se cortó una cadena de herramientas demasiado larga.');
      this.emit('turno-fin');
      return;
    }

    const formateadas: LlamadaHerramienta[] = llamadas.map((p, i) => ({
      id: `texto-${Date.now()}-${i}`,
      name: p.functionCall.name,
      args: p.functionCall.args ?? {},
    }));
    const respuestas = await ejecutarHerramientas(formateadas, this.navegador);
    this.historial.push({
      role: 'user',
      parts: respuestas.map((r) => ({ functionResponse: { name: r.name, response: r.response } })),
    });
    await this.ciclo(vuelta + 1);
  }
}
