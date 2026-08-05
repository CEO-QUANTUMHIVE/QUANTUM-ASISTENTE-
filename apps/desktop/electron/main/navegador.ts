/**
 * Navegador web controlado por Quantum.
 *
 * El contenido remoto vive en una BrowserWindow separada, sandboxeada y sin
 * preload. El modelo nunca recibe JavaScript arbitrario: solamente puede usar
 * las operaciones acotadas de esta clase.
 *
 * Cómo encuentra los controles — y por qué antes andaba mal:
 *
 * La primera versión juntaba controles con un `querySelectorAll` de una lista
 * fija de selectores (`button`, `a[href]`, `[role="button"]`...). Esa lista es
 * ciega a un montón de cosas reales: un `<div onclick>`, un componente propio
 * que renderiza su botón adentro de Shadow DOM, un menú armado con
 * `role="menuitem"` en un tag cualquiera. El modelo "no veía" esos botones
 * porque literalmente no estaban en la lista.
 *
 * Ahora se usa el **árbol de accesibilidad** de Chromium (el mismo que lee un
 * lector de pantalla) vía CDP (`webContents.debugger`, que Electron ya trae —
 * no hace falta instalar nada). Ese árbol entiende roles ARIA y Shadow DOM
 * mucho mejor que cualquier selector hecho a mano, y es el mismo enfoque que
 * usan Playwright MCP y el resto de las herramientas de automatización de
 * navegador serias.
 *
 * El truco de seguridad se mantiene igual que antes: la acción real (clic,
 * escribir, `focus`) se ejecuta en un *mundo aislado* de Chromium
 * (`Page.createIsolatedWorld`), así la página nunca puede pisar
 * `Element.prototype.click` para hacerse la que recibió un clic que no
 * recibió.
 */

import { BrowserWindow, session, type Session } from 'electron';
import {
  esEtiquetaSensible,
  indiceDeControl,
  type AccionNavegacion,
  type DireccionDesplazamiento,
} from './herramientas-definicion.js';

const PARTICION = 'persist:quantum-navegador';
const MAXIMO_CONTROLES = 80;
const MUNDO_AISLADO_NOMBRE = 'quantum-navegador-aislado';

/** Roles de accesibilidad que cuentan como "se puede interactuar con esto". */
const ROLES_INTERACTIVOS = new Set([
  'button',
  'link',
  'textbox',
  'searchbox',
  'combobox',
  'checkbox',
  'radio',
  'switch',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'option',
  'slider',
  'spinbutton',
]);

const PATRON_SENSIBLE =
  '\\b(comprar|pagar|purchase|buy|checkout|place order|borrar|eliminar|delete|remove|publicar|publish|enviar|send|submit|confirmar|confirm|autorizar|authorize)\\b';

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

interface NodoAX {
  nodeId: string;
  ignored: boolean;
  role?: { value?: string };
  name?: { value?: string };
  backendDOMNodeId?: number;
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
}

interface DetalleElemento {
  tipo: string;
  etiqueta: string;
  placeholder: string;
  protegido: boolean;
  sensible: boolean;
}

