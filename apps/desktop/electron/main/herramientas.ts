/** Ejecuta en Windows las herramientas declaradas a Gemini Live. */

import { spawn } from 'node:child_process';
import { app, shell } from 'electron';
import {
  esAccionNavegacion,
  esAplicacionPermitida,
  esCarpetaPermitida,
  esDireccionDesplazamiento,
  normalizarUrl,
  textoRequerido,
  urlDeBusqueda,
  type AplicacionPermitida,
  type CarpetaPermitida,
  type LlamadaHerramienta,
  type RespuestaHerramienta,
} from './herramientas-definicion.js';
import type { NavegadorQuantum } from './navegador.js';

function lanzar(programa: string): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const proceso = spawn(programa, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      shell: false,
    });
    proceso.once('spawn', () => {
      proceso.unref();
      resolver();
    });
    proceso.once('error', rechazar);
  });
}

async function abrirAplicacion(
  nombre: AplicacionPermitida,
  navegador: NavegadorQuantum,
): Promise<string> {
  switch (nombre) {
    case 'navegador':
      return navegador.abrir('https://www.google.com');
    case 'explorador':
      await lanzar('explorer.exe');
      return 'Abrí el Explorador de Windows.';
    case 'bloc_de_notas':
      await lanzar('notepad.exe');
      return 'Abrí el Bloc de notas.';
    case 'calculadora':
      await lanzar('calc.exe');
      return 'Abrí la Calculadora.';
    case 'paint':
      await lanzar('mspaint.exe');
      return 'Abrí Paint.';
    case 'configuracion':
      await shell.openExternal('ms-settings:');
      return 'Abrí la Configuración de Windows.';
  }
}

function rutaDeCarpeta(nombre: CarpetaPermitida): string {
  switch (nombre) {
    case 'escritorio':
      return app.getPath('desktop');
    case 'documentos':
      return app.getPath('documents');
    case 'descargas':
      return app.getPath('downloads');
    case 'imagenes':
      return app.getPath('pictures');
  }
}

async function abrirCarpeta(nombre: CarpetaPermitida): Promise<string> {
  const error = await shell.openPath(rutaDeCarpeta(nombre));
  if (error) throw new Error(error);
  return `Abrí la carpeta ${nombre}.`;
}

async function ejecutarUna(
  llamada: LlamadaHerramienta,
  navegador: NavegadorQuantum,
): Promise<RespuestaHerramienta> {
  try {
    const args = llamada.args ?? {};
    let output: string;

    switch (llamada.name) {
      case 'abrir_url': {
        const url = normalizarUrl(args['url']);
        output = await navegador.abrir(url);
        break;
      }
      case 'buscar_web': {
        const consulta = textoRequerido(args['consulta'], 'consulta');
        await navegador.abrir(urlDeBusqueda(consulta));
        output = `Abrí la búsqueda en el Navegador Quantum: ${consulta}`;
        break;
      }
      case 'abrir_aplicacion': {
        const nombre = args['aplicacion'];
        if (!esAplicacionPermitida(nombre)) throw new Error('esa aplicación no está permitida');
        output = await abrirAplicacion(nombre, navegador);
        break;
      }
      case 'abrir_carpeta': {
        const nombre = args['carpeta'];
        if (!esCarpetaPermitida(nombre)) throw new Error('esa carpeta no está permitida');
        output = await abrirCarpeta(nombre);
        break;
      }
      case 'inspeccionar_pagina': {
        output = JSON.stringify(await navegador.inspeccionar());
        break;
      }
      case 'hacer_click': {
        const textoRespaldo = typeof args['texto'] === 'string' ? args['texto'] : undefined;
        output = await navegador.hacerClick(args['control'], args['confirmado'] === true, textoRespaldo);
        break;
      }
      case 'escribir_en_pagina': {
        const texto = textoRequerido(args['texto'], 'texto', 2000);
        const etiquetaRespaldo = typeof args['etiqueta'] === 'string' ? args['etiqueta'] : undefined;
        output = await navegador.escribir(args['control'], texto, etiquetaRespaldo);
        break;
      }
      case 'desplazar_pagina': {
        const direccion = args['direccion'];
        if (!esDireccionDesplazamiento(direccion)) throw new Error('direccion no permitida');
        output = await navegador.desplazar(direccion);
        break;
      }
      case 'navegar_pagina': {
        const accion = args['accion'];
        if (!esAccionNavegacion(accion)) throw new Error('accion de navegacion no permitida');
        output = await navegador.navegar(accion);
        break;
      }
      default:
        throw new Error(`herramienta desconocida: ${llamada.name}`);
    }

    return { id: llamada.id, name: llamada.name, response: { output } };
  } catch (error) {
    return {
      id: llamada.id,
      name: llamada.name,
      response: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}

export async function ejecutarHerramientas(
  llamadas: LlamadaHerramienta[],
  navegador: NavegadorQuantum,
): Promise<RespuestaHerramienta[]> {
  const respuestas: RespuestaHerramienta[] = [];
  for (const llamada of llamadas) respuestas.push(await ejecutarUna(llamada, navegador));
  return respuestas;
}
