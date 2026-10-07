# Soaring

See [README.md](README.md) for the user-facing overview.

## Language

**Ambient flight experience**:
A background experience in which the eagle flies autonomously. The viewer can **nudge** it but never flies it.
_Avoid_: Flight game, simulator (unless discussing a specific simulation feature)

**Eagle**:
The autonomous bird whose flight gives the experience its focus.
_Avoid_: Player, avatar

**Nudge**:
A viewer's arrow-key hint to the autopilot. A held turn bends the course; on release, a turn of 20° or more becomes the eagle's course for three minutes. Up adds flap bursts and down steepens the glide. Terrain safety and the height floor always win.
_Avoid_: Steering, control (the viewer does not fly the eagle)

**Thermal**:
A rising current of warm air that the eagle seeks and rides to gain height.
_Avoid_: Updraft (when referring to the specific modeled flight feature)

**Thermal-seeking**:
The eagle's phase of flying toward a thermal.
_Avoid_: Thermal-riding

**Thermal-riding**:
The eagle's phase of circling within a thermal, without flapping, to gain height. It rolls into the circle at its arrival speed, centres the lift, and drifts downwind with the thermal. It ends when the eagle reaches the top of its **flight cycle** or the thermal weakens.
_Avoid_: Thermal-seeking

**Flight cycle**:
The eagle's repeating sequence, after Fly With Me: it rides a thermal to a top near 700 m above sea level, dives to a cruise height of 50–150 m above the ground, holds that height for 300 s, then seeks the next thermal.
_Avoid_: Loop, routine

**Flight height**:
The eagle's height above the local terrain, kept in a fixed 50–800 m band. Near the bottom the eagle flaps to climb. The top caps thermal and ridge climbs.

**Gliding**:
Flight without flapping outside a thermal; the eagle trades height for distance and slowly sinks.
_Avoid_: Soaring (unless in a thermal)

**Flapping**:
Short bursts of wing beats the eagle uses to climb outside a thermal and to hold its cruise height. Never used while thermal-riding. The wing beat eases in and out; it does not start at full stroke.

**Sea level**:
The shared water height across the world. Bays, coasts and inland basins all fill to this height.
_Avoid_: Local lake level

**Lake**:
An inland basin filled to sea level. Its shore follows the surrounding land rather than a separate lake outline.
_Avoid_: Drainage lake, elevated cirque lake

**Terrain visibility**:
The fixed 12 km distance around the eagle, described in [README.md](README.md#terrain-visibility).
_Avoid_: Camera distance, draw distance (when it could be confused with camera distance)

**Start screen**:
The white screen shown on page load until the viewer clicks. The world loads behind it and fades in once nearby terrain is drawn.
_Avoid_: Loading screen, splash

**Ambience**:
Environmental sounds such as wind and wing flaps, separate from music.
_Avoid_: Music

**Time of day**:
The landscape's shared cycle of daylight and night. A full cycle lasts fifteen minutes. The sun and moon do not follow the camera. The moon falls behind the sun by a full turn every eight cycles, so it rises later and changes phase each night.
_Avoid_: Fixed sun, camera sun
