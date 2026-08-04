/**
 * Navegador web controlado por Quantum.
 *
 * El contenido remoto vive en una BrowserWindow separada, sandboxeada y sin
 * preload. El modelo nunca recibe JavaScript arbitrario: solamente puede usar
 * las operaciones acotadas de esta clase.
 */

import { BrowserWindow, session, type Session } from 'electron';
import {
  esEtiquetaSensible,
  indiceDeControl,
  type AccionNavegacion,
  type DireccionDesplazamiento,
} from './herramientas-definicion.js';

const PARTICION = 'persist:quantum-navegador';
const MUNDO_AISLADO = 1099;
const MAXIMO_CONTROLES = 80;

interface ControlPagina {
  id: string;
  tipo: string;
  etiqueta: string;
  placeholder: string;
  sensible: boolean;
  protegido: boolean;
}

export interface EstadoPagina {
  titulo: string;
  url: string;
  texto: string;
  controles: ControlPagina[];
}

function esUrlWeb(valor: string): boolean {
  try {
    const url = new URL(valor);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function codigoInspeccion(): string {
  return `(() => {
    const visible = (elemento) => {
      const estilo = getComputedStyle(elemento);
      const rect = elemento.getBoundingClientRect();
      return estilo.visibility !== 'hidden' && estilo.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const limpiar = (valor, maximo = 180) => String(valor || '').replace(/\\s+/g, ' ').trim().slice(0, maximo);
    const selector = [
      'a[href]', 'button', 'input:not([type="hidden"])', 'textarea', 'select',
      '[role="button"]', '[role="link"]', '[role="textbox"]', '[contenteditable="true"]'
    ].join(',');
    const elementos = Array.from(document.querySelectorAll(selector)).filter(visible).slice(0, ${MAXIMO_CONTROLES});
    globalThis.__quantumControls = elementos;
    const controles = elementos.map((elemento, indice) => {
      const tipoInput = limpiar(elemento.getAttribute('type')).toLowerCase();
      const autocompletar = limpiar(elemento.getAttribute('autocomplete')).toLowerCase();
      const etiqueta = limpiar(
        elemento.getAttribute('aria-label') || elemento.innerText || elemento.getAttribute('title') ||
        elemento.getAttribute('alt') || elemento.getAttribute('name') || elemento.getAttribute('value')
      );
      const placeholder = limpiar(elemento.getAttribute('placeholder'));
      const protegido = tipoInput === 'password' || tipoInput === 'file' ||
        autocompletar.includes('password') || autocompletar.startsWith('cc-');
      const sensible = /\\b(comprar|pagar|purchase|buy|checkout|place order|borrar|eliminar|delete|remove|publicar|publish|enviar|send|submit|confirmar|confirm|autorizar|authorize)\\b/i.test(etiqueta);
      return {
        id: 'qh-' + (indice + 1),
        tipo: limpiar(elemento.tagName.toLowerCase() + (tipoInput ? ':' + tipoInput : '')),
        etiqueta: protegido ? '[campo protegido]' : etiqueta,
        placeholder: protegido ? '' : placeholder,
        sensible,
        protegido,
      };
    });
    return {
      titulo: limpiar(document.title, 240),
      url: location.href,
      texto: limpiar(document.body ? document.body.innerText : '', 4000),
      controles,
    };
  })()`;
}

export class NavegadorQuantum {
  private ventana: BrowserWindow | null = null;
  private sesionConfigurada = false;

  private configurarSesion(sesionWeb: Session): void {
    if (this.sesionConfigurada) return;
    this.sesionConfigurada = true;
    sesionWeb.setPermissionRequestHandler((_contenido, _permiso, responder) => responder(false));
    sesionWeb.setPermissionCheckHandler(() => false);
    sesionWeb.on('will-download', (evento) => evento.preventDefault());
  }

  private crearVentana(): BrowserWindow {
    const sesionWeb = session.fromPartition(PARTICION);
    this.configurarSesion(sesionWeb);

    const ventana = new BrowserWindow({
      width: 1200,
      height: 820,
      minWidth: 720,
      minHeight: 520,
      title: 'Navegador Quantum',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition: PARTICION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });

    ventana.webContents.setWindowOpenHandler(({ url }) => {
      if (esUrlWeb(url)) void this.abrir(url);
      return { action: 'deny' };
    });
    ventana.webContents.on('will-navigate', (evento, url) => {
      if (!esUrlWeb(url)) evento.preventDefault();
    });
    ventana.webContents.on('will-redirect', (evento, url) => {
      if (!esUrlWeb(url)) evento.preventDefault();
    });
    ventana.webContents.on('will-attach-webview', (evento) => evento.preventDefault());
    ventana.on('closed', () => {
      if (this.ventana === ventana) this.ventana = null;
    });
    ventana.once('ready-to-show', () => ventana.show());
    return ventana;
  }

  private obtenerVentana(): BrowserWindow {
    if (this.ventana === null || this.ventana.isDestroyed()) this.ventana = this.crearVentana();
    return this.ventana;
  }

  private async ejecutar<T>(codigo: string, gestoUsuario = false): Promise<T> {
    const ventana = this.ventana;
    if (ventana === null || ventana.isDestroyed()) throw new Error('el Navegador Quantum no esta abierto');
    return ventana.webContents.executeJavaScriptInIsolatedWorld(
      MUNDO_AISLADO,
      [{ code: codigo }],
      gestoUsuario,
    ) as Promise<T>;
  }

  async abrir(url: string): Promise<string> {
    if (!esUrlWeb(url)) throw new Error('solo se permiten direcciones http o https');
    const ventana = this.obtenerVentana();
    await ventana.loadURL(url);
    ventana.show();
    ventana.focus();
    return `Abrí ${url} en el Navegador Quantum.`;
  }

  async inspeccionar(): Promise<EstadoPagina> {
    return this.ejecutar<EstadoPagina>(codigoInspeccion());
  }

  async hacerClick(control: unknown, confirmado: boolean, textoRespaldo?: string): Promise<string> {
    const indice = indiceDeControl(control);
    const respaldo = (textoRespaldo ?? '').trim().slice(0, 180);
    const datos = await this.ejecutar<{
      existe: boolean;
      etiqueta: string;
      sensible: boolean;
      protegido: boolean;
      porRespaldo: boolean;
    }>(`(() => {
      const limpiar = (valor) => String(valor || '').replace(/\\s+/g, ' ').trim();
      const sensiblePatron = /\\b(comprar|pagar|purchase|buy|checkout|place order|borrar|eliminar|delete|remove|publicar|publish|enviar|send|submit|confirmar|confirm|autorizar|authorize)\\b/i;
      const describir = (elemento, porRespaldo) => {
        const etiqueta = limpiar(elemento.getAttribute('aria-label') || elemento.innerText || elemento.getAttribute('value')).slice(0, 180);
        const tipo = String(elemento.getAttribute('type') || '').toLowerCase();
        const autocomplete = String(elemento.getAttribute('autocomplete') || '').toLowerCase();
        return {
          existe: true,
          etiqueta,
          sensible: sensiblePatron.test(etiqueta),
          protegido: tipo === 'password' || tipo === 'file' || autocomplete.includes('password') || autocomplete.startsWith('cc-'),
          porRespaldo,
        };
      };
      let elemento = globalThis.__quantumControls?.[${indice}];
      if (elemento && elemento.isConnected) {
        globalThis.__quantumClickObjetivo = elemento;
        return describir(elemento, false);
      }
      const respaldo = ${JSON.stringify(respaldo)};
      if (!respaldo) return { existe: false, etiqueta: '', sensible: false, protegido: false, porRespaldo: false };
      const candidatos = Array.from(globalThis.__quantumControls || []).filter((elemento) => elemento && elemento.isConnected);
      elemento = candidatos.find((elemento) => limpiar(elemento.getAttribute('aria-label') || elemento.innerText || elemento.getAttribute('value')) === respaldo)
        || candidatos.find((elemento) => limpiar(elemento.getAttribute('aria-label') || elemento.innerText || elemento.getAttribute('value')).includes(respaldo));
      if (!elemento) return { existe: false, etiqueta: '', sensible: false, protegido: false, porRespaldo: false };
      globalThis.__quantumClickObjetivo = elemento;
      return describir(elemento, true);
    })()`);

    if (!datos.existe) throw new Error('el control cambio y no encontre nada parecido; inspecciona la pagina nuevamente');
    if (datos.protegido) throw new Error('no se puede interactuar con un campo protegido');
    if ((datos.sensible || esEtiquetaSensible(datos.etiqueta)) && !confirmado) {
      throw new Error(`CONFIRMACION_REQUERIDA: ${datos.etiqueta || String(control)}`);
    }

    const resultado = await this.ejecutar<{ ok: boolean }>(`(() => {
      const elemento = globalThis.__quantumClickObjetivo;
      if (!elemento || !elemento.isConnected) return { ok: false };
      elemento.scrollIntoView({ block: 'center', inline: 'center' });
      elemento.focus();
      elemento.click();
      return { ok: true };
    })()`, true);
    if (!resultado.ok) throw new Error('el control cambio; inspecciona la pagina nuevamente');
    return datos.porRespaldo
      ? `El identificador había cambiado; encontré "${datos.etiqueta || respaldo}" por el texto y le hice clic.`
      : `Hice clic en ${datos.etiqueta || String(control)}.`;
  }

  async escribir(control: unknown, texto: string, etiquetaRespaldo?: string): Promise<string> {
    const indice = indiceDeControl(control);
    const contenido = texto.slice(0, 2000);
    const respaldo = (etiquetaRespaldo ?? '').trim().slice(0, 180);
    const resultado = await this.ejecutar<{ ok: boolean; error?: string; etiqueta?: string; porRespaldo?: boolean }>(`(() => {
      const limpiar = (valor) => String(valor || '').replace(/\\s+/g, ' ').trim();
      const describe = (elemento) => limpiar(
        elemento.getAttribute('aria-label') || elemento.getAttribute('placeholder') || elemento.getAttribute('name') || ''
      );
      let elemento = globalThis.__quantumControls?.[${indice}];
      let porRespaldo = false;
      if (!elemento || !elemento.isConnected) {
        const respaldo = ${JSON.stringify(respaldo)};
        if (!respaldo) return { ok: false, error: 'el control cambio' };
        const selector = 'input:not([type="hidden"]), textarea, [contenteditable="true"]';
        const candidatos = Array.from(document.querySelectorAll(selector)).filter((elemento) => {
          const estilo = getComputedStyle(elemento);
          const rect = elemento.getBoundingClientRect();
          return estilo.visibility !== 'hidden' && estilo.display !== 'none' && rect.width > 0 && rect.height > 0;
        });
        elemento = candidatos.find((candidato) => describe(candidato) === respaldo)
          || candidatos.find((candidato) => describe(candidato).includes(respaldo));
        if (!elemento) return { ok: false, error: 'el control cambio y no encontre un campo parecido' };
        porRespaldo = true;
      }
      const tipo = String(elemento.getAttribute('type') || '').toLowerCase();
      const autocomplete = String(elemento.getAttribute('autocomplete') || '').toLowerCase();
      if (tipo === 'password' || tipo === 'file' || autocomplete.includes('password') || autocomplete.startsWith('cc-')) {
        return { ok: false, error: 'campo protegido' };
      }
      const admiteTexto = elemento instanceof HTMLInputElement || elemento instanceof HTMLTextAreaElement || elemento.isContentEditable;
      if (!admiteTexto) return { ok: false, error: 'el control no admite texto' };
      const valor = ${JSON.stringify(contenido)};
      elemento.scrollIntoView({ block: 'center', inline: 'center' });
      elemento.focus();
      if (elemento.isContentEditable) {
        elemento.textContent = valor;
      } else {
        const prototipo = elemento instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototipo, 'value');
        descriptor?.set?.call(elemento, valor);
      }
      elemento.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: valor }));
      elemento.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        ok: true,
        etiqueta: String(elemento.getAttribute('aria-label') || elemento.getAttribute('name') || elemento.getAttribute('placeholder') || '').slice(0, 120),
        porRespaldo,
      };
    })()`, true);
    if (!resultado.ok) throw new Error(resultado.error ?? 'no se pudo escribir en el control');
    return resultado.porRespaldo
      ? `El identificador había cambiado; encontré el campo "${resultado.etiqueta || respaldo}" por su etiqueta y escribí ahí.`
      : `Escribí en ${resultado.etiqueta || String(control)}.`;
  }

  async desplazar(direccion: DireccionDesplazamiento): Promise<string> {
    const codigo =
      direccion === 'inicio'
        ? `window.scrollTo({ top: 0, behavior: 'smooth' })`
        : direccion === 'fin'
          ? `window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })`
          : `window.scrollBy({ top: ${direccion === 'abajo' ? 1 : -1} * Math.max(420, window.innerHeight * 0.78), behavior: 'smooth' })`;
    await this.ejecutar(`(() => { ${codigo}; return true; })()`, true);
    return `Desplacé la página hacia ${direccion}.`;
  }

  async navegar(accion: AccionNavegacion): Promise<string> {
    const ventana = this.ventana;
    if (ventana === null || ventana.isDestroyed()) throw new Error('el Navegador Quantum no esta abierto');
    const historial = ventana.webContents.navigationHistory;
    if (accion === 'atras') {
      if (!historial.canGoBack()) throw new Error('no hay una pagina anterior');
      historial.goBack();
    } else if (accion === 'adelante') {
      if (!historial.canGoForward()) throw new Error('no hay una pagina siguiente');
      historial.goForward();
    } else {
      ventana.webContents.reload();
    }
    return `Navegación ejecutada: ${accion}.`;
  }

  cerrar(): void {
    if (this.ventana && !this.ventana.isDestroyed()) this.ventana.close();
    this.ventana = null;
  }
}
