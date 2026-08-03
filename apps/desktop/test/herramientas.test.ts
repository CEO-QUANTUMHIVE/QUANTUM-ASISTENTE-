import { describe, expect, it } from 'vitest';
import {
  HERRAMIENTAS_LIVE,
  esAplicacionPermitida,
  esCarpetaPermitida,
  normalizarUrl,
  urlDeBusqueda,
} from '../electron/main/herramientas-definicion.js';

describe('herramientas del escritorio', () => {
  it('declara solamente las cuatro herramientas acotadas', () => {
    const nombres = HERRAMIENTAS_LIVE[0].functionDeclarations.map((f) => f.name);
    expect(nombres).toEqual(['abrir_url', 'buscar_web', 'abrir_aplicacion', 'abrir_carpeta']);
  });

  it('agrega https a una dirección sin esquema', () => {
    expect(normalizarUrl('example.com')).toBe('https://example.com/');
  });

  it('rechaza protocolos peligrosos y credenciales embebidas', () => {
    expect(() => normalizarUrl('file:///C:/Windows')).toThrow(/http/);
    expect(() => normalizarUrl('https://usuario:clave@example.com')).toThrow(/credenciales/);
  });

  it('codifica correctamente una búsqueda', () => {
    expect(urlDeBusqueda('Quantum Assistant voz')).toBe(
      'https://www.google.com/search?q=Quantum%20Assistant%20voz',
    );
  });

  it('sólo acepta aplicaciones y carpetas de las listas', () => {
    expect(esAplicacionPermitida('calculadora')).toBe(true);
    expect(esAplicacionPermitida('powershell')).toBe(false);
    expect(esCarpetaPermitida('descargas')).toBe(true);
    expect(esCarpetaPermitida('C:\\')).toBe(false);
  });
});
