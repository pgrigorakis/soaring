# Puff-cloud captures

The six captures come from `tests/puff-clouds.smoke.ts`. They use seed 5, the default 100 m chase camera, and the normal chase view. The test holds flight at about 80 m, 230 m, and 470 m above ground. It captures noon (phase 0.5) and golden hour (phase 0.72).

The captures use the smoke scene with a 720 m terrain-visibility range to keep browser rendering repeatable. The capture pixel ratio is set to 1.0. Thermal markers and the intro overlay are hidden so they do not obscure the clouds.
