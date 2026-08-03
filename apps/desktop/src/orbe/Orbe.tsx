import type { JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Microfono, Reproductor } from './audio.js';

/** Espejo de `electron/canales.ts`. `escuchando` no está: lo lleva el orbe. */
interface EstadoOrbe {
  sesion: 'cerrada' | 'conectando' | 'lista' | 'error';
  observando: boolean;
  hablando: boolean;
  frenado: boolean;
  expandido: boolean;
  fuente: string | null;
  ventana: string | null;
  detalle?: string;
}

interface Fuente {
  source_id: string;
  name: string;
  kind: string;
}

interface Turno {
  id: string;
  quien: 'yo' | 'copiloto';
  texto: string;
  cerrado: boolean;
}

const ESTADO_INICIAL: EstadoOrbe = {
  sesion: 'cerrada',
  observando: false,
  hablando: false,
  frenado: false,
  expandido: false,
  fuente: null,
  ventana: null,
};

export function Orbe(): JSX.Element {
  const qh = useMemo(() => (window as Partial<Window>).qh ?? null, []);
  const [estado, setEstado] = useState<EstadoOrbe>(ESTADO_INICIAL);
  // Aparte del estado que manda el proceso principal, y a propósito: si
  // viviera adentro de `estado`, el próximo `setEstado` que llegue de allá
  // —uno por cada vez que el modelo empieza o termina de hablar— lo pisaría, y
  // la luz del micrófono se apagaría con el micrófono todavía abierto.
  const [escuchando, setEscuchando] = useState(false);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [borrador, setBorrador] = useState('');
  const [fuentes, setFuentes] = useState<Fuente[]>([]);
  const [aviso, setAviso] = useState<string | null>(null);

  const microfono = useRef(new Microfono());
  const reproductor = useRef(new Reproductor());
  const registro = useRef<HTMLDivElement>(null);

  /**
   * Agrega texto al último turno del copiloto, o abre uno nuevo.
   * La transcripción llega en fragmentos, así que se van pegando.
   */
  const agregar = useCallback((quien: Turno['quien'], fragmento: string) => {
    setTurnos((actuales) => {
      const ultimo = actuales.at(-1);
      if (ultimo && ultimo.quien === quien && !ultimo.cerrado) {
        return [...actuales.slice(0, -1), { ...ultimo, texto: ultimo.texto + fragmento }];
      }
      return [...actuales, { id: crypto.randomUUID(), quien, texto: fragmento, cerrado: false }];
    });
  }, []);

  const cerrarTurno = useCallback(() => {
    setTurnos((actuales) => {
      const ultimo = actuales.at(-1);
      if (!ultimo || ultimo.cerrado) return actuales;
      return [...actuales.slice(0, -1), { ...ultimo, cerrado: true }];
    });
  }, []);

  useEffect(() => {
    if (qh === null) return;

    void qh.estadoActual().then(setEstado);
    void qh.listarFuentes().then(setFuentes);

    const bajas = [
      qh.alEstado(setEstado),
      qh.alTexto((f) => agregar('copiloto', f)),
      qh.alTranscripcion((t) => agregar('yo', t)),
      qh.alAudio((pcm) => reproductor.current.encolar(new Uint8Array(pcm))),
      qh.alTurnoFin(cerrarTurno),
      qh.alInterrumpido(() => {
        // El usuario habló encima: lo que quedaba en la cola ya no vale.
        reproductor.current.vaciar();
        cerrarTurno();
      }),
      qh.alDesconexionInactividad((detalle) => {
        if (detalle.startsWith('Cerré')) {
          microfono.current.parar();
          reproductor.current.vaciar();
          setEscuchando(false);
        }
        setAviso(detalle);
      }),
      qh.alError((detalle) => setAviso(detalle)),
    ];

    return () => bajas.forEach((baja) => baja());
  }, [qh, agregar, cerrarTurno]);

  useEffect(() => {
    registro.current?.scrollTo({ top: registro.current.scrollHeight, behavior: 'smooth' });
  }, [turnos]);

  // El freno también llega por Ctrl+Shift+F12 y desde la bandeja, que no pasan
  // por el botón ■. Sin esto, en esos dos casos el micrófono queda abierto: el
  // audio se descarta del otro lado, pero el sistema sigue mostrando el
  // indicador de grabación y el usuario cree que frenó.
  useEffect(() => {
    if (!estado.frenado) return;
    microfono.current.parar();
    reproductor.current.vaciar();
    setEscuchando(false);
  }, [estado.frenado]);

  // Sale del estado que manda el proceso principal, no de una copia local: él
  // es el que redimensiona la ventana, así que él sabe. Con dos copias, el
  // tamaño de la ventana y lo que se dibuja adentro se desincronizan apenas
  // algo redimensiona sin pasar por el click del usuario.
  const abierto = estado.expandido;

  const alternarPanel = useCallback(() => {
    const proximo = !estado.expandido;
    void qh?.expandir(proximo);
    if (proximo && estado.sesion === 'cerrada') void qh?.conectar();
  }, [qh, estado.expandido, estado.sesion]);

  const alternarMicrofono = useCallback(async () => {
    if (qh === null) return;
    if (microfono.current.activo) {
      microfono.current.parar();
      setEscuchando(false);
      return;
    }
    try {
      // `conectar()` no vuelve hasta que la sesión está lista de verdad, así
      // que lo que se diga apenas se abra el micrófono llega. Antes volvía con
      // el socket recién creado y las primeras palabras se descartaban.
      if (estado.sesion !== 'lista') await qh.conectar();
      await microfono.current.arrancar((pcm) => qh.enviarAudio(pcm));
      setEscuchando(true);
      setAviso(null);
    } catch (error) {
      setAviso(
        error instanceof Error && error.name === 'NotAllowedError'
          ? 'No me diste permiso para usar el micrófono.'
          : `No pude abrir el micrófono: ${error instanceof Error ? error.message : error}`,
      );
    }
  }, [qh, estado.sesion]);

  const alternarVision = useCallback(async () => {
    if (qh === null) return;
    if (!estado.observando && estado.fuente === null) {
      setAviso('Elegí primero qué ventana querés que mire.');
      void qh.expandir(true);
      return;
    }
    await qh.vision(!estado.observando);
  }, [qh, estado.observando, estado.fuente]);

  const enviar = useCallback(async () => {
    const texto = borrador.trim();
    if (!texto || qh === null) return;
    if (estado.sesion !== 'lista') await qh.conectar();
    agregar('yo', texto);
    cerrarTurno();
    setBorrador('');
    await qh.enviarTexto(texto);
  }, [borrador, qh, estado.sesion, agregar, cerrarTurno]);

  // Sólo avisa: el `useEffect` de arriba es el que cierra el micrófono, y así
  // hace lo mismo venga de este botón, del atajo o de la bandeja.
  const frenar = useCallback(async () => {
    await qh?.frenar(!estado.frenado);
  }, [qh, estado.frenado]);

  const visual = estadoVisual(estado, escuchando, qh === null);

  return (
    <div className={`orbe ${abierto ? 'orbe--abierto' : ''}`} data-estado={visual}>
      <div className="orbe__cabecera qh-drag">
        <button
          className="orbe__esfera qh-no-drag"
          onClick={alternarPanel}
          title={TITULOS[visual]}
          aria-label={TITULOS[visual]}
        >
          <span className="orbe__marca">{qh === null ? '!' : 'QH'}</span>
        </button>

        {abierto ? (
          <div className="orbe__acciones qh-no-drag">
            <button
              className="orbe__boton"
              data-on={escuchando}
              onClick={() => void alternarMicrofono()}
              title={escuchando ? 'Cortar el micrófono' : 'Hablar'}
            >
              🎙
            </button>
            <button
              className="orbe__boton"
              data-on={estado.observando}
              onClick={() => void alternarVision()}
              title={estado.observando ? 'Dejar de mirar' : 'Mirar la pantalla'}
            >
              👁
            </button>
            <button
              className="orbe__boton orbe__boton--freno"
              data-on={estado.frenado}
              onClick={() => void frenar()}
              title={estado.frenado ? 'Reanudar' : 'Frenar todo (Ctrl+Shift+F12)'}
            >
              {estado.frenado ? '▶' : '■'}
            </button>
          </div>
        ) : null}
      </div>

      {abierto ? (
        <>
          <select
            className="orbe__fuentes qh-no-drag"
            value={estado.fuente ?? ''}
            onChange={(e) => void qh?.elegirFuente(e.target.value)}
          >
            <option value="">¿Qué querés que mire?</option>
            {fuentes.map((f) => (
              <option key={f.source_id} value={f.source_id}>
                {f.kind === 'screen' ? '🖵 ' : ''}
                {f.name}
              </option>
            ))}
          </select>

          {aviso ? (
            <div className="orbe__aviso qh-no-drag" onClick={() => setAviso(null)}>
              {aviso}
            </div>
          ) : null}

          <div className="orbe__registro qh-no-drag" ref={registro}>
            {turnos.length === 0 ? (
              <p className="orbe__vacio">
                Elegí qué ventana miro, prendé el ojo y hablame.
                <br />
                También podés escribir.
              </p>
            ) : (
              turnos.map((t) => (
                <div key={t.id} className="turno" data-quien={t.quien}>
                  {t.texto}
                </div>
              ))
            )}
          </div>

          <div className="orbe__escribir qh-no-drag">
            <input
              value={borrador}
              placeholder={estado.frenado ? 'Frenado' : 'Escribí…'}
              disabled={estado.frenado}
              onChange={(e) => setBorrador(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void enviar();
              }}
            />
            <button onClick={() => void enviar()} disabled={estado.frenado || !borrador.trim()}>
              ↑
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

type Visual =
  | 'sin-puente'
  | 'frenado'
  | 'error'
  | 'conectando'
  | 'hablando'
  | 'escuchando'
  | 'observando'
  | 'lista'
  | 'dormido';

const TITULOS: Record<Visual, string> = {
  'sin-puente': 'No cargó el puente con el proceso principal',
  frenado: 'Frenado',
  error: 'Algo falló — abrí el panel para ver qué',
  conectando: 'Conectando…',
  hablando: 'Hablando',
  escuchando: 'Escuchando',
  observando: 'Mirando la pantalla',
  lista: 'Listo',
  dormido: 'Dormido — hacé click para despertarlo',
};

function estadoVisual(estado: EstadoOrbe, escuchando: boolean, sinPuente: boolean): Visual {
  if (sinPuente) return 'sin-puente';
  if (estado.frenado) return 'frenado';
  if (estado.sesion === 'error') return 'error';
  if (estado.sesion === 'conectando') return 'conectando';
  if (estado.hablando) return 'hablando';
  if (escuchando) return 'escuchando';
  if (estado.observando) return 'observando';
  if (estado.sesion === 'lista') return 'lista';
  return 'dormido';
}
