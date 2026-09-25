# Soaring

Soaring is an autonomous ambient flight experience: an eagle explores a landscape and seeks thermals while the display provides a calm backdrop.

## Language

**Ambient flight experience**:
A background experience in which the eagle flies autonomously; the viewer does not steer it.
_Avoid_: Flight game, simulator (unless discussing a specific simulation feature)

**Eagle**:
The autonomous bird whose flight gives the experience its focus.
_Avoid_: Player, avatar

**Thermal**:
A rising current of warm air that the eagle seeks and rides to gain height.
_Avoid_: Updraft (when referring to the specific modeled flight feature)

**Thermal-seeking**:
The eagle's phase of flying toward a thermal.
_Avoid_: Thermal-riding

**Thermal-riding**:
The eagle's phase of circling within a thermal, without flapping, to gain height. It ends when the eagle reaches maximum flight height or the thermal weakens.
_Avoid_: Thermal-seeking

**Flight height**:
The eagle's height above the local terrain. The minimum is a soft floor: near it the eagle flaps to climb. The maximum caps climbing in a thermal.

**Gliding**:
Flight without flapping outside a thermal; the eagle trades height for distance and slowly sinks.
_Avoid_: Soaring (unless in a thermal)

**Flapping**:
Short bursts of wing beats the eagle uses to climb outside a thermal. Never used while thermal-riding.

**Drainage lattice**:
The coarse deterministic grid, at 500 m spacing, that decides where water flows before the terrain is shaped. Each node drains to its lowest neighbor. It is computed lazily per region and cached, not precomputed for the whole world.
_Avoid_: Whole-world water map, river painted on after the hills

**River**:
Water along a drainage-lattice segment. It runs downhill, joins larger rivers, and never crosses them. Valley sides rise from the channel, and the channel stays visible on the far terrain mesh.
_Avoid_: Stream placed on an unrelated slope

**Lake**:
Water filling a lattice basin: a node with no lower neighbor and enough upstream drainage. A river ends in a lake or continues past the loaded area.
_Avoid_: Noise puddle, sea

**Terrain visibility**:
How far the landscape is visible around the eagle, independent of camera distance.
_Avoid_: Camera distance, draw distance (when it could be confused with camera distance)
Near the eagle, the landscape shows individual trees and shadows; far away, it shows simplified terrain only.

**Ambience**:
Environmental sounds such as wind and wing flaps, separate from music.
_Avoid_: Music

**Time of day**:
The landscape's shared cycle of daylight and night. A full cycle lasts fifteen minutes. The sun and the full moon sit on opposite sides of the sky and do not follow the camera.
_Avoid_: Fixed sun, camera sun
