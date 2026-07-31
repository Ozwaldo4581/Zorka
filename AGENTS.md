# Zorka: Battle for the Solar Tides — Agent Guide

You are a JavaScript game-development pair programmer for this repository. Prioritize working, testable progress over perfect process.

This file describes the current repository and protects the ownership boundaries that keep Zorka’s standard arenas, Arcade Mode, and Experimental Mode working from one shared gameplay foundation.

## Project Baseline

Zorka is a local-first, top-down Newtonian asteroid shooter built with plain ES modules and Vite.

The standard wrapped arena is a **17280 × 9720** world: a 9 × 9 grid of 1920 × 1080 design screens. `DESIGN_WIDTH`, `DESIGN_HEIGHT`, `WORLD_WIDTH`, and `WORLD_HEIGHT` in `game.js` are shared contracts for standard modes.

Current game modes are:

- **Solo Arena** — one local player plus NPC ships.
- **Local PvP Arena** — local/split-screen play with up to eight ships.
- **Arcade Mode** — a one-life progression challenge with escalating NPC waves.
- **Experimental Mode** — a separate nine-room campaign shell connected by eight long hallways, with bounded movement, room-local populations, room-aware collision/rendering, and selective simulation.

Baseline desktop controls:

- **W** — forward thrust.
- **S** — counter-thrust/braking by accelerating opposite current velocity.
- **Mouse** — aim/rotate.
- **Left mouse button** — fire.

Controller face buttons dispatch distinct player intents:

- **A** — consume the current capsule stack.
- **X** — apply a Projectile level upgrade.
- **Y** — apply a Speed level upgrade.
- **B** — apply a Shield level upgrade.

Aim locks are player-owned. Missiles prefer their owner’s current valid lock, then use their own automatic fallback target. A different player’s lock cannot redirect them.

Keep these familiar asset locations stable unless asset migration is explicitly requested: `assets/player_ship.webp`, `assets/asteroid.webp`, `assets/projectile.webp`, `assets/space_background.webp`, and core audio under `assets/audio/`.

## 0) Rule Hierarchy

### Hard Rules

- Inspect the relevant code and tests before suggesting or making changes.
- Keep changes small, incremental, and testable.
- Do not duplicate authoritative gameplay state across systems.
- UI, rendering, camera, and audio must not own combat, progression, room membership, or match truth.
- Do not perform large refactors without explaining the concrete need and asking first.
- Preserve the shared `Player`, `Projectile`, hazard, collision-result, reward, and input contracts across modes.
- Standard modes must retain wrapped-world behavior. Experimental Mode may disable wrapping only through its explicit world-rules seam.
- Experimental Mode must remain a separate mode; do not replace or silently alter Solo Arena, Local PvP, or Arcade rules to implement it.
- Online multiplayer is out of scope. `network_manager.js` is legacy and `Game.network` is intentionally `null` in the active build.
- For bugs involving hits, destruction, rewards, HP, shields, death, respawn, room transfer, or timing, inspect the owning gameplay path before patching HUD/menu/audio behavior.

### Strong Defaults

- Work in the smallest complete slice, normally one to three tightly related edits.
- Change the authoritative owner first, consuming logic second, presentation last.
- Classify changed data as authoritative, derived, indexed/accelerating, or presentation-only.
- Treat Experimental indexes as derived acceleration structures. Canonical arrays remain authoritative.
- Reuse `getWorldRules()` rather than adding mode checks throughout entity physics.
- Reuse `getArenaPopulationTargets()` for standard and Experimental density interpretation.
- Validate syntax and run the focused test file after JavaScript edits; run the broader suite when changing shared contracts.
- Do not introduce a framework or build-system change for an ordinary gameplay/UI slice.

### Soft Preferences

- Prefer readable, explicit data flow over clever abstractions.
- Preserve responsive controls and clear momentum feedback.
- Prefer named mode/world-rule seams over scattered string comparisons.
- Keep menu terminology aligned with the actual screens and modes.

## 1) Workflow Expectations

### Default Approach

1. Inspect the smallest relevant code/test bundle.
2. Identify the authoritative owner and any derived indexes or presentation consumers.
3. Make the smallest complete edit.
4. Run a syntax/static check and focused tests where practical.
5. State expected in-game behavior and quick verification steps.

### Default Diagnostic Order

For gameplay defects, inspect in this order:

1. authoritative match/entity owner
2. update, collision, damage, or transition rule
3. spawn/composition/input path
4. derived indexes or world-rule selection
5. camera, HUD, audio, or menu presentation

For startup failures, begin with `main.js`, `game.js`, imports, `package.json`, and the browser console. Do not begin with CSS unless evidence points to overlay/input routing.

For Experimental defects, also trace:

**area definition → room membership/index → active-area filter → collision/render/audio consumer**

For hit/death/reward defects, trace:

**collision → `hitTarget` / `resolvePlayerDamage` → collection mutation/progression → respawn/replacement → VFX/audio/HUD**

## 2) Current Architecture Rules

### 2.1 Runtime Composition and Frame Flow

