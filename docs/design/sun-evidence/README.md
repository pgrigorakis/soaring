# Soft-glow sun captures

These captures compare the old sun with the soft-glow sun. The captain chose the soft glow (option D) on the [sun options board](http://phantom.smelt-tyrannosaurus.ts.net:4387/session/a739c6b3b33403a4).

The old sun was a disc about 3° across, with a tight glow, a warm halo when low, and a two-piece lens flare. The soft-glow sun has no hard edge. A white-hot core fades through layered warm halos, and the lens flare is one faint veil.

Every capture uses seed **5**, the lake review spot, a 1280 × 800 viewport, pixel ratio 1, and the normal development renderer with `?profile`. The camera is held 60 m behind and 30 m above the eagle, facing the sun with a 0.22 rad heading offset. Toward-sun views tilt the camera up so the sun is in frame. Terrain had no pending chunks before each screenshot. `before` is `main` commit `8e40f34`. `captures.json` records the time of day, heading, camera tilt, sun elevation and draw calls for each image.

| View | Sun elevation | Camera tilt | Before | After |
| --- | ---: | ---: | --- | --- |
| Sunrise, toward the sun | 3° | 2° | [Capture](before/sunrise-toward.png) | [Capture](after/sunrise-toward.png) |
| Golden hour, toward the sun | 12° | 4° | [Capture](before/golden-toward.png) | [Capture](after/golden-toward.png) |
| Sunset, toward the sun | 3° | 2° | [Capture](before/sunset-toward.png) | [Capture](after/sunset-toward.png) |
| Mid-morning, toward the sun | 30° | 12° | [Capture](before/morning-toward.png) | [Capture](after/morning-toward.png) |
| Noon, toward the sun | 52° | 34° | [Capture](before/noon-toward.png) | [Capture](after/noon-toward.png) |
| Mid-morning, away from the sun | 30° | chase default | [Capture](before/morning-away.png) | [Capture](after/morning-away.png) |
