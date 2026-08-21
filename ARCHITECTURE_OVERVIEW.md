# Zorka: Battle for the Solar Tides — Architecture Overview

This document describes the current JavaScript architecture, active game modes, system ownership, and intended seams for future work.

## Core Architectural Philosophy

Zorka is a local-first, top-down Newtonian space arena built with plain ES modules and Vite. The runtime is organized around five practical layers:

1. **Authoritative match state** — canonical live entities, mode state, options, progression, and area membership.
2. **Gameplay rules** — movement, weapons, collision, damage, rewards, death, respawn, waves, and room transitions.
3. **World configuration** — standard wrapped-world contracts and immutable Experimental topology/geometry.
4. **Runtime composition** — bootstrap, assets, input, update order, cameras, and frame loop.
5. **Presentation** — world rendering, HUD, minimap, menus, overlays, cursor, VFX, and audio.

`Game` is the central match coordinator. Entity classes own their own persistent per-entity state, while `Game` resolves cross-entity and match-level outcomes such as projectile insertion, collision results, rewards, death, respawn, Arcade waves, and Experimental area coordination.

UI, camera, and audio are presentation/dispatch layers. They must not become owners of combat, progression, shields, room membership, or mode-rule truth.

## Product and Mode Foundation

The active product has four local modes:

- **Solo Arena** — one local human plus NPC ships.
- **Local PvP Arena** — local/split-screen play with up to eight ships.
- **Arcade Mode** — one-life escalating NPC waves.
- **Experimental Mode** — a nine-room bounded campaign shell joined by long hallways and optimized through room-local simulation.

The standard arena remains the reusable gameplay foundation: shared `Player`, `Projectile`, asteroid, hazard, reward, input, and damage contracts are used across modes.

Experimental Mode deliberately overrides world topology, wrapping, spatial filtering, and population scope through explicit seams rather than forking shared entity classes. Arcade Mode deliberately overrides wave progression, transformation availability, and death/respawn outcome.

Online multiplayer is not active. The UI and `Game` runtime expose no online entry points, `Game.network` is `null`, and `network_manager.js` is isolated legacy source rather than an active dependency.

## Runtime Composition

### Bootstrap

`main.js` installs console-noise filters, creates `new Game('game-container')` on `window.load`, and calls `game.start()`.

### Game

File: `game.js`

The dependency-free `world_config.js` module owns the immutable design and
standard-world dimensions consumed by `Game`, entities, physics, and cameras.

`Game` owns and coordinates:

- screen/mode state (`SPLASH`, menus, `SOLO`, `PVP`, `ARCADE`, `EXPERIMENTAL`)
- assets, canvas sizing, stars, input binding, and the frame loop
- canonical `players`, `asteroids`, `hazards`, `projectiles`, and `vfx` collections
- shared Arena Options and population target resolution
- spawning, firing coordination, collision resolution, hit/destruction outcomes, rewards, damage, death, and respawning
- controller assignment, aim-lock acquisition/validation, cursor presentation state
- Arcade wave/replacement/game-over state
- Experimental session lifecycle, area definitions, doors, area indexes, population setup, membership transitions, wall outcomes, active-area filtering, and render/audio coordination
- camera, HUD, and audio composition

As the project grows, `Game` should remain the match-level coordinator. Extract a tightly scoped system only when the existing ownership seam is actively impeding correctness or testing.

### Frame Model

Each active gameplay frame follows this practical order:

1. Read local keyboard, mouse, and gamepad state.
2. Update living players and NPC intent.
3. Update asteroids, hazards, projectiles, and VFX.
4. In Experimental Mode, reconcile room membership and resolve bounded wall/door outcomes.
5. Resolve collisions and authoritative results.
6. Reconcile Arcade NPC waves, death/respawn timers, and camera targets.
7. Render world, entities, HUD/minimap, aim-lock outlines, cursor, VFX, and menus.

Rendering and sound react to confirmed results. They do not decide whether a hit, death, reward, area transfer, or spawn occurred.

## World Models

### Standard Wrapped World

Constants in `game.js`:

- design screen: **1920 × 1080**
- standard world: **17280 × 9720**
- topology: 9 × 9 design screens

Standard modes use wrap-aware movement, targeting, collision helpers, camera transforms, and minimap scaling.

### Experimental Bounded World

Files: `world/experimental_rooms.js`, `game.js`, `physics.js`, `camera.js`

Experimental Mode defines immutable area metadata for:

- nine full-size combat rooms
- eight long Room 0 hallways
- room/hallway bounds
- thick collision walls and thinner visual cores
- entrances, blockers, adjacency, and safe-spawn regions
- room progression metadata
- centralized collision categories

The fixed room route is a chain from Room 1 through Room 9. Combat room `n` contains `n` NPCs initialized to level `n`. Each combat room independently applies the same shared Arena Options population target resolver used by standard modes.

