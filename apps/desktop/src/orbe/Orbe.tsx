import type { CSSProperties, JSX } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Microfono, Reproductor } from './audio.js';
import logoQuantumHive from '../assets/quantumhive-logo.png';

/** Mismas voces que `electron/canales.ts` — no se importa por estar en otro proyecto de TS. */
const VOCES_DISPONIBLES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'] as const;
type VozDisponible = (typeof VOCES_DISPONIBLES)[number];

/** Nombres propios, para que se entienda de un vistazo quién es varón y quién mujer. */
const NOMBRE_VOZ: Record<VozDisponible, string> = {
  Puck: 'Mateo',
  Charon: 'Bruno',
  Fenrir: 'Nico',
  Orus: 'Tomás',
  Kore: 'Valentina',
  Aoede: 'Camila',
  Leda: 'Sofía',
  Zephyr: 'Renata',
};

/** Espejo de `electron/canales.ts`. `escuchando` no está: lo lleva el orbe. */
interface EstadoOrbe {
  sesion: 'cerrada' | 'conectando' | 'lista' | 'error';
  voz: VozDisponible;
  observando: boolean;
  hablando: boolean;
  frenado: boolean;
  expandido: boolean;
  fuente: string | null;
  ventana: string | null;
  detalle?: string;
}

/** Sólo pantallas completas — ver ventanas sueltas era lo que más se rompía. */
interface Fuente {
  source_id: string;
  name: string;
  thumbnail_data_url?: string;
}

interface Turno {
  id: string;
  quien: 'yo' | 'copiloto';
  texto: string;
  cerrado: boolean;
}