`main.js` creates `Game` on `window.load` and calls `game.start()`.

`Game` owns bootstrap, assets, screens/modes, match collections, input coordination, update/collision ordering, camera/HUD/audio composition, and cross-entity outcomes.

The practical frame order is:

1. Read keyboard, mouse, and gamepad input.
2. Update living players and NPC intent.
3. Update asteroids, hazards, projectiles, and effects.
4. Apply Experimental wall and room coordination when active.
5. Resolve collisions and authoritative outcomes.
6. Process death, Arcade reconciliation, respawns, and camera targets.
7. Render world, entities, HUD, menus, aim-lock feedback, and presentation effects.

### 2.2 State Ownership

| Owner | Owns |
| --- | --- |
| `Game` (`game.js`) | Mode/screen state, canonical entity collections, arena options, spawning, collision outcomes, rewards, damage/death/respawn, Arcade wave state, Experimental session/rooms/doors/index coordination |
| `Player` (`entities/player.js`) | Position/velocity/aim, local/NPC control state, lock state, capsules, weapon/evolution state, XP/level upgrades, HP, shields/recharge, score/streak data |
| `Asteroid` (`entities/asteroid.js`) | Tier, movement, radius, rotation, hit/destruction state |
| `SpaceDebris` / `Satellite` (`entities/hazards.js`) | Hazard movement, hit state, XP identity, satellite firing cadence |
| `Projectile` (`entities/projectile.js`) | Position/velocity, lifespan, owner, distance cap, weapon flags, missile fallback target, orbital/tentacle state |
| `physics.js` | Stateless Newtonian, wrapping, collision, closest-point, swept-wall, slide, and reflection helpers |
| `world/experimental_rooms.js` | Immutable Experimental area topology, geometry, entrances, progression metadata, and collision categories |
| `camera.js` | Wrapped or direct/room camera transforms; no match truth |
| `ui/hud.js`, `audio_manager.js`, `index.html` | Presentation and intent dispatch only |

Do not mirror capsules, HP, shields, levels, room membership, active-area truth, or arena options in DOM attributes, HUD caches, audio state, or camera state.

### 2.3 State Categories

- **Authoritative state** — canonical live match/entity data that determines gameplay; one owner only.
- **Derived indexes** — Experimental per-area entity sets used to accelerate candidate lookup. They must reconcile with canonical arrays and never become an alternate source of truth.
- **Derived runtime state** — speed display, minimap coordinates, camera target, valid-lock visibility, population counts.
- **Presentation-only state** — menu focus, cursor art, overlay timing, VFX animation, audio playback.

UI may dispatch intent and read state; it must not grant rewards, resolve damage, transfer rooms, or apply mode rules.

### 2.4 Shared Gameplay Boundaries

- `Player` plus `physics.js` own Newtonian movement. Standard modes wrap; Experimental passes `worldRules.wrap === false` and lets wall coordination own boundaries.
- `Game.handleFire()` coordinates projectile insertion; `Player.fire()` defines weapon output.
- `Game.checkCollisions()`, `Game.hitTarget()`, and missile/AoE detonation methods own authoritative combat outcomes.
- `Game.resolvePlayerDamage()` resolves spawn immunity, shield consumption, HP loss, and confirmed death in that order.
- Base HP is five. XP level gains increase maximum and current HP by one.
- HP recharges to full after its configured delay; shields recharge one charge at a time according to Arena Options.
- Shield level upgrades add one maximum charge and grant one current charge.
- Respawn restores HP, movement state, brief immunity, and configured starting shield charges without erasing match-local shield capacity.
- Ordinary Normal, Antigun, and Double projectiles receive independent world-width travel caps. Lasers, missiles, and transformation-specific projectiles remain uncapped by that system.
- Asteroids remain lethal cover and split Large → Medium → Small.
- Debris and satellites grant configured XP but no capsules.
- Enemy ship kills grant a capsule and score/streak progression; NPC kills also grant XP based on NPC level.
- Death clears capsule/temporary weapon state. Hardcore rules also reset level progression.

### 2.5 Modes

#### Solo Arena and Local PvP

Use the standard wrapped world, shared arena populations, shared damage/progression systems, and normal respawn flow. Transformations are enabled.

#### Arcade Mode

- Separate `ARCADE` game state.
- One human player with a random palette color.
- Transformations are disabled.
- Hardcore progression reset is always active.
- NPC waves scale as 1 level-1 bot, 2 level-2 bots, and so on through the eighth wave.
- After reaching eight concurrent NPCs, each replacement increases sequentially from level 9 onward.
- The human has one life; death produces the Arcade game-over summary instead of respawning.
- NPC deaths eliminate them and feed wave reconciliation.

#### Experimental Mode

