# Zorka: Battle for the Solar Tides

## Project Summary
A top-down Newtonian physics asteroid shooter testbed. The world consists of a 3x3 screen-sized grid (5760x3240) that wraps seamlessly. Players navigate using thrust and braking while aiming with the cursor.

## Core Loop
- Fly the ship using Newtonian physics (inertia preserved, no drag).
- Fire projectiles to destroy and split asteroids (Large -> Medium -> Small).
- Avoid colliding with asteroids (instant death, quick respawn).

## Important Files
- `/game.js`: Central game controller and scene management.
- `/physics.js`: Newtonian motion and wrapping logic.
- `/entities/`: Entity classes for Ship, Asteroid, and Projectile.
- `/camera.js`: Centered camera with wrapping awareness for rendering.
- `/audio_manager.js`: Audio control (Laser, Explosion, Ambience).

## Asset Paths
- Ship: `assets/player_ship.webp`
- Asteroid: `assets/asteroid.webp`
- Projectile: `assets/projectile.webp`
- Background: `assets/space_background.webp`
- SFX: `assets/audio/laser_fire.mp3`, `assets/audio/explosion.mp3`
- Music: `assets/audio/space_ambient.mp3`

## Controls
- **W**: Forward thrust.
- **S**: Braking force (applies opposite to current velocity).
- **Mouse**: Rotate to face cursor.
- **Left Click**: Fire projectile.

## Status
- Core Newtonian controls implemented.
- Wrapping logic applied to all entities and camera view.
- Asteroid splitting logic (3 tiers) active.
- Player death/respawn cycle functional.
- Validation and Runtime checks pending.
