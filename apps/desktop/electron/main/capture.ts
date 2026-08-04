/**
 * Captura de pantalla y deteccion de cambio.
 *
 * El plan pide muestrear cada 500 ms y enviar "solo si existe cambio
 * relevante". Comparar cuadros completos a 2 Hz en un monitor grande es un
 * costo permanente innecesario, asi que la comparacion corre sobre una
 * miniatura de 9x8 en escala de grises.
 */

import { desktopCapturer, screen } from 'electron';
import { hammingDistance, perceptualHash } from './image-hash.js';

export { hammingDistance, perceptualHash } from './image-hash.js';

export type CapturePurpose = 'passive' | 'conversation' | 'analysis';

export interface SourceInfo {
  source_id: string;
  name: string;
  thumbnail_data_url?: string;
}

export interface CaptureResult {
  width: number;
  height: number;
  phash: string;
  phash_distance: number;
  jpegBase64: string | null;
}

/** Resoluciones de la seccion 8.2, por proposito. */
const TARGET_WIDTH: Record<CapturePurpose, number> = {
  passive: 768,
  conversation: 1280,
  analysis: 1600,
};

/**
 * Umbral de distancia de Hamming por encima del cual el cuadro se considera
 * distinto. En pasivo es alto para ignorar el parpadeo de la ultima vela.
 */
const CHANGE_THRESHOLD: Record<CapturePurpose, number> = {
  passive: 8,
  conversation: 3,
  analysis: 0,
};

const JPEG_QUALITY = 72;

/**
 * Solo pantallas completas, no ventanas sueltas. Elegir entre "pestañas" de
 * cada ventana era el detalle que más se rompía y el que menos hacía falta:
 * con ver la pantalla entera alcanza, y detectar cuántos monitores hay es
 * mucho menos frágil que listar ventanas (que cambian todo el tiempo).
 */
export async function listSources(): Promise<SourceInfo[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });

  return sources.map((source, indice) => ({
    source_id: source.id,
    name: `Pantalla ${indice + 1}`,
    thumbnail_data_url: source.thumbnail.isEmpty() ? undefined : source.thumbnail.toDataURL(),
  }));
}

export class ScreenCapturer {
  private sourceId: string | null = null;
  private lastHash: string | null = null;
  private frozenFrame: CaptureResult | null = null;

  get selectedSource(): string | null {
    return this.sourceId;
  }

  get frozen(): boolean {
    return this.frozenFrame !== null || this.pendingFreeze;
  }

  select(sourceId: string): void {
    this.sourceId = sourceId;
    this.lastHash = null;
    this.frozenFrame = null;
    this.pendingFreeze = false;
  }

  private pendingFreeze = false;

  /**
   * Congelar no retiene el cuadro anterior: marca que el proximo se guarde y
   * se devuelva siempre el mismo. Asi "congela" significa "este que estoy
   * mirando ahora", que es lo que espera quien lo pide.
   */
  freeze(frozen: boolean): void {
    if (frozen) {
      this.pendingFreeze = true;
    } else {
      this.pendingFreeze = false;
      this.frozenFrame = null;
    }
  }

  async capture(purpose: CapturePurpose = 'conversation'): Promise<CaptureResult> {
    if (this.frozenFrame !== null) {
      return { ...this.frozenFrame, phash_distance: 0 };
    }
    if (this.sourceId === null) {
      throw new Error('No hay ninguna fuente seleccionada para observar.');
    }

    const displaySize = screen.getPrimaryDisplay().size;
    const targetWidth = TARGET_WIDTH[purpose];
    const scale = Math.min(1, targetWidth / displaySize.width);

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(displaySize.width * scale),
        height: Math.round(displaySize.height * scale),
      },
      fetchWindowIcons: false,
    });

    const source = sources.find((candidate) => candidate.id === this.sourceId);
    if (source === undefined) {
      throw new Error('Esa pantalla ya no está conectada.');
    }

    const image = source.thumbnail;
    const phash = perceptualHash(image);
    const distance = this.lastHash === null ? 64 : hammingDistance(phash, this.lastHash);
    const changed = distance > CHANGE_THRESHOLD[purpose];
    this.lastHash = phash;

    const size = image.getSize();
    const result: CaptureResult = {
      width: size.width,
      height: size.height,
      phash,
      phash_distance: distance,
      // En pasivo, si nada cambio no se manda la imagen: al core le alcanza
      // con saber que se sigue observando.
      jpegBase64:
        purpose === 'passive' && !changed
          ? null
          : image.toJPEG(JPEG_QUALITY).toString('base64'),
    };

    if (this.pendingFreeze) {
      this.frozenFrame = result;
      this.pendingFreeze = false;
    }

    return result;
  }
}
