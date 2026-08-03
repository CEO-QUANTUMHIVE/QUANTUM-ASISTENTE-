/**
 * Política obligatoria de inactividad.
 *
 * La primera espera produce un aviso; la segunda corta la sesión. No existe
 * configuración de usuario para desactivarla: además de ordenar la experiencia,
 * evita mantener conexiones Live abiertas sin necesidad.
 */

export const ESPERA_INACTIVIDAD_MS = 5 * 60 * 1000;

type Temporizador = ReturnType<typeof setTimeout>;

export interface AccionesInactividad {
  avisar: () => void;
  desconectar: () => void;
}

export class ControlInactividad {
  private reloj: Temporizador | null = null;
  private avisoEnviado = false;

  constructor(
    private readonly acciones: AccionesInactividad,
    private readonly esperaMs = ESPERA_INACTIVIDAD_MS,
  ) {}

  iniciar(): void {
    this.avisoEnviado = false;
    this.programar();
  }

  registrarActividad(): void {
    if (this.reloj === null) return;
    this.avisoEnviado = false;
    this.programar();
  }

  detener(): void {
    if (this.reloj !== null) clearTimeout(this.reloj);
    this.reloj = null;
    this.avisoEnviado = false;
  }

  private programar(): void {
    if (this.reloj !== null) clearTimeout(this.reloj);
    this.reloj = setTimeout(() => this.alVencer(), this.esperaMs);
  }

  private alVencer(): void {
    if (!this.avisoEnviado) {
      this.avisoEnviado = true;
      this.acciones.avisar();
      this.programar();
      return;
    }

    this.reloj = null;
    this.acciones.desconectar();
  }
}