const ESTADO_INICIAL: EstadoOrbe = {
  sesion: 'cerrada',
  voz: 'Puck',
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
  const [probandoVoz, setProbandoVoz] = useState(false);
  const [vocesAbierto, setVocesAbierto] = useState(false);
  const [pantallasAbierto, setPantallasAbierto] = useState(false);

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
      qh.alTurnoFin(() => {
        cerrarTurno();
        setProbandoVoz(false);
      }),
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
      qh.alError((detalle) => {
        setAviso(detalle);
        setProbandoVoz(false);
      }),
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
    void qh?.expandir(!estado.expandido);
  }, [qh, estado.expandido]);

  const alternarMicrofono = useCallback(async () => {
    if (qh === null) return;
    if (microfono.current.activo) {
      microfono.current.parar();
      setEscuchando(false);
      return;
    }
    try {
      // Siempre se llama, aunque la sesión ya esté lista: es lo que dispara
      // el saludo del otro lado, cada vez que se prende el micrófono. No
      // vuelve hasta que la sesión está lista de verdad, así que lo que se
      // diga apenas se abra el micrófono llega — antes volvía con el socket
      // recién creado y las primeras palabras se descartaban.
      await qh.conectar();
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
  }, [qh]);

  const elegirYProbarVoz = useCallback(
    async (voz: VozDisponible) => {
      if (qh === null || probandoVoz) return;
      setProbandoVoz(true);
      setAviso(null);
      setVocesAbierto(false);
      await qh.elegirVoz(voz);
      const ok = await qh.probarVoz(voz);
      if (!ok) setProbandoVoz(false);
    },
    [qh, probandoVoz],
  );

  const abrirSelectorFuente = useCallback(() => {
    setPantallasAbierto(true);
    void qh?.listarFuentes().then(setFuentes);
  }, [qh]);

  // Elegir una pantalla ya prende la visión: son la misma decisión, no hace
  // falta un botón de ojo aparte.
  const elegirFuente = useCallback(
    async (id: string, nombre: string) => {
      setPantallasAbierto(false);
      await qh?.elegirFuente(id, nombre);
      await qh?.vision(true);
    },
    [qh],
  );

  // Con la visión prendida, tocar el resumen apaga en vez de reabrir el
  // selector: para mirar otra pantalla primero hay que dejar de mirar esta.
  const alternarResumenFuente = useCallback(() => {
    if (estado.observando) void qh?.vision(false);
    else abrirSelectorFuente();
  }, [qh, estado.observando, abrirSelectorFuente]);

  const fuenteActual = fuentes.find((f) => f.source_id === estado.fuente) ?? null;

  const enviar = useCallback(async () => {
    const texto = borrador.trim();
    if (!texto || qh === null) return;
    // El texto no necesita conectar nada: es un pedido HTTP suelto, siempre
    // disponible, y nunca reproduce audio.
    agregar('yo', texto);
    cerrarTurno();
    setBorrador('');
    await qh.enviarTexto(texto);
  }, [borrador, qh, agregar, cerrarTurno]);

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
          {qh === null ? (
            <span className="orbe__marca">!</span>
          ) : (
            <img className="orbe__logo" src={logoQuantumHive} alt="QuantumHive" draggable={false} />
          )}
          {/* Mirando: el orbe respira y tira chispas, para que se note vivo aunque
              no esté hablando ni escuchando (esos ya tienen su propio brillo). */}
          {estado.observando ? (
            <span className="orbe__vida" aria-hidden="true">
              <span className="orbe__vida-aro orbe__vida-aro--verde" />
              <span className="orbe__vida-aro orbe__vida-aro--energia" />
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} className="orbe__chispa" style={{ '--i': i } as CSSProperties} />
              ))}
            </span>
          ) : null}
        </button>

        {abierto ? <span className="orbe__titulo qh-no-drag">Quantum Asistente</span> : null}

        {abierto ? (
          <div className="orbe__acciones qh-no-drag">
            <button
              className="orbe__mic"
              data-on={escuchando}
              onClick={() => void alternarMicrofono()}
              title={escuchando ? 'Apagar micrófono' : 'Prender micrófono'}
            >
              <span className="orbe__mic-punto" aria-hidden="true" />
              Micrófono {escuchando ? 'ON' : 'OFF'}
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
          <button
            type="button"
            className="orbe__fuentes-resumen qh-no-drag"
            onClick={() => setVocesAbierto((v) => !v)}
          >
            <span className="orbe__fuentes-resumen-texto">Elegí a tu asistente: {NOMBRE_VOZ[estado.voz]}</span>
            <span className="orbe__fuentes-resumen-flecha">{vocesAbierto ? '▴' : '▾'}</span>
          </button>

          {vocesAbierto ? (
            <div className="orbe__voces qh-no-drag">
              {VOCES_DISPONIBLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  className="orbe__voz-chip"
                  data-activa={estado.voz === v}
                  disabled={escuchando || probandoVoz}
                  onClick={() => void elegirYProbarVoz(v)}
                  title={`Elegir y escuchar a ${NOMBRE_VOZ[v]}`}
                >
                  {NOMBRE_VOZ[v]}
                </button>
              ))}
            </div>
          ) : null}

          <button
            type="button"
            className="orbe__fuentes-resumen qh-no-drag"
            data-observando={estado.observando}
            onClick={alternarResumenFuente}
            title={estado.observando ? 'Dejar de mirar' : '¿Qué pantalla querés que mire?'}
          >
            <span className="orbe__fuentes-resumen-texto">
              {estado.observando ? 'Mirando: ' : ''}
              {fuenteActual ? fuenteActual.name : '¿Qué pantalla querés que mire?'}
            </span>
            {estado.observando ? (
              <span className="orbe__fuentes-resumen-punto" aria-hidden="true" />
            ) : (
              <span className="orbe__fuentes-resumen-flecha">{pantallasAbierto ? '▴' : '▾'}</span>
            )}
          </button>

          {pantallasAbierto ? (
            <div className="orbe__voces qh-no-drag">
              {fuentes.length === 0 ? (
                <p className="orbe__pantallas-vacio">No encontré ninguna pantalla conectada.</p>
              ) : (
                fuentes.map((f) => (
                  <button
                    key={f.source_id}
                    type="button"
                    className="orbe__voz-chip"
                    data-activa={estado.fuente === f.source_id}
                    onClick={() => void elegirFuente(f.source_id, f.name)}
                    title={`Mirar ${f.name}`}
                  >
                    {f.name}
                  </button>
                ))
              )}
            </div>
          ) : null}

          {aviso ? (
            <div className="orbe__aviso qh-no-drag" onClick={() => setAviso(null)}>
              {aviso}
            </div>
          ) : null}

          <div className="orbe__registro qh-no-drag" ref={registro}>
            {turnos.length === 0 ? (
              <p className="orbe__vacio">
                Elegí qué ventana miro y hablame.
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