`Game.getWorldRules()` exposes the active movement/camera/spawn contract. Standard modes return wrapped-world rules; Experimental returns non-wrapping, room-aware rules.

## Authoritative State Ownership

| Owner | Owns |
| --- | --- |
| `Game` | Match/mode state, canonical collections, Arena Options, spawn/destruction outcomes, damage/death/respawn, Arcade progression, Experimental session/area/index coordination |
| `Player` | Flight, aim and lock state, local/NPC control, weapons/evolution, capsules, XP/levels, HP, shields/recharge, score/streak data |
| `Asteroid` | Tier, movement, radius, rotation, hit/destruction state |
| `SpaceDebris` / `Satellite` | Hazard movement, hit state, XP identity, satellite firing cadence |
| `Projectile` | Position/velocity, lifespan, owner, travel cap, weapon flags, live owner-lock preference, automatic fallback target, orbital/tentacle state |
| `physics.js` | Stateless movement, wrapping, circle collision, nearest-wrapped displacement, thick/swept wall contact, slide, and reflection math |
| `world/experimental_rooms.js` | Immutable Experimental topology, geometry, progression metadata, entrances, and collision categories |

Experimental per-area indexes are **derived acceleration structures**, not authoritative collections. Insertion, transfer, removal, VFX, and cleanup must keep them reconciled with `Game`’s canonical arrays.

## Core Gameplay Systems

### Newtonian Flight

Files: `entities/player.js`, `physics.js`

`Player` calculates force/intent and calls shared Newtonian helpers. There is no passive drag; braking applies acceleration against velocity.

Standard modes wrap across the world. Experimental passes non-wrapping world rules and then resolves movement against area wall segments. Ships slide along walls, large bodies reflect, and swept tests prevent tunneling.

### Input and Aim Lock

Files: `game.js`, `entities/player.js`, `camera.js`

Player 1 uses an explicit keyboard/mouse or gamepad assignment. Gamepad activity does not silently steal mouse ownership when keyboard/mouse is selected.

Aim-lock acquisition is coordinated by `Game` and stored on `Player`:

- mouse acquisition uses exact/padded hit tests
- controller acquisition uses right-stick direction plus LT hysteresis
- lock validation is wrap-aware in standard modes and room-local in Experimental
- cursor visibility and aim outlines are derived presentation

Missiles read their owner’s current valid lock during flight. When no valid explicit lock exists, each missile manages its own automatic fallback target.

### Player Progression, HP, and Shields

File: `entities/player.js`; orchestration in `game.js`; display in `ui/hud.js`

Players own:

- cumulative XP and level
- pending level-up choices
- Projectile, Speed, and Shield upgrade counts
- base/max/current HP
- shield maximum/current charges and recharge timer
- capsule stack and temporary power-up state

XP thresholds scale quadratically by level. Each gained level adds one maximum HP and one current HP, then grants one pending upgrade choice.

Upgrade choices:

- **Projectile** — improves the shared base projectile state and affects weapon forms that derive from it.
- **Speed** — increases effective thrust up to its cap.
- **Shield** — increases maximum shield capacity by one and grants one current charge.

Damage order is authoritative in `Game.resolvePlayerDamage()`:

1. ignore damage during spawn immunity
2. consume shields one point at a time
3. apply HP loss
4. confirm death at zero HP

HP fully restores after its recharge delay. Shields recharge one charge per configured delay. A zero-delay setting immediately restores to maximum.

Respawn restores HP, zeroes velocity, grants brief immunity, and restores configured starting shield charges without erasing match-local maximum shield upgrades.

### Weapons and Projectiles

Files: `entities/player.js`, `entities/projectile.js`, `game.js`

`Player.fire()` defines weapon output; `Game.handleFire()` inserts projectiles and coordinates audio/network-independent match behavior.

Projectile representations include ordinary shots, Laser, missiles, skinny/AoE missiles, orbitals, and tentacles. Ordinary Normal, Antigun, and Double shots receive independent world-width travel caps. Specialized projectiles remain governed by their own lifespan/behavior.

Experimental projectile behavior is room-aware. Shots cannot target or collide across unrelated areas, and wall/door blockers terminate projectile representations; missiles detonate once at the first wall impact.

### Arena Objects

Files: `entities/asteroid.js`, `entities/hazards.js`

- **Asteroids** — lethal cover; Large → three Medium → three Small, with replacement behavior owned by `Game`.
- **Space Debris** — destructible hazard; grants 5 XP and no capsule; may be replaced after delay.
- **Satellites** — destructible hazard; grants 15 XP and no capsule; fires rogue projectiles and receives authoritative replacement.

Missiles can damage satellites and debris through the same confirmed hit/reward path.

### Combat, Rewards, and Death

