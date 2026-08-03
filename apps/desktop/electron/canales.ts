/**
 * Los canales entre el proceso principal y el orbe.
 *
 * Fase 1 no tiene servidor local ni puerto: el núcleo vive en el proceso
 * principal y el orbe le habla por IPC. Toda la superficie es esta.
 */

export const CANALES = {
  // renderer → main
  conectar: 'orbe:conectar',
  desconectar: 'orbe:desconectar',
  audio: 'orbe:audio',
  texto: 'orbe:texto',
  listarFuentes: 'orbe:listar-fuentes',
  elegirFuente: 'orbe:elegir-fuente',
  vision: 'orbe:vision',
  expandir: 'orbe:expandir',
  frenar: 'orbe:frenar',

  // main → renderer
  estado: 'orbe:estado',
  textoModelo: 'orbe:texto-modelo',
  audioModelo: 'orbe:audio-modelo',
  transcripcionUsuario: 'orbe:transcripcion-usuario',
  turnoFin: 'orbe:turno-fin',
  interrumpido: 'orbe:interrumpido',
  desconexionInactividad: 'orbe:desconexion-inactividad',
  error: 'orbe:error',
} as const;

export type Canal = (typeof CANALES)[keyof typeof CANALES];

export interface EstadoOrbe {
  sesion: 'cerrada' | 'conectando' | 'lista' | 'error';
  /**
   * No está `escuchando`: el micrófono vive en el orbe y el proceso principal
   * no tiene cómo saber si está abierto. Si lo publicara igual, cada vez que
   * cambia otra cosa —que el modelo empiece a hablar, sin ir más lejos— el
   * estado que llega pisaría al del orbe y la luz del micrófono se apagaría
   * con el micrófono todavía abierto. Lo mismo que ya pasa con `expandido`,
   * pero al revés: manda el que tiene la cosa en la mano.
   */
  observando: boolean;
  hablando: boolean;
  frenado: boolean;
  /**
   * Si el chat está desplegado. Lo manda el proceso principal, que es el que
   * redimensiona la ventana. Si el renderer llevara su propia copia, el tamaño
   * de la ventana y lo que se dibuja adentro podrían quedar en desacuerdo —y
   * quedan, en cuanto algo redimensiona sin pasar por el click del usuario.
   */
  expandido: boolean;
  fuente: string | null;
  ventana: string | null;
  detalle?: string;
}

/** Formato del audio, para que el orbe no tenga que adivinarlo. */
export const AUDIO = {
  entradaHz: 16_000,
  salidaHz: 24_000,
} as const;
