/**
 * Contrato de las acciones que Gemini Live puede pedirle al escritorio.
 *
 * La lista es deliberadamente corta. El modelo elige una herramienta y sus
 * argumentos, pero nunca recibe una consola ni una ruta ejecutable arbitraria.
 */

export const APLICACIONES_PERMITIDAS = [
  'navegador',
  'explorador',
  'bloc_de_notas',
  'calculadora',
  'paint',
  'configuracion',
] as const;

export const CARPETAS_PERMITIDAS = [
  'escritorio',
  'documentos',
  'descargas',
  'imagenes',
] as const;

export const DIRECCIONES_DESPLAZAMIENTO = ['arriba', 'abajo', 'inicio', 'fin'] as const;
export const ACCIONES_NAVEGACION = ['atras', 'adelante', 'recargar'] as const;

export type AplicacionPermitida = (typeof APLICACIONES_PERMITIDAS)[number];
export type CarpetaPermitida = (typeof CARPETAS_PERMITIDAS)[number];
export type DireccionDesplazamiento = (typeof DIRECCIONES_DESPLAZAMIENTO)[number];
export type AccionNavegacion = (typeof ACCIONES_NAVEGACION)[number];

export interface LlamadaHerramienta {
  id: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface RespuestaHerramienta {
  id: string;
  name: string;
  response: { output: string } | { error: string };
}

export const HERRAMIENTAS_LIVE = [
  {
    functionDeclarations: [
      {
        name: 'abrir_url',
        description:
          'Abre una URL en una pestaña del navegador predeterminado. Usar sólo cuando la persona lo pide explícitamente.',
        parameters: {
          type: 'OBJECT',
          properties: {
            url: {
              type: 'STRING',
              description: 'Dirección web http o https que se debe abrir.',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'buscar_web',
        description:
          'Abre una pestaña con una búsqueda web. Usar sólo cuando la persona pide buscar algo.',
        parameters: {
          type: 'OBJECT',
          properties: {
            consulta: {
              type: 'STRING',
              description: 'Texto exacto que la persona quiere buscar.',
            },
          },
          required: ['consulta'],
        },
      },
      {
        name: 'abrir_aplicacion',
        description:
          'Abre una aplicación segura de la lista. Si la persona pide otra aplicación, explicá que todavía no está habilitada.',
        parameters: {
          type: 'OBJECT',
          properties: {
            aplicacion: {
              type: 'STRING',
              enum: APLICACIONES_PERMITIDAS,
              description: 'Aplicación permitida que se debe abrir.',
            },
          },
          required: ['aplicacion'],
        },
      },
      {
        name: 'abrir_carpeta',
        description: 'Abre una carpeta personal conocida en el Explorador de Windows.',
        parameters: {
          type: 'OBJECT',
          properties: {
            carpeta: {
              type: 'STRING',
              enum: CARPETAS_PERMITIDAS,
              description: 'Carpeta conocida que se debe abrir.',
            },
          },
          required: ['carpeta'],
        },
      },
      {
        name: 'inspeccionar_pagina',
        description:
          'Lee el titulo, la URL, el texto visible y los controles numerados de la pagina abierta en el Navegador Quantum. Usar antes de hacer clic o escribir; nunca adivinar identificadores.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'hacer_click',
        description:
          'Hace clic en un control devuelto por inspeccionar_pagina. Para comprar, pagar, borrar, publicar, enviar o confirmar una accion sensible, primero hay que pedir confirmacion al usuario y luego enviar confirmado=true.',
        parameters: {
          type: 'OBJECT',
          properties: {
            control: {
              type: 'STRING',
              description: 'Identificador exacto del control, por ejemplo qh-3.',
            },
            confirmado: {
              type: 'BOOLEAN',
              description: 'Verdadero solamente si el usuario confirmo expresamente la accion sensible.',
            },
          },
          required: ['control'],
        },
      },
      {
        name: 'escribir_en_pagina',
        description:
          'Escribe texto en un campo devuelto por inspeccionar_pagina. Nunca se habilita para contrasenas, tarjetas, archivos ni otros campos protegidos.',
        parameters: {
          type: 'OBJECT',
          properties: {
            control: {
              type: 'STRING',
              description: 'Identificador exacto del campo, por ejemplo qh-5.',
            },
            texto: {
              type: 'STRING',
              description: 'Texto solicitado por el usuario.',
            },
          },
          required: ['control', 'texto'],
        },
      },
      {
        name: 'desplazar_pagina',
        description: 'Desplaza la pagina del Navegador Quantum.',
        parameters: {
          type: 'OBJECT',
          properties: {
            direccion: {
              type: 'STRING',
              enum: DIRECCIONES_DESPLAZAMIENTO,
              description: 'Direccion del desplazamiento.',
            },
          },
          required: ['direccion'],
        },
      },
      {
        name: 'navegar_pagina',
        description: 'Navega hacia atras, adelante o recarga la pagina actual.',
        parameters: {
          type: 'OBJECT',
          properties: {
            accion: {
              type: 'STRING',
              enum: ACCIONES_NAVEGACION,
              description: 'Accion de navegacion solicitada.',
            },
          },
          required: ['accion'],
        },
      },
    ],
  },
] as const;

export function textoRequerido(valor: unknown, nombre: string, maximo = 500): string {
  if (typeof valor !== 'string' || !valor.trim()) throw new Error(`falta ${nombre}`);
  const texto = valor.trim();
  if (texto.length > maximo) throw new Error(`${nombre} es demasiado largo`);
  return texto;
}

export function normalizarUrl(valor: unknown): string {
  const texto = textoRequerido(valor, 'url', 2048);
  const conEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(texto) ? texto : `https://${texto}`;
  const url = new URL(conEsquema);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('sólo se permiten direcciones http o https');
  }
  if (!url.hostname) throw new Error('la dirección no tiene un dominio');
  if (url.username || url.password) throw new Error('la dirección no puede incluir credenciales');
  return url.toString();
}

export function urlDeBusqueda(valor: unknown): string {
  const consulta = textoRequerido(valor, 'consulta');
  return `https://www.google.com/search?q=${encodeURIComponent(consulta)}`;
}

export function esAplicacionPermitida(valor: unknown): valor is AplicacionPermitida {
  return typeof valor === 'string' && APLICACIONES_PERMITIDAS.includes(valor as AplicacionPermitida);
}

export function esCarpetaPermitida(valor: unknown): valor is CarpetaPermitida {
  return typeof valor === 'string' && CARPETAS_PERMITIDAS.includes(valor as CarpetaPermitida);
}

export function esDireccionDesplazamiento(valor: unknown): valor is DireccionDesplazamiento {
  return (
    typeof valor === 'string' &&
    DIRECCIONES_DESPLAZAMIENTO.includes(valor as DireccionDesplazamiento)
  );
}

export function esAccionNavegacion(valor: unknown): valor is AccionNavegacion {
  return typeof valor === 'string' && ACCIONES_NAVEGACION.includes(valor as AccionNavegacion);
}

export function indiceDeControl(valor: unknown): number {
  const control = textoRequerido(valor, 'control', 20);
  const coincidencia = /^qh-([1-9]\d{0,2})$/.exec(control);
  if (!coincidencia) throw new Error('el identificador de control no es valido');
  return Number(coincidencia[1]) - 1;
}

export function esEtiquetaSensible(valor: unknown): boolean {
  if (typeof valor !== 'string') return false;
  return /\b(comprar|pagar|purchase|buy|checkout|place order|borrar|eliminar|delete|remove|publicar|publish|enviar|send|submit|confirmar|confirm|autorizar|authorize)\b/i.test(
    valor,
  );
}
