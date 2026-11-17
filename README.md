# ¡Guantazo! — boxeo con las manos, en 360° y VR

Juego de boxeo **original** que se controla con las manos.
Tiene un estilo limpio y luminoso, con formas redondas, luz suave y una interfaz blanca con esquinas redondeadas.
Peleas en un estadio 360° hecho con una **imagen equirectangular**, y se puede jugar en pantalla normal, en un **visor VR de cartón** (pantalla dividida) o en un **visor WebXR** (Quest y similares).

- Detección de manos: **MediaPipe Hand Landmarker** (`@mediapipe/tasks-vision@0.10.14`).
- 3D: **three.js 0.160.0** (`StereoEffect` para la pantalla dividida, WebXR para visores).
- Personajes, estadio, interfaz y sonidos son propios; los sonidos se sintetizan con Web Audio, sin archivos.

> **Aviso:** proyecto personal y sin fines de lucro. **No está afiliado, asociado, autorizado ni respaldado por Nintendo.**
> Los personajes, el estadio, la interfaz y los sonidos son originales; no se usa ningún personaje, imagen, sonido ni otro recurso de Nintendo.
> «Wii», «Mii» y «Wii Sports» son marcas registradas de Nintendo y se mencionan solo como referencia.

## Cómo ejecutarlo

```bash
cd boxeo-manos
python3 -m http.server 8790
```

Abre <http://localhost:8790> en Chrome o Safari. Necesitas internet para bajar three.js, MediaPipe y el modelo desde sus CDN.
Este servidor es independiente del proyecto AR (`ar-avion/`, puerto 8765).

## Fondo 360° (imagen equirectangular)

El estadio de fondo es una imagen **equirectangular** (proporción 2:1) puesta por dentro de una esfera que rodea al jugador.
El centro de la imagen queda al frente, detrás del rival.

- **Por defecto:** `estadio360.js` dibuja un estadio original de 4096×2048 en un canvas.
- **Tu propia imagen:** en el menú, pulsa **🖼 Usar mi imagen 360…** o arrastra el archivo sobre la página.
- **Por URL:** guarda la imagen en la carpeta, por ejemplo `fondos/mi360.jpg`, y abre `http://localhost:8790/?fondo=fondos/mi360.jpg`.
- **Estadio original** vuelve al fondo generado.

Sirve cualquier foto o render 360 en formato equirectangular (de una cámara 360, Blender, Skybox AI, etc.).

## Modos de vista

| Modo | Cómo se activa | Cómo miras | Cómo golpeas |
|---|---|---|---|
| Normal | por defecto | arrastra con el mouse o el dedo; 🎯, doble clic o `C` centran la vista | manos frente a la webcam |
| VR de cartón | menú «Vista», botón 👓 o tecla `V` | 📱 giroscopio del celular | manos frente a la cámara (ver abajo) |
| Visor WebXR | botón **🥽 Entrar en VR** (aparece solo si el navegador soporta `immersive-vr`) | moviendo la cabeza | controles o manos del visor |

**VR de cartón con celular:** elige **Cámara → Trasera (celular en el visor)**.
La cámara trasera mira hacia adelante y ve tus manos. Como la mano se aleja de la cámara al golpear, en ese modo el golpe se detecta cuando la palma **se encoge**, y la imagen no va en espejo.
⚠️ Desde el celular, la página tiene que abrirse por **HTTPS** (o como `localhost`); si no, el navegador no da acceso a la cámara ni al giroscopio. Un servidor `http` en la red local no basta: usa un túnel HTTPS o un certificado.

**Visor WebXR (Quest, etc.):**
- **Golpe:** el control (o la muñeca, si usas tus manos) avanza hacia el rival a más de 1,6 m/s. Es gancho si además cruza hacia el centro.
- **Guardia:** las dos manos cerca de la cara.
- **Esquiva:** mueve la cabeza unos 18 cm a un lado.
- **Gatillo:** sigue después de terminar una pelea.
- El marcador 3D sobre el rival reemplaza al HUD de pantalla.

## Cómo se juega

1. **Calibración** (modo cámara): ponte a ~60 cm con los dos puños frente al pecho y quédate quieto ~1 s.
2. **Recto 👊:** lanza el puño rápido hacia adelante.
3. **Gancho 🌀:** golpe cruzando hacia el centro.
4. **Guardia 🛡:** sube las dos manos frente a la cara. Bloquea los golpes normales.
5. **Esquiva ↔:** inclínate a un lado.
   - Golpe por la **izquierda** (`!` a la izquierda) → esquiva a la **derecha** o pon guardia.
   - Golpe por la **derecha** → esquiva a la **izquierda** o pon guardia.
   - Golpe al **centro** → esquiva a cualquier lado o pon guardia.
   - **Rompe-guardia morado** (último rival) → solo sirve esquivar.
6. Si esquivas, tu **contragolpe** hace casi el doble de daño. Si el rival se cubre, los rectos rebotan pero los ganchos entran. Tres golpes seguidos lo dejan **mareado**.

Son 3 rounds de 60 s, y ganas por K.O. o por decisión. Hay tres rivales en escalera: **Tito Tornado**, **La Mole Morada** y **Capitán Cachetes**.

### Teclado

| Tecla | Acción |
|---|---|
| `F` / `J` | recto izquierdo / derecho |
| `R` / `U` | gancho izquierdo / derecho |
| `Espacio` (mantener) | guardia |
| `←` / `→` (o `A` / `D`) | esquivar |
| `V` | VR de cartón (pantalla dividida) |
| `C` | centrar la vista |
| `Enter` en el menú | empezar con teclado |

## Ajustes

Los umbrales están en `CFG`, al principio de `game.js`:

- `punchGrowth`: sube el valor si detecta golpes de más y bájalo si no detecta los tuyos.
- `hookVx`: velocidad lateral a partir de la cual un golpe cuenta como gancho.
- `guardRaise`, `guardMaxDx`: qué tan arriba y qué tan juntas deben estar las manos para la guardia.
- `dodgeDx`: cuánto tienes que inclinarte para esquivar.
- `roundSecs`, `rounds`: duración y cantidad de rounds.

## Detalles técnicos

- Hand Landmarker corre en modo `VIDEO` con delegate `GPU`; si la GPU falla, usa `CPU`.
- El tamaño de la palma es el promedio de los segmentos 0‑5, 0‑17, 5‑17 y 0‑9, corregido por el aspecto del video. Da la profundidad del guante y detecta los golpes.
- La cámara va dentro de un `rig` (la posición del jugador). En WebXR, el visor mueve la cámara dentro del rig; el bucle usa `renderer.setAnimationLoop`.
- Para probar sin cámara, la consola tiene `window.boxeo`:
  - `boxeo.start('sim')` inicia el juego con manos simuladas.
  - `boxeo.processHands([boxeo.fakeHand(x, y, tamaño), …], performance.now())` le pasa manos falsas a la detección.
  - `boxeo.tick()` avanza un frame aunque la pestaña esté oculta.
  - `boxeo.state` muestra la fase, la vida, la pose y las estadísticas; `boxeo.events` registra golpes y ataques.