function esUrlWeb(valor: string): boolean {
  try {
    const url = new URL(valor);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function esFocuseable(nodo: NodoAX): boolean {
  return nodo.properties?.some((p) => p.name === 'focusable' && p.value?.value === true) === true;
}

/** Código que corre con `this` puesto en el elemento resuelto, adentro del mundo aislado. */
const FUNCION_DETALLE = `function() {
  const limpiar = (v, max) => String(v || '').replace(/\\s+/g, ' ').trim().slice(0, max || 180);
  const attr = (nombre) => (this.getAttribute ? this.getAttribute(nombre) : null);
  const tipoInput = limpiar(attr('type')).toLowerCase();
  const autocompletar = limpiar(attr('autocomplete')).toLowerCase();
  const etiqueta = limpiar(attr('aria-label') || this.innerText || attr('title') || attr('alt') || attr('name') || attr('value'));
  const placeholder = limpiar(attr('placeholder'));
  const protegido = tipoInput === 'password' || tipoInput === 'file' ||
    autocompletar.includes('password') || autocompletar.startsWith('cc-');
  const sensible = new RegExp('${PATRON_SENSIBLE}', 'i').test(etiqueta);
  return {
    tipo: (this.tagName || '').toLowerCase() + (tipoInput ? ':' + tipoInput : ''),
    etiqueta,
    placeholder,
    protegido,
    sensible,
  };
}`;

const FUNCION_CLIC = `function() {
  this.scrollIntoView({ block: 'center', inline: 'center' });
  this.focus();
  this.click();
  return true;
}`;

const FUNCION_ESCRIBIR = `function(valor) {
  const tipo = String(this.getAttribute('type') || '').toLowerCase();
  const autocomplete = String(this.getAttribute('autocomplete') || '').toLowerCase();
  if (tipo === 'password' || tipo === 'file' || autocomplete.includes('password') || autocomplete.startsWith('cc-')) {
    return { ok: false, error: 'campo protegido' };
  }
  const admiteTexto = this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement || this.isContentEditable;
  if (!admiteTexto) return { ok: false, error: 'el control no admite texto' };
  this.scrollIntoView({ block: 'center', inline: 'center' });
  this.focus();
  if (this.isContentEditable) {
    this.textContent = valor;
  } else {
    const prototipo = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototipo, 'value')?.set?.call(this, valor);
  }
  this.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: valor }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
}`;

export class NavegadorQuantum {
  private ventana: BrowserWindow | null = null;
  private sesionConfigurada = false;
  /** `qh-N` (1-based) → backendNodeId de CDP. Se rearma en cada `inspeccionar`. */
  private controles: number[] = [];

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

  // --- CDP -----------------------------------------------------------------

  private async cdp<T = unknown>(metodo: string, params: Record<string, unknown> = {}): Promise<T> {
    const ventana = this.ventana;
    if (ventana === null || ventana.isDestroyed()) throw new Error('el Navegador Quantum no esta abierto');
    const depurador = ventana.webContents.debugger;
    if (!depurador.isAttached()) depurador.attach('1.3');
    return depurador.sendCommand(metodo, params) as Promise<T>;
  }

  /**
   * Un mundo aislado por llamada: crearlo de nuevo es barato y evita
   * arrastrar un `executionContextId` que quedó viejo porque la página
   * navegó a otro lado desde la última vez.
   */
  private async mundoAislado(): Promise<number> {
    const { frameTree } = await this.cdp<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree');
    const { executionContextId } = await this.cdp<{ executionContextId: number }>('Page.createIsolatedWorld', {
      frameId: frameTree.frame.id,
      worldName: MUNDO_AISLADO_NOMBRE,
    });
    return executionContextId;
  }

  /** Resuelve un `backendNodeId` de CDP a un objeto del mundo aislado, o `null` si ya no existe. */
  private async resolverEnMundoAislado(
    backendNodeId: number,
    mundo: number,
  ): Promise<{ objectId: string } | null> {
    try {
      const { object } = await this.cdp<{ object: { objectId: string } }>('DOM.resolveNode', {
        backendNodeId,
        executionContextId: mundo,
      });
      return object;
    } catch {
      return null;
    }
  }

  private async detalleDe(objectId: string): Promise<DetalleElemento | null> {
    try {
      const { result } = await this.cdp<{ result: { value: DetalleElemento } }>('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: FUNCION_DETALLE,
        returnByValue: true,
      });
      return result.value;
    } catch {
      return null;
    }
  }

  /** Todos los nodos de accesibilidad con rol interactivo, visibles u ocultos. */
  private async candidatosAX(): Promise<NodoAX[]> {
    await this.cdp('DOM.enable');
    await this.cdp('Accessibility.enable');
    const { nodes } = await this.cdp<{ nodes: NodoAX[] }>('Accessibility.getFullAXTree', {});
    return nodes.filter((nodo) => {
      if (nodo.ignored || nodo.backendDOMNodeId === undefined) return false;
      const rol = nodo.role?.value ?? '';
      if (ROLES_INTERACTIVOS.has(rol)) return true;
      return rol !== 'generic' && rol !== '' && esFocuseable(nodo);
    });
  }

  // --- acciones --------------------------------------------------------------

  async abrir(url: string): Promise<string> {
    if (!esUrlWeb(url)) throw new Error('solo se permiten direcciones http o https');
    const ventana = this.obtenerVentana();
    await ventana.loadURL(url);
    ventana.show();
    ventana.focus();
    return `Abrí ${url} en el Navegador Quantum.`;
  }

  async inspeccionar(): Promise<EstadoPagina> {
    this.obtenerVentana();
    const mundo = await this.mundoAislado();

    const { result: pagina } = await this.cdp<{ result: { value: { titulo: string; url: string; texto: string } } }>(
      'Runtime.evaluate',
      {
        contextId: mundo,
        returnByValue: true,
        expression:
          "(() => { const limpiar=(v,max)=>String(v||'').replace(/\\s+/g,' ').trim().slice(0,max); " +
          "return { titulo: limpiar(document.title,240), url: location.href, " +
          "texto: limpiar(document.body ? document.body.innerText : '', 4000) }; })()",
      },
    );

    const candidatos = await this.candidatosAX();
    this.controles = [];
    const controles: ControlPagina[] = [];

    for (const nodo of candidatos) {
      if (controles.length >= MAXIMO_CONTROLES) break;
      const backendNodeId = nodo.backendDOMNodeId as number;

      // Sin caja de layout (display:none, etc.) no es algo que se pueda tocar.
      try {
        await this.cdp('DOM.getBoxModel', { backendNodeId });
      } catch {
        continue;
      }

      const objeto = await this.resolverEnMundoAislado(backendNodeId, mundo);
      if (objeto === null) continue;
      const detalle = await this.detalleDe(objeto.objectId);
      if (detalle === null) continue;

      this.controles.push(backendNodeId);
      controles.push({
        id: `qh-${this.controles.length}`,
        tipo: detalle.tipo,
        etiqueta: detalle.protegido ? '[campo protegido]' : detalle.etiqueta || nodo.name?.value || '',
        placeholder: detalle.protegido ? '' : detalle.placeholder,
        sensible: detalle.sensible,
        protegido: detalle.protegido,
      });
    }

    return { ...pagina.value, controles };
  }

  /** Cuando el `qh-N` quedó viejo, busca por el texto entre los mismos candidatos de accesibilidad. */
  private async buscarPorTexto(respaldo: string, mundo: number): Promise<number | null> {
    if (!respaldo) return null;
    const candidatos = await this.candidatosAX();
    const limpiar = (v: string | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();
    const exacto = candidatos.find((n) => limpiar(n.name?.value) === respaldo);
    const parcial = exacto ?? candidatos.find((n) => limpiar(n.name?.value).includes(respaldo));
    if (parcial?.backendDOMNodeId === undefined) return null;
    // Confirma que de verdad se puede resolver antes de darlo por bueno.
    const objeto = await this.resolverEnMundoAislado(parcial.backendDOMNodeId, mundo);
    return objeto === null ? null : parcial.backendDOMNodeId;
  }

  async hacerClick(control: unknown, confirmado: boolean, textoRespaldo?: string): Promise<string> {
    const indice = indiceDeControl(control);
    const respaldo = (textoRespaldo ?? '').trim().slice(0, 180);
    const mundo = await this.mundoAislado();

    let backendNodeId = this.controles[indice];
    let porRespaldo = false;
    let objeto = backendNodeId === undefined ? null : await this.resolverEnMundoAislado(backendNodeId, mundo);

    if (objeto === null) {
      const encontrado = await this.buscarPorTexto(respaldo, mundo);
      if (encontrado === null) {
        throw new Error('el control cambio y no encontre nada parecido; inspecciona la pagina nuevamente');
      }
      backendNodeId = encontrado;
      porRespaldo = true;
      objeto = await this.resolverEnMundoAislado(backendNodeId, mundo);
      if (objeto === null) throw new Error('el control cambio; inspecciona la pagina nuevamente');
    }

    const detalle = await this.detalleDe(objeto.objectId);
    if (detalle === null) throw new Error('el control cambio; inspecciona la pagina nuevamente');
    if (detalle.protegido) throw new Error('no se puede interactuar con un campo protegido');
    if ((detalle.sensible || esEtiquetaSensible(detalle.etiqueta)) && !confirmado) {
      throw new Error(`CONFIRMACION_REQUERIDA: ${detalle.etiqueta || String(control)}`);
    }

    const { result } = await this.cdp<{ result: { value: boolean } }>('Runtime.callFunctionOn', {
      objectId: objeto.objectId,
      functionDeclaration: FUNCION_CLIC,
      returnByValue: true,
      userGesture: true,
    });
    if (result.value !== true) throw new Error('el control cambio; inspecciona la pagina nuevamente');

    return porRespaldo
      ? `El identificador había cambiado; encontré "${detalle.etiqueta || respaldo}" por el texto y le hice clic.`
      : `Hice clic en ${detalle.etiqueta || String(control)}.`;
  }

  async escribir(control: unknown, texto: string, etiquetaRespaldo?: string): Promise<string> {
    const indice = indiceDeControl(control);
    const contenido = texto.slice(0, 2000);
    const respaldo = (etiquetaRespaldo ?? '').trim().slice(0, 180);
    const mundo = await this.mundoAislado();

    let backendNodeId = this.controles[indice];
    let porRespaldo = false;
    let objeto = backendNodeId === undefined ? null : await this.resolverEnMundoAislado(backendNodeId, mundo);

    if (objeto === null) {
      const encontrado = await this.buscarPorTexto(respaldo, mundo);
      if (encontrado === null) throw new Error('el control cambio y no encontre un campo parecido');
      backendNodeId = encontrado;
      porRespaldo = true;
      objeto = await this.resolverEnMundoAislado(backendNodeId, mundo);
      if (objeto === null) throw new Error('el control cambio; inspecciona la pagina nuevamente');
    }

    const detalle = await this.detalleDe(objeto.objectId);
    if (detalle === null) throw new Error('el control cambio; inspecciona la pagina nuevamente');
    if (detalle.protegido) throw new Error('campo protegido');

    const { result } = await this.cdp<{ result: { value: { ok: boolean; error?: string } } }>(
      'Runtime.callFunctionOn',
      {
        objectId: objeto.objectId,
        functionDeclaration: FUNCION_ESCRIBIR,
        arguments: [{ value: contenido }],
        returnByValue: true,
        userGesture: true,
      },
    );
    if (!result.value.ok) throw new Error(result.value.error ?? 'no se pudo escribir en el control');

    return porRespaldo
      ? `El identificador había cambiado; encontré el campo "${detalle.etiqueta || respaldo}" por su etiqueta y escribí ahí.`
      : `Escribí en ${detalle.etiqueta || String(control)}.`;
  }

  async desplazar(direccion: DireccionDesplazamiento): Promise<string> {
    const mundo = await this.mundoAislado();
    const codigo =
      direccion === 'inicio'
        ? `window.scrollTo({ top: 0, behavior: 'smooth' })`
        : direccion === 'fin'
          ? `window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })`
          : `window.scrollBy({ top: ${direccion === 'abajo' ? 1 : -1} * Math.max(420, window.innerHeight * 0.78), behavior: 'smooth' })`;
    await this.cdp('Runtime.evaluate', {
      contextId: mundo,
      userGesture: true,
      expression: `(() => { ${codigo}; return true; })()`,
    });
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