Files: `game.js`, `entities/player.js`, `entities/projectile.js`

`Game.checkCollisions()` finds contacts. `Game.hitTarget()`, detonation methods, and `Game.resolvePlayerDamage()` apply results.

Confirmed enemy ship kills:

- grant one capsule
- increment score and kill streak
- update High Tide
- grant level-based XP when the victim is an NPC

Death clears capsule and temporary weapon/transformation-related state. Hardcore death also resets XP/level upgrade progress and level-derived HP/shield capacity in standard modes. Experimental human death instead preserves profile progression while rebuilding the complete run-scoped world, including encounters, doors, populations, indexes, effects, and replacement generations, before the normal Sector 1 respawn.

## Mode-Specific Systems

### Standard Solo and Local PvP

These modes use global wrapped-world populations, shared transformations, normal respawn, and shared Arena Options.

### Arcade Mode

Files: `game.js`, Arcade controls/overlay in `index.html`

Arcade uses a separate mode lifecycle:

- one random-color human player
- transformations disabled
- hardcore reset always enabled
- waves scale from one level-1 NPC through eight level-8 NPCs
- after eight concurrent NPCs, each replacement receives the next sequential level starting at 9
- NPC death marks elimination and triggers reconciliation
- human death ends the run and shows final level, XP, and capsules gained
- no human respawn

### Experimental Mode

Files: `world/experimental_rooms.js`, `game.js`, `physics.js`, `camera.js`, `ui/hud.js`

Experimental adds the following systems without replacing standard modes:

- **Session lifecycle** — setup and cleanup invalidate pending room-local replacements and restore camera defaults.
- **Area membership** — each entity may carry `roomId`; humans transfer only after clearing a doorway, and NPC target state is reset appropriately.
- **Derived area indexes** — canonical collections are indexed by area for fast collision, update, and render candidates.
- **Selective simulation** — rooms without humans skip NPC targeting/firing, satellite firing, VFX updates, and spatial audio.
- **Room-local populations** — every numbered room independently resolves asteroid/debris/satellite targets; hallways have no persistent population.
- **Hallway purge** — entering Room 0 clears transient hallway environment/projectiles once per entry.
- **Door collision policy** — humans pass; NPCs are confined; projectiles terminate; large bodies reflect; small asteroids are destroyed environmentally without reward/children.
- **Cross-area isolation** — targeting, collisions, blasts, audio, and rendering reject unrelated areas, with tightly scoped doorway adjacency for human/environment contact.
- **Camera/minimap** — direct coordinates and current-area minimap mapping replace wrapped presentation only while Experimental is active.
- **Render culling** — active-area entities and viewport-intersecting current/connected-area walls only, with a fixed high-speed margin.
- **Transition rules** — confirmed area changes preserve temporary bonuses, shields, and persistent progression.
- **Respawn** — Experimental human death rebuilds run-scoped world state and respawns the retained profile at the center of Sector 1; NPC respawns remain room-aware.

## Arena Options

File: `game.js`; controls in `index.html`

Shared Arena Options include:

- asteroid density
- debris density
- satellite density
- starting shield charges
- shield recharge rate
- bot aggression (random or fixed 1–5)
- hardcore mode
- cursor/control presentation preferences

`getArenaPopulationTargets()` is the one density resolver. Standard modes use one global target set; Experimental applies the same target set independently to each combat room.

Shield recharge option values map to delays of 10, 7, 4, 1.5, and 0.5 seconds, with option 0 disabling recharge.

## Presentation and Integration

| Component | Responsibility |
| --- | --- |
| `camera.js` | Wrapped standard transforms or direct/room transforms and clamping |
| `ui/hud.js` | Level choices, score/status, capsule meter, speed meter, HP/shields, minimap |
| `audio_manager.js` | BGM and spatial effects in response to confirmed gameplay events |
| `index.html` | Splash/menu/mode setup, Arena Options, pause menu, Arcade game-over DOM |
| `game.js` draw methods | World composition, room walls, aim outlines, crosshair/cursor derivation |

The in-game pause menu does not stop simulation.

## Testing Structure

The repository includes focused Node tests for:

- arena shields and recharge
- HP and level progression
- Arcade leveling/color behavior
- projectile travel caps
- controller aim locking
- missile targeting/rewards/control intents
- Experimental mode shell, topology, wall physics, room transfer, minimap, performance, collision filtering, and rendering

Shared-contract changes should run both the focused test and relevant Experimental/standard regression tests.

## Change Rules

- Preserve one canonical owner for gameplay truth.
- Keep Experimental indexes derived and reconciled.
- Use explicit world rules to separate wrapped and bounded movement.
- Use shared population and entity contracts across modes.
- Trace timing-sensitive changes end-to-end: collision → result → cleanup/replacement/death → presentation.
- Prefer focused tests and incremental slices over broad rewrites.
