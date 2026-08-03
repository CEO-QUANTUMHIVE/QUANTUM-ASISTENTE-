/**
 * Micrófono y reproducción.
 *
 * Las dos puntas usan frecuencias distintas y confundirlas suena a ardilla:
 *
 *     entrada   PCM 16 bits, 16 kHz, mono  → al modelo
 *     salida    PCM 16 bits, 24 kHz, mono  ← del modelo
 *
 * El navegador entrega el micrófono a la frecuencia del dispositivo (casi
 * siempre 48 kHz). En vez de remuestrear a mano, se le pide al `AudioContext`
 * que trabaje a 16 kHz y remuestrea él, que lo hace mejor.
 */

const HZ_ENTRADA = 16_000;
const HZ_SALIDA = 24_000;

/** Cuántas muestras junta antes de mandar. 4096 a 16 kHz son ~256 ms. */
const BLOQUE = 4096;

function floatAPcm16(muestras: Float32Array): ArrayBuffer {
  const salida = new Int16Array(muestras.length);
  for (let i = 0; i < muestras.length; i += 1) {
    // Recortar antes de escalar: sin esto, un pico por encima de 1.0 da la
    // vuelta y se escucha como un chasquido.
    const v = Math.max(-1, Math.min(1, muestras[i]!));
    salida[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return salida.buffer;
}

function pcm16AFloat(bytes: Uint8Array): Float32Array<ArrayBuffer> {
  // `bytes` puede venir con offset dentro de un buffer más grande.
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = Math.floor(bytes.byteLength / 2);
  // Se reserva el ArrayBuffer explícitamente: `copyToChannel` exige un
  // Float32Array respaldado por ArrayBuffer y no por SharedArrayBuffer.
  const salida = new Float32Array(new ArrayBuffer(total * 4));
  for (let i = 0; i < total; i += 1) {
    salida[i] = vista.getInt16(i * 2, true) / 0x8000;
  }
  return salida;
}

export class Microfono {
  private contexto: AudioContext | null = null;
  private flujo: MediaStream | null = null;
  private nodo: ScriptProcessorNode | null = null;

  get activo(): boolean {
    return this.flujo !== null;
  }

  /**
   * Pide el micrófono y empieza a entregar PCM.
   *
   * Usa `ScriptProcessorNode`, que está deprecado. `AudioWorklet` es el
   * reemplazo correcto y corre fuera del hilo principal, pero suma un módulo
   * aparte y otra superficie donde la CSP puede morder. Para voz a 16 kHz con
   * bloques de 4096 el hilo principal alcanza de sobra; se cambia cuando haga
   * falta, no antes.
   */
  async arrancar(alDato: (pcm: ArrayBuffer) => void): Promise<void> {
    if (this.activo) return;

    this.flujo = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.contexto = new AudioContext({ sampleRate: HZ_ENTRADA });
    const fuente = this.contexto.createMediaStreamSource(this.flujo);
    this.nodo = this.contexto.createScriptProcessor(BLOQUE, 1, 1);

    this.nodo.onaudioprocess = (evento) => {
      alDato(floatAPcm16(evento.inputBuffer.getChannelData(0)));
    };

    fuente.connect(this.nodo);
    // Sin conectar a un destino, `onaudioprocess` no se dispara en Chromium.
    // Va a un nodo de ganancia en cero para no devolver la propia voz por los
    // parlantes.
    const mudo = this.contexto.createGain();
    mudo.gain.value = 0;
    this.nodo.connect(mudo);
    mudo.connect(this.contexto.destination);
  }

  parar(): void {
    this.nodo?.disconnect();
    this.nodo = null;
    this.flujo?.getTracks().forEach((t) => t.stop());
    this.flujo = null;
    void this.contexto?.close();
    this.contexto = null;
  }
}

export class Reproductor {
  private contexto: AudioContext | null = null;
  private proximoInicio = 0;
  private sonando = new Set<AudioBufferSourceNode>();

  private asegurar(): AudioContext {
    if (this.contexto === null || this.contexto.state === 'closed') {
      this.contexto = new AudioContext({ sampleRate: HZ_SALIDA });
      this.proximoInicio = 0;
    }
    return this.contexto;
  }

  /**
   * Encola un pedazo de audio del modelo.
   *
   * Los pedazos llegan más rápido de lo que duran, así que se agendan uno
   * detrás del otro contra el reloj del contexto. Reproducirlos apenas llegan
   * los superpondría; esperar a que termine cada uno dejaría huecos audibles.
   */
  encolar(bytes: Uint8Array): void {
    const ctx = this.asegurar();
    const muestras = pcm16AFloat(bytes);
    if (muestras.length === 0) return;

    const buffer = ctx.createBuffer(1, muestras.length, HZ_SALIDA);
    buffer.copyToChannel(muestras, 0);

    const fuente = ctx.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(ctx.destination);

    // Un colchón chico: si la red se atrasa un instante, no se corta la frase.
    const ahora = ctx.currentTime;
    const inicio = Math.max(ahora + 0.04, this.proximoInicio);
    fuente.start(inicio);
    this.proximoInicio = inicio + buffer.duration;

    this.sonando.add(fuente);
    fuente.onended = () => this.sonando.delete(fuente);
  }

  /** Corta lo que esté sonando. Es lo que pasa cuando el usuario interrumpe. */
  vaciar(): void {
    for (const fuente of this.sonando) {
      try {
        fuente.stop();
      } catch {
        // Ya había terminado.
      }
    }
    this.sonando.clear();
    this.proximoInicio = 0;
  }

  cerrar(): void {
    this.vaciar();
    void this.contexto?.close();
    this.contexto = null;
  }
}
