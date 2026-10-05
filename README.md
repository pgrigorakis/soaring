# Soaring

Soaring is an ambient flight experience. A golden eagle explores a temperate wilderness and seeks thermals as you watch. There are no objectives, scores, or online services.

Play it at [pgrigorakis.github.io/soaring](https://pgrigorakis.github.io/soaring/).

## Browser support

Use a current desktop version of Chrome, Edge, or Firefox.

## Controls

- Drag on the landscape to orbit the camera. Release to let it return slowly to the trailing view.
- Scroll the mouse wheel to move the camera between 10 m and 200 m behind the eagle. At 200 m it sits 36 m above the eagle. The distance persists across reloads.
- Move the pointer to reveal the settings control. The cursor and control hide after 3 seconds without pointer movement.
- Settings provide fullscreen, sound and volume controls, terrain visibility, Show thermal, and a new-world action. Show thermal marks thermals within 3.5 km of the eagle; the selected thermal stays hotter.
- The eagle flies a repeating cycle, after Fly With Me. It rides a thermal to a top near 700 m above sea level and dives at 5–6 m/s to a cruise of 50–150 m above the ground. It holds that height by flapping for 300 s, then seeks the next thermal. Ridges can carry it during the cruise. At sunrise and sunset it heads toward the low sun, after dark toward a low moon, and on dark nights toward the galaxy core. Climbs stay within 800 m of the ground, and terrain safety always takes priority.
- Hold the left or right arrow key to nudge the eagle's course. If the course turns 20° or more, the eagle keeps it for three minutes and waits until then to seek the next thermal. Hold the up arrow to flap and the down arrow to dive more steeply. A small hint names the nudge and counts down to the autopilot. Holding left or right while the eagle circles a thermal or soars a ridge sends it away toward that side.
- The map in the lower-right corner shows the land and the last four days of flight, north up. Click it to step the zoom through 6, 20 and 70 km.
- Press `M` to open the biome map of the whole trail, or 40 km or 120 km around the eagle. Export PNG saves it with a legend and a scale. Press `M` or `Esc` to close it.
- Press `F` to toggle fullscreen. Press `D` to show or hide diagnostics.

Sound is procedural and starts muted on every page load. The two volume settings persist independently. Settings, the world seed and the flight trail live in `localStorage`. A new world starts a new trail. A reload keeps the seed but starts the eagle elsewhere in the same world.

## Terrain visibility

The terrain visibility slider controls how far the landscape is visible around the eagle. It ranges from 720 m to 8,000 m, defaulting to 8,000 m, independently of camera distance. Haze reaches only drawn ground while it loads; trees and water can appear after the ground. Terrain loading is capped at the reach needed for a 16:9 window. Wider windows can show a shorter haze distance than the selected value.

Near the eagle, the landscape shows individual trees and rocks. Farther away, it shows simplified terrain. Engine rules for terrain streaming and mesh transitions are in [AGENTS.md](AGENTS.md).

## Day and night

The sky shifts from blue at noon to golden dawn and dusk, then to a dark blue, starry night. Horizon fog follows the sky colour. A cloud deck sits at 600 m above sea level. Below it, the surface disappears. Inside it, white fog hides even the nearby eagle. Above it, cloud folds and height fog hide low ground, while high mountains can protrude. Over low ground, each thermal climb passes up through the deck, and the dive takes the eagle back below it. A first flight begins before sunrise.

## More information

The diagnostics panel reports render-buffer dimensions and total pixel count.

For local development, tests, and browser evidence, see [Testing, capture, and deployment](docs/testing.md).
