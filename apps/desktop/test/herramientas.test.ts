import { describe, expect, it } from 'vitest';
import {
  HERRAMIENTAS_LIVE,
  esAccionNavegacion,
  esAplicacionPermitida,
  esCarpetaPermitida,
  esDireccionDesplazamiento,
  esEtiquetaSensible,
  indiceDeControl,
  normalizarUrl,
  urlDeBusqueda,
} from '../electron/main/herramientas-definicion.js';

describe('herramientas del escritorio', () => {
  it('declara las herramientas acotadas del escritorio y el navegador', () => {
    const nombres = HERRAMIENTAS_LIVE[0].functionDeclarations.map((f) => f.name);
    expect(nombres).toEqual([
      'abrir_url',
      'buscar_web',
      'abrir_aplicacion',
      'abrir_carpeta',
      'inspeccionar_pagina',
      'hacer_click',
      'escribir_en_pagina',
      'desplazar_pagina',
      'navegar_pagina',
    ]);
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

  it('valida controles y acciones del navegador', () => {
    expect(indiceDeControl('qh-1')).toBe(0);
    expect(indiceDeControl('qh-80')).toBe(79);
    expect(() => indiceDeControl('button-1')).toThrow(/identificador/);
    expect(esDireccionDesplazamiento('abajo')).toBe(true);
    expect(esDireccionDesplazamiento('izquierda')).toBe(false);
    expect(esAccionNavegacion('recargar')).toBe(true);
    expect(esAccionNavegacion('cerrar')).toBe(false);
  });

  it('detecta acciones web que requieren confirmación', () => {
    expect(esEtiquetaSensible('Comprar ahora')).toBe(true);
    expect(esEtiquetaSensible('Delete account')).toBe(true);
    expect(esEtiquetaSensible('Ver detalles')).toBe(false);
  });
});