- Separate `EXPERIMENTAL` game state and cleanup/session lifecycle.
- Nine full-size combat rooms connected in a fixed chain by eight long Room 0 hallways.
- Combat room `n` owns `n` NPCs at level `n` and independently resolves the same Arena Options population targets.
- Hallways have no persistent population and purge transient environment/projectile state on human entry.
- Movement is bounded by thick wall segments rather than wrapped.
- Human ships may pass entrances and commit area membership after doorway clearance; NPCs and large bodies are confined/deflected; projectile representations terminate at blockers; small asteroids can be environmentally destroyed and replaced.
- Cross-room targeting, collision, blast, spatial audio, simulation, and rendering are filtered by current area, with narrow doorway adjacency exceptions for genuine human/environment contact.
- Canonical arrays remain authoritative; per-area indexes accelerate room-local queries.
- Rooms without a human skip expensive NPC targeting/firing, satellite shots, VFX updates, and spatial audio.
- Rendering includes current-area entities plus only the entrance-continuity walls intersecting the viewport, using a documented cull margin.
- Camera and minimap use direct room/area coordinates. Cleanup restores wrapped camera behavior for standard modes.
- Confirmed numbered-area transitions clear tier 1–4 temporary bonuses while preserving shield state and general progression.
- Experimental respawns stay in the player’s current area.

### 2.6 Arena Options

`Game` owns shared option values and application paths:

- asteroid density
- debris density
- satellite density
- starting shield charges
- shield recharge rate
- bot aggression
- hardcore mode
- cursor style and control presentation preferences

`getArenaPopulationTargets()` is the shared population resolver. Experimental applies those targets independently to every combat room; standard modes apply them globally.

### 2.7 Presentation Responsibilities

Use these terms consistently:

- Splash Screen
- Menu Screen
- Solo Arena Screen
- Local PvP Arena Screen
- Arcade Mode / Arcade Game Over
- Experimental Screen / Experimental Mode
- Options Screen / Arena Options
- In-game Pause Menu

`index.html` owns DOM layout and controls. `game.js` owns transitions and rules invoked by those controls. The pause menu floats over play and does not pause simulation.

## 3) File Inspection Heuristics

| Problem | Inspect first |
| --- | --- |
| Menu, mode buttons, screen transitions, Arena Options | `index.html`, `game.js`, then `main.js` |
| Thrust, braking, aim, controls, NPC motion | `entities/player.js`, `physics.js`, then `game.js` |
| Aim lock or missile targeting | `game.js`, `entities/projectile.js`, `entities/player.js` |
| Projectile output/travel cap | `entities/player.js`, `entities/projectile.js`, `game.js` |
| HP, shields, recharge, level upgrades | `entities/player.js`, `game.js`, `ui/hud.js` |
| Arcade waves/game over | `game.js`, Arcade DOM in `index.html`, `test/arena-leveling.test.js` |
| Experimental topology/population | `world/experimental_rooms.js`, `game.js`, Experimental tests |
| Experimental walls/doors/room transfer | `physics.js`, `world/experimental_rooms.js`, `game.js` |
| Experimental performance/culling | `game.js`, `camera.js`, `ui/hud.js`, performance/minimap tests |
| Asteroid tiers/collision | `entities/asteroid.js`, `physics.js`, `game.js` |
| Debris/satellite behavior/rewards | `entities/hazards.js`, `game.js`, `entities/projectile.js` |
| Audio/HUD incorrect after an event | authoritative event owner first, then `audio_manager.js` / `ui/hud.js` |
| Vite/import startup failure | `package.json`, `main.js`, `game.js`, browser console |

## 4) Code Change Output

When reporting a code change, include:

- file path
- method/section changed
- why it belongs at that ownership seam
- expected in-game behavior
- focused tests or quick debug checks

Provide exact replacements for small edits. Provide a full file only when edits span multiple regions or the user requests it.

After each completed slice, state what is complete, expected behavior, tests run, and likely failure points to check quickly.

## 5) Refactors

Suggest a refactor only when current structure blocks progress, the same ownership problem recurs, or shared/Experimental branches have become unsafe to maintain.

Before a broad refactor:

1. identify the concrete wrong seam
2. propose the smallest viable extraction
3. explain why an ordinary slice is insufficient
4. ask before implementing

Do not refactor for theoretical purity alone. In particular, do not extract Experimental indexes or world rules into alternate canonical state.

## 6) Gameplay Philosophy

Zorka is driven by intuitive Newtonian flight, momentum, tactical cover, risk/reward progression, and readable escalation.

Core loop:

- Fly with inertia and counter-thrust to brake.
- Fight ships and navigate lethal asteroid/hazard fields.
- Gain XP from hazards and NPCs; gain capsules from ship kills.
- Choose Projectile, Speed, or Shield level upgrades and spend capsule stacks on stronger temporary capabilities.
- Use spacing, angles, locks, cover, shields, and HP recovery to survive.

Mode-specific expression:

- Standard arenas emphasize reusable sandbox combat.
- Arcade emphasizes one-life escalating survival.
- Experimental emphasizes room progression, bounded spaces, doorway traversal, and room-local simulation.

Priority:

**clarity > cleverness**

**ownership > convenience**

**shared entity/rule contracts > mode forks**

**canonical state > derived indexes**

**incremental progress > large refactors**
