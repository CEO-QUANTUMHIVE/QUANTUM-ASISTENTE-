/**
 * Token para Vertex. Único lugar donde se resuelve.
 *
 * Hoy sale de gcloud en la máquina de Sergio. En el instalador **no puede
 * salir de acá**: la credencial no viaja adentro del paquete (regla no
 * negociable #2). Cuando exista el gateway, esta función pasa a pedirle el
 * token a él y nada más del código se entera.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);

/** Los tokens de gcloud duran una hora; se renueva antes por las dudas. */
const VIGENCIA_MS = 45 * 60 * 1000;

let cache: { token: string; vence: number } | null = null;

export class SinCredencialesError extends Error {
  constructor() {
    super(
      'No hay credenciales de Google. Corré `gcloud auth login` en una terminal.\n' +
        'Ojo: `gcloud auth list` muestra la cuenta como activa aunque el token haya vencido, ' +
        'así que no sirve para darse cuenta.',
    );
    this.name = 'SinCredencialesError';
  }
}

export async function obtenerToken(): Promise<string> {
  if (cache !== null && Date.now() < cache.vence) return cache.token;

  try {
    const { stdout } = await ejecutar('gcloud', ['auth', 'print-access-token'], {
      shell: true,
      timeout: 30_000,
    });
    const token = stdout.trim();
    if (!token) throw new SinCredencialesError();
    cache = { token, vence: Date.now() + VIGENCIA_MS };
    return token;
  } catch (error) {
    cache = null;
    if (error instanceof SinCredencialesError) throw error;
    throw new SinCredencialesError();
  }
}

export function olvidarToken(): void {
  cache = null;
}
