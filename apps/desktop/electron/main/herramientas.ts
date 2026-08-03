/** Ejecuta en Windows las herramientas declaradas a Gemini Live. */

import { spawn } from 'node:child_process';
import { app, shell } from 'electron';
import {
  esAplicacionPermitida,
  esCarpetaPermitida,
  normalizarUrl,
  textoRequerido,
  urlDeBusqueda,
  type AplicacionPermitida,
  type CarpetaPermitida,
  type LlamadaHerramienta,
  type RespuestaHerramienta,
} from './herramientas-definicion.js';

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

async function abrirAplicacion(nombre: AplicacionPermitida): Promise<string> {
  switch (nombre) {
    case 'navegador':
      await shell.openExternal('https://www.google.com');
      return 'Abrí el navegador predeterminado.';
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

async function ejecutarUna(llamada: LlamadaHerramienta): Promise<RespuestaHerramienta> {
  try {
    const args = llamada.args ?? {};
    let output: string;

    switch (llamada.name) {
      case 'abrir_url': {
        const url = normalizarUrl(args['url']);
        await shell.openExternal(url);
        output = `Abrí ${url}`;
        break;
      }
      case 'buscar_web': {
        const consulta = textoRequerido(args['consulta'], 'consulta');
        await shell.openExternal(urlDeBusqueda(consulta));
        output = `Abrí la búsqueda: ${consulta}`;
        break;
      }
      case 'abrir_aplicacion': {
        const nombre = args['aplicacion'];
        if (!esAplicacionPermitida(nombre)) throw new Error('esa aplicación no está permitida');
        output = await abrirAplicacion(nombre);
        break;
      }
      case 'abrir_carpeta': {
        const nombre = args['carpeta'];
        if (!esCarpetaPermitida(nombre)) throw new Error('esa carpeta no está permitida');
        output = await abrirCarpeta(nombre);
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
): Promise<RespuestaHerramienta[]> {
  const respuestas: RespuestaHerramienta[] = [];
  for (const llamada of llamadas) respuestas.push(await ejecutarUna(llamada));
  return respuestas;
}
