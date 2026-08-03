import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlInactividad } from '../electron/main/inactividad.js';

describe('desconexión por inactividad', () => {
  afterEach(() => vi.useRealTimers());

  it('avisa una vez y luego desconecta si nadie responde', () => {
    vi.useFakeTimers();
    const avisar = vi.fn();
    const desconectar = vi.fn();
    const control = new ControlInactividad({ avisar, desconectar }, 1000);

    control.iniciar();
    vi.advanceTimersByTime(1000);
    expect(avisar).toHaveBeenCalledOnce();
    expect(desconectar).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(desconectar).toHaveBeenCalledOnce();
  });

  it('una respuesta reinicia las dos esperas', () => {
    vi.useFakeTimers();
    const avisar = vi.fn();
    const desconectar = vi.fn();
    const control = new ControlInactividad({ avisar, desconectar }, 1000);

    control.iniciar();
    vi.advanceTimersByTime(1000);
    control.registrarActividad();
    vi.advanceTimersByTime(999);

    expect(avisar).toHaveBeenCalledOnce();
    expect(desconectar).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(avisar).toHaveBeenCalledTimes(2);
  });

  it('detener cancela cualquier acción pendiente', () => {
    vi.useFakeTimers();
    const avisar = vi.fn();
    const desconectar = vi.fn();
    const control = new ControlInactividad({ avisar, desconectar }, 1000);

    control.iniciar();
    control.detener();
    vi.advanceTimersByTime(3000);

    expect(avisar).not.toHaveBeenCalled();
    expect(desconectar).not.toHaveBeenCalled();
  });
});
