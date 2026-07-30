# Zorka: Battle for the Solar Tides — Architecture Overview

This document describes Zorka's present JavaScript architecture and the intended direction for new work.

It is for contributors and AI agents who need to know where gameplay rules live, what owns runtime data, and how Sandbox Mode supports future modes.

## Core Architectural Philosophy

Zorka is a local-first, top-down Newtonian space arena. The game is organized around four practical layers:

1. **Authoritative match state** — owns the live entities and arena settings.
2. **Gameplay rules** — update movement, combat, rewards, death, and respawning.
3. **Runtime composition** — creates the game, loads assets, binds input, and begins the frame loop.
4. **Presentation** — renders the world and HUD, plays audio, and exposes menu controls.

`Game` is currently the central authoritative match coordinator. Entity classes own their own per-entity state, but they do not independently decide global outcomes such as a kill reward, asteroid splitting, respawns, or match setup.

UI and audio are presentation/dispatch layers. They must not become owners of combat, capsule, or arena-rule truth.

## Product and Mode Foundation

**Sandbox Mode is the standard mode and the testing ground for Zorka.** Its Newtonian flight, wrapping world, entity behavior, rewards, death rules, and arena settings form the shared foundation for every future mode.

Future modes should compose the same core systems and deliberately override only their mode-specific rules. They should not fork the physics, basic entity contracts, or arena-setting definitions without a clear design decision.

Current supported play paths:

- **Solo Arena** — one local human player plus NPC ships.
- **Local PvP Arena** — local split-screen heads-up play, with up to eight ships in an arena.

Online multiplayer is intentionally out of scope for the active product. Legacy networking code may remain in the repository during cleanup, but it is not part of the offline Sandbox runtime contract.

## Runtime Composition

### Bootstrap

`main.js` creates `new Game('game-container')` after the page loads, then calls `game.start()`.

### Game

File: `game.js`

`Game` currently owns and coordinates:

- high-level screen/match state (`SPLASH`, menu, Solo, Local PvP)
- loaded assets and the canvas render loop
- current players, asteroids, hazards, projectiles, and visual effects
- arena options and their values
- spawning, collision resolution, hit/destroy outcomes, death, and respawning
- input binding and local controller assignment
- camera/HUD/audio composition

As the project grows, `Game` should remain the match-level coordinator. Extract tightly scoped systems only when a rule is becoming hard to reason about in this file; do not move gameplay truth into UI merely to shorten `game.js`.

### Frame Model

Each frame follows this practical order:

1. Read local input/gamepads.
2. Update living players and NPC decisions.
3. Update asteroids, hazards, projectiles, and VFX.
4. Resolve collisions and resulting game events.
5. Process respawn timers and follow the active camera target.
6. Render the arena, entities, HUD, and effects.

Collision effects must be resolved from the current frame's authoritative entity data. Rendering and sound react to those results; they do not decide them.

## Authoritative State Ownership

| Owner | Owns |
| --- | --- |
| `Game` | Match state, entity collections, arena options, spawning, destruction results, death/respawn flow |
| `Player` | Ship position/velocity/aim, control/NPC state, weapons, capsules, power-ups, shields, score, transformation state |
| `Asteroid` | Size tier, hit count, radius, movement, rotation, destroyed flag |
| `SpaceDebris` / `Satellite` | Hazard movement, hit state, XP reward identity, and satellite firing cadence |
| `Projectile` | Position/velocity, lifespan, owner, weapon flags, target/orbit/tentacle state |
| `physics.js` | Shared Newtonian movement, wrapping, and radius collision helpers; it owns no persistent game state |

Derived or presentation-only data—such as HUD strings, selected menu focus, custom cursor visuals, camera transforms, and audio playback—must remain derived from these owners.

## Core Gameplay Systems

### Newtonian Flight and Wrapping

Files: `entities/player.js`, `physics.js`

