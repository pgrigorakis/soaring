# Soaring

Soaring is an ambient flight experience. A golden eagle explores a temperate wilderness and seeks thermals as you watch. There are no objectives, scores, or online services.

Play it at [pgrigorakis.github.io/soaring](https://pgrigorakis.github.io/soaring/).

## Browser support

Use a current desktop version of Chrome, Edge, or Firefox.

## Controls

- Drag on the landscape to orbit the camera. Release to let it return slowly to the trailing view.
- Move the pointer to reveal the settings control. The cursor and control hide after 3 seconds without pointer movement.
- Settings provide fullscreen, sound and volume controls, terrain visibility, Low power, Show thermal, flight-height bounds, camera distance, and a new-world action. Show thermal marks thermals within 3.5 km of the eagle; the selected thermal stays hotter. Height bounds persist across reloads. They guide low flight and cap thermal climbs. Scheduled cloud crossings can climb above them, but terrain safety always takes priority.
- Press `F` to toggle fullscreen. Press `D` to show or hide diagnostics.

Sound is procedural and starts muted on every page load. The two volume settings persist independently. Settings and the world seed live in `localStorage`. A reload keeps the seed but starts the eagle elsewhere in the same world.

## Terrain visibility

The terrain visibility slider controls how far the landscape is visible around the eagle. It ranges from 720 m to 5,000 m, defaulting to 5,000 m, independently of camera distance. Haze reaches only drawn ground while it loads; trees and water can appear after the ground. Terrain loading is capped at the reach needed for a 16:9 window. Wider windows can show a shorter haze distance than the selected value.

Near the eagle, the landscape shows individual trees and rocks. Farther away, it shows simplified terrain. Engine rules for terrain streaming and mesh transitions are in [AGENTS.md](AGENTS.md).

## Day and night

The sky shifts from blue at noon to golden dawn and dusk, then to a dark blue, starry night. Horizon fog follows the sky colour. A cloud deck sits at 600 m above sea level. Below it, the surface disappears. Inside it, white fog hides even the nearby eagle. Above it, cloud folds and height fog hide low ground, while high mountains can protrude. The eagle crosses the deck on a 450-second flight schedule. A first flight begins before sunrise, climbs toward the sun, holds above the deck, then dives back below it.

## More information

The diagnostics panel reports render-buffer dimensions and total pixel count.

For local development, tests, and browser evidence, see [Testing, capture, and deployment](docs/testing.md).
