# Soaring

Soaring is an ambient flight experience. A golden eagle explores a temperate wilderness and seeks thermals as you watch. There are no objectives, scores, or online services.

Play it at [pgrigorakis.github.io/soaring](https://pgrigorakis.github.io/soaring/).

## Browser support

Use a current desktop version of Chrome, Edge, or Firefox.

## Start screen

A white start screen shows the title until you click. The world loads behind it. After the click, the screen fades once nearby ground, water and trees are drawn, or after at most 8 seconds of terrain loading. Far terrain keeps loading after the fade.

## Controls

- Drag on the landscape to orbit around the eagle. The eagle stays centred. Double-click to return to the trailing view.
- Scroll the mouse wheel to move the camera between 6 m and 60 m behind the life-size eagle. The default distance is 16 m. At 60 m it sits 6 m above the eagle. The distance persists across reloads.
- Move the pointer to reveal the settings control. The cursor and control hide after 3 seconds without pointer movement.
- Settings provide fullscreen, sound and volume controls, Show thermal, and a new-world action. Show thermal marks thermals within 3.5 km of the eagle; the selected thermal stays hotter.
- The eagle flies a repeating cycle, after Fly With Me. It rides a thermal to a top near 700 m above sea level and dives at 5–6 m/s to a cruise of 50–150 m above the ground. It holds that height by flapping for 300 s, then seeks the next thermal. Ridges can carry it during the cruise. At sunrise and sunset it heads toward the low sun, after dark toward a low moon, and on dark nights toward the galaxy core. Climbs stay within 800 m of the ground, and terrain safety always takes priority.
- Hold the left or right arrow key to nudge the eagle's course. If the course turns 20° or more, the eagle keeps it for three minutes and waits until then to seek the next thermal. Hold the up arrow to flap and the down arrow to dive more steeply. A small hint names the nudge and counts down to the autopilot. Holding left or right while the eagle circles a thermal or soars a ridge sends it away toward that side.
- The map in the lower-right corner shows the land and the last four days of flight, north up. Click it to step the zoom through 6, 20 and 70 km.
- Press `M` to open the biome map of the whole trail, or 40 km or 120 km around the eagle. Export PNG saves it with a legend and a scale. Press `M` or `Esc` to close it.
- Press `F` to toggle fullscreen. Press `D` to show or hide diagnostics.

Sound is procedural and starts muted. The sound setting and the two volume settings persist. If you left sound on, it starts again at your first click, because browsers need a click before they play sound. Settings, the world seed and the flight trail live in `localStorage`. A new world starts a new trail. A reload keeps the seed but starts the eagle elsewhere in the same world.

## The world

Each world comes from a seed. A continental generator shapes land, coasts and islands, and all water sits at one sea level. The land has five biomes: Rolling Hills, Woodland, Moor, Highlands and Lakeland. Thermals rise only over land.

## Terrain visibility

Terrain visibility is fixed at 12,000 m around the eagle, independently of camera distance. It is not a setting. Haze reaches only drawn ground while it loads; trees and water can appear after the ground. Terrain loading is capped at the reach needed for a 16:9 window. Wider windows can show a shorter haze distance than 12,000 m.

If the frame rate stays below 40 fps for 10 seconds, the app lowers the render resolution by one step. When the resolution is already at its lowest, the next step cuts terrain visibility to 3,500 m. After 60 seconds at 40 fps or more, quality returns by one step. A window without focus draws at 30 fps and keeps its quality.

Near the eagle, the landscape shows individual leaf-card trees, rocks and hedgerows. Farther out, trees are billboards baked from the near tree models. The far tiles show simplified ground and water. Engine rules for terrain streaming and mesh transitions are in [AGENTS.md](AGENTS.md).

## Day and night

A full day lasts 15 minutes. The sky shifts from blue at noon to golden dawn and dusk, then to a dark blue, starry night. The moon rises later each night and goes through its phases over eight days. Some nights show an aurora. Horizon fog follows the sky colour. A cloud deck sits at 600 m above sea level. Below it, the deck's upper surface is hidden and puff clouds float overhead. Above it, no puff clouds show. Inside it, white fog hides even the nearby eagle. From above, cloud folds and height fog hide low ground, while high mountains can protrude. Over low ground, each thermal climb passes up through the deck, and the dive takes the eagle back below it. The first flight in a world begins just before sunrise. Later reloads begin in the morning.

## More information

The diagnostics panel reports render-buffer dimensions and total pixel count.

For local development, tests, and browser evidence, see [Testing, capture, and deployment](docs/testing.md).