`updateNewtonian` applies force to velocity, moves the entity, and wraps it across the `WORLD_WIDTH × WORLD_HEIGHT` arena. There is no passive drag. Braking is achieved by applying thrust opposite the current motion.

The current world is a 9 × 9 grid of 1920 × 1080 design screens: **17280 × 9720** world units. Camera rendering chooses the nearest wrapped representation of an entity so the world appears seamless.

### Players, Input, and NPCs

File: `entities/player.js`

`Player` receives local keyboard/mouse or gamepad input, calculates thrust force, updates its aim, caps speed, and maintains its weapon/power-up state. NPC players use the same entity contract but produce force/fire intent through `updateNPC`. Target-lock state belongs to each `Player`; a missile snapshots its firing player’s lock at launch and is not redirected by another player’s lock.

Rules:

- The movement model belongs in `Player` plus `physics.js`.
- `Game` interprets fire intent by creating projectiles and resolving their results.
- Input widgets or HUD code may request actions but must not directly mutate player combat state.
- Controller face buttons dispatch player-owned intents: A consumes capsules, X applies Projectile level, Y applies Speed level, and B applies the general Power-up (Shield) level.

### Arena Objects

Files: `entities/asteroid.js`, `entities/hazards.js`

- **Asteroids** are lethal cover/terrain. Large → three Medium → three Small; large asteroids are replenished after destruction.
- **Space Debris** is asteroid-like, is destructible, and awards 5 XP but no capsule to the destroying ship.
- **Satellites** are destructible, award 15 XP but no capsule, and fire predictable rogue projectiles.

### Combat, Rewards, and Destruction

Files: `game.js`, `entities/projectile.js`, `entities/player.js`

`Player.fire()` defines weapon output. `Game.handleFire()` adds shots to the match. `Game.checkCollisions()` and `Game.hitTarget()` own hit results: projectile removal/piercing, asteroid splits, destruction effects, capsule rewards, and replacement spawning.

Capsules are the central risk/reward economy. A player earns them from enemy-ship kills, then spends the current capsule stack through `Player.activatePowerUp()` for weapon, missile, ghost, or forcefield upgrades. Death clears capsules and temporary power-ups.

### Death and Respawn

File: `game.js`

`Game.playerDeath()` owns damage-result transitions. A forcefield consumes a shield charge first; otherwise the player dies, loses accumulated capsules/power-ups, creates death presentation, and starts the respawn timer. `Game.respawnPlayer()` finds a safer sector, restores movement state, reapplies configured starting shields, and gives brief spawn immunity.

## Arena Options

File: `game.js`; controls in `index.html`

Sandbox arena options are match setup data owned by `Game`:

- asteroid density
- debris density
- satellite density
- starting shield charges
- bot aggression
- cursor style and other presentation preferences

Future modes may expose a subset or add mode-specific options, but shared Sandbox options should retain one authoritative definition and one spawn/application path.

## Presentation and Integration

| Component | Responsibility |
| --- | --- |
| `camera.js` | Follows a player and applies wrap-aware render transforms |
| `ui/hud.js` | Renders player status, power-up display, speed meter, and minimap from live state |
| `audio_manager.js` | Unlocks/plays music and spatial effects in response to gameplay events |
| `index.html` | Defines splash, menu, Solo Arena, Local PvP Arena, Arena Options, and DOM presentation |

The screen vocabulary is: **Splash Screen**, **Menu Screen**, **Solo Arena Screen**, **Local PvP Arena Screen**, and **Options Screen** (including the Arena Options flow).

## Change Rules

- Make small, testable slices.
- Preserve the shared Sandbox contracts before adding a future mode.
- Put rule changes with the owner of the relevant gameplay truth.
- Keep rendering, menu layout, and audio as consumers of gameplay results.
- When a change touches timing of hits, death, rewards, or destruction, validate the whole event chain: collision → authoritative result → entity cleanup/respawn → VFX/audio/HUD.
