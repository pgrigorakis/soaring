# Soaring

Soaring is a small ambient Three.js experience. A modeled golden eagle flies itself over a deterministic, continuously streamed temperate wilderness. There are no objectives, scores, or online services.

Play it at [pgrigorakis.github.io/soaring](https://pgrigorakis.github.io/soaring/).

## Run locally

Requires Node.js 20 or newer and a current desktop Chrome, Edge, or Firefox.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4173`.

## Controls

- Drag on the landscape to orbit the camera. Release to let it return slowly to the trailing view.
- Move the pointer to reveal the settings control. The cursor and control hide after 3 seconds without pointer movement.
- Settings provide fullscreen, sound and volume controls, terrain visibility, Low power, Show thermal, flight-height bounds, camera distance, and a new-world action. Show thermal marks thermals within 3.5 km of the eagle; the selected thermal stays hotter. Height bounds persist across reloads. The eagle selects its own height and route within them.
- Press `F` to toggle fullscreen. Press `D` to show or hide diagnostics.

Sound is procedural and starts muted on every page load. The two volume settings persist independently. Settings and the world seed live in `localStorage`. A reload keeps the seed but starts the eagle elsewhere in the same world.

Normal rendering caps its pixel ratio at the lower of the device ratio, 1.5, and the value needed to stay within a 2-million-pixel budget. Low power uses the lower of 1.0 and that budget ratio. Adaptive quality keeps its existing steps, and the ratio updates when the viewport or device-pixel ratio changes.

## Terrain visibility

The terrain visibility slider controls how far the landscape is visible around the eagle. It ranges from 720 m to 5,000 m, defaulting to 5,000 m, independently of camera distance. Haze reaches only loaded terrain while new tiles stream in. Terrain loading is capped at the reach needed for a 16:9 window. Wider windows can show a shorter haze distance than the selected value.

Near the eagle, the landscape shows individual trees and rocks. Farther away, it shows simplified terrain. The technical rules for terrain streaming and mesh transitions live in [AGENTS.md](AGENTS.md).

## Day and night

The world clock moves through daylight and night. The sun and full moon sit on opposite sides of the sky, fixed in world space. The sky shifts from blue at noon to golden dawn and dusk, then to a dark blue, starry night. The higher body lights the scene and casts shadows around the camera. Fog colour follows the sky near the horizon.

## More information

The diagnostics panel reports render-buffer dimensions and total pixel count.

- [Testing, capture, and deployment](docs/testing.md) for developer commands and browser validation.
- [AGENTS.md](AGENTS.md) for engine invariants and project agent guidance.
