# Quantum Assistant

Asistente general de escritorio de QuantumHive: un orbe flotante que puede ver
una ventana elegida por el usuario, conversar por voz con Gemini Live y mantener
un chat de texto.

Este repositorio es deliberadamente pequeño. No contiene trading, MetaTrader,
TradingView, conectores de brokers, panel financiero, servidor local ni Python.

## Estado actual

- Orbe flotante y ventana de conversación.
- Selección explícita de la ventana que puede observar.
- Captura visual adaptativa: solo envía un cuadro cuando la imagen cambia.
- Micrófono PCM mono a 16 kHz.
- Voz y transcripción de Gemini Live en Vertex AI.
- Chat escrito.
- Freno inmediato con `Ctrl+Shift+F12`.
- Conexión directa a Vertex para desarrollo local.

El micrófono debe verificarse con audio real en cada equipo antes de considerar
una versión lista para distribuir.

## Ejecutar en desarrollo

Requisitos: Windows 10/11, Node.js 20+, pnpm y Google Cloud CLI.

```powershell
gcloud auth login
pnpm install
pnpm dev
```

La cuenta autenticada necesita acceso al proyecto y a Vertex AI. La
configuración de ejemplo está en `.env.example`.

## Arquitectura

Hoy, durante el desarrollo:

```text
Electron -> Gemini Live en Vertex AI
```

Antes de distribuirlo:

```text
Electron -> Gateway autenticado en Cloud Run -> Gemini Live en Vertex AI
```

Las credenciales de Google nunca se incluirán en el instalador. El gateway, el
inicio de sesión, el instalador firmado y la actualización automática forman la
siguiente etapa del producto.

## Regla del producto

Antes de construir una función, comprobar si Gemini ya sabe hacerla. Si la
respuesta es sí, no se agrega otra capa.

La desconexión por inactividad será obligatoria para proteger capacidad y
costos de infraestructura. El tiempo exacto y el aviso se implementarán junto
con el gateway, donde pueden aplicarse de forma confiable para todos los
clientes.
