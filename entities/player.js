import { updateNewtonian, checkCollision, nearestWrappedDisplacement, wrapCoordinate } from '../physics.js';
import { Projectile } from './projectile.js';
import { DESIGN_WIDTH, DESIGN_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT } from '../game.js';

export class Player {
    constructor(x, y, id = 1, color = '#00ffff') {
        this.x = x;
        this.y = y;
        this.id = id; 
        this.color = color;
        this.vx = 0;
        this.vy = 0;
        this.rotation = 0;
        this.radius = 25;
        this.thrust = 800;
        this.brakeForce = 400;
        this.isDead = false;
        this.respawnTimer = 0;
        this.fireCooldown = 0;
        this.isNPC = false;
        this.wasdMode = 'RELATIVE';
        this.aimLockActive = false;
        this.aimLockType = null;
        this.lockedAimX = null;
        this.lockedAimY = null;
        this.lockedAimTarget = null;
        
        // Power-up System
        this.powerUpCapsules = 0;
        this.maxPowerUpSlots = 5;
        this.activeGun = 'Normal'; // Normal, Antigun, Double, Laser
        this.slot1Type = Math.random() < 0.5 ? 'Antigun' : 'Double'; // Randomize slot 1 type on spawn
        this.ghosts = []; // List of Ghost entities
        this.hasForcefield = false;
        this.shieldCharges = 0;
        this.hasMissile = false;
        this.missileCooldown = 0;
        this.missileReloadLevel = 0; // Increases each time Missile capsule is selected
        this.martianParallelGuns = 1; // Base is 1 for Martian
        this.bonusSpeed = 0; // For Event Horizon Horror
        
        // Burst fire system
        this.burstCount = 0;
        this.burstTimer = 0;
        this.shouldTriggerBurstFire = false;
        
        // NPC specific
        this.npcTarget = null;
        this.npcThinkTimer = 0;
        this.score = 0;
        this.prestigeLevel = 0; // Number of stars
        this.justPrestiged = false;
        this.name = `EARTHLING ${id}`;
        this.isMartian = false;
        this.isCyborg = false;
        this.isDimensionX = false;
        this.isEventHorizon = false;
        this.isEliminated = false; 

        // Spawn immunity
        this.spawnImmunityTimer = 1.0; 

        // NPC accuracy: 1-5 scale (1 = 60%, 5 = 95%). Lower accuracy means the NPC
        // will aim at a random offset near the target instead of directly at it.
        this.accuracyLevel = 1;

        // Kill streak tracking: killStreak resets to 0 on death; highTide records the
        // highest kill streak this ship has ever reached in the current session.
        this.killStreak = 0;
        this.highTide = 0;

        // NPC Personality / Behavior state
        this.npcBehaviorTimer = 0;
        this.npcBehaviorState = 'NORMAL'; // NORMAL, FLEE, NO_FIRE
        this.npcWanderAngle = Math.random() * Math.PI * 2;
    }

    // Randomly picks a new aggression and accuracy level.
    rollAggression() {
        this.aggressionLevel = 1 + Math.floor(Math.random() * 5);
        this.rollAccuracy();
    }

    rollAccuracy() {
        this.accuracyLevel = 1 + Math.floor(Math.random() * 5);
    }

    clearAimLock() {
        this.aimLockActive = false;
        this.aimLockType = null;
        this.lockedAimX = null;
        this.lockedAimY = null;
        this.lockedAimTarget = null;
    }

    beginAimLock(worldX, worldY, target = null) {
        this.aimLockActive = true;
        this.aimLockType = target ? 'ENTITY' : 'POINT';
        this.lockedAimTarget = target;
        this.lockedAimX = target ? target.x : wrapCoordinate(worldX, WORLD_WIDTH);
        this.lockedAimY = target ? target.y : wrapCoordinate(worldY, WORLD_HEIGHT);
    }

    resolveAimLock(asteroids) {
        if (!this.aimLockActive || this.aimLockType !== 'ENTITY') return;

        const target = this.lockedAimTarget;
        const targetIsValid = target
            && asteroids.includes(target)
            && !target.isDestroyed
            && Number.isFinite(target.x)
            && Number.isFinite(target.y);

        if (targetIsValid) {
            this.lockedAimX = target.x;
            this.lockedAimY = target.y;
            return;
        }

        // Preserve the last valid position rather than retargeting or returning to live aim.
        this.aimLockType = 'POINT';
        this.lockedAimTarget = null;
    }

    setEvolutionForm(form) {
        this.isMartian = form === 'MARTIAN';
        this.isCyborg = form === 'CYBORG';
        this.isDimensionX = form === 'DIMENSION X';
        this.isEventHorizon = false;
        this.name = this.isNPC ? `${form} BOT ${this.id}` : `${form} ${this.id}`;
    }

    updateEvolutionState(transformationKills = 20) {
        const killsPerStep = Math.max(1, transformationKills || 1);
        const prestigeThreshold = killsPerStep * 4;

        this.justPrestiged = false;

        if (this.score >= prestigeThreshold) {
            const prestigeGained = Math.floor(this.score / prestigeThreshold);
            this.prestigeLevel += prestigeGained;
            this.score = this.score % prestigeThreshold;
            this.justPrestiged = true;
        }

        if (this.score >= killsPerStep * 3) {
            this.setEvolutionForm('DIMENSION X');
        } else if (this.score >= killsPerStep * 2) {
            this.setEvolutionForm('CYBORG');
        } else if (this.score >= killsPerStep) {
            this.setEvolutionForm('MARTIAN');
        } else {
            this.setEvolutionForm('EARTHLING');
        }
    }

    update(dt, keys, mouse, camera, others = [], asteroids = [], gamepads = [], isSplitScreen = false, transformationKills = 20, hazards = []) {
        if (this.isDead) {
            this.clearAimLock();
            return;
        }

        // Update immunity
        if (this.spawnImmunityTimer > 0) {
            this.spawnImmunityTimer -= dt;
        }

        // Evolution Check
        this.updateEvolutionState(transformationKills);

        // Handle Ghost Movement
        this.updateGhosts(dt);

        // Handle Burst Fire Logic
        if (this.burstCount > 0) {
            this.burstTimer -= dt;
            if (this.burstTimer <= 0) {
                this.burstCount--;
                this.burstTimer = 0.05; 
                this.shouldTriggerBurstFire = true; 
            }
        }

        let fx = 0;
        let fy = 0;
        this.shouldFire = false;
        this.isThrusting = false;

        // Handle Gamepad Input
        let gp = null;
        if (this.id === 1) {
            const gamepadsList = Array.from(gamepads).filter(g => g !== null);
            if (this.controlMode === 'GAMEPAD' && gamepadsList.length > 0) {
                // P1 always takes Pad 0 whenever GAMEPAD mode is selected/forced,
                // in Solo, PVP (split-screen), and Online - even with only 1 pad connected.
                gp = gamepadsList[0];
            }
        } else if (this.id === 2) {
            // P2 is always Gamepad-only, and must use a DIFFERENT physical controller than P1
            const gamepadsList = Array.from(gamepads).filter(g => g !== null);
            const p1 = others.find(p => p.id === 1);
            const p1OnGamepad = p1 && p1.controlMode === 'GAMEPAD';
            if (p1OnGamepad) {
                if (gamepadsList.length >= 2) gp = gamepadsList[1]; // P2 takes second pad
            } else {
                if (gamepadsList.length >= 1) gp = gamepadsList[0]; // P2 takes the only pad
            }
        }

        if (this.isNPC) {
            this.updateNPC(dt, others, asteroids, (f) => { fx = f.x; fy = f.y; }, hazards);
        } else if (this.id === 1) {
            // Player 1: Controller OR Keyboard
            if (gp) {
                this.clearAimLock();
                const lsX = gp.axes[0];
                const lsY = gp.axes[1];
                const deadzone = 0.15;

                if (Math.abs(lsX) > deadzone || Math.abs(lsY) > deadzone) {
                    fx += lsX * this.thrust;
                    fy += lsY * this.thrust;
                    this.isThrusting = true;
                }

                const rsX = gp.axes[2];
                const rsY = gp.axes[3];
                if (Math.abs(rsX) > deadzone || Math.abs(rsY) > deadzone) {
                    this.rotation = Math.atan2(rsY, rsX) + Math.PI / 2;
                }

                if (gp.buttons[0].pressed || gp.buttons[1].pressed) {
                    this.activatePowerUp();
                }

            }
            
            // Only use Keyboard/Mouse fallback when P1 hasn't chosen Gamepad control,
            // or no gamepad is actually connected. When GAMEPAD mode is active with a
            // pad connected, the right stick has full authority over aiming.
            if (this.controlMode !== 'GAMEPAD' || !gp) {
                // Fallback to Keyboard/Mouse
                // If split screen, anchor is at 1/4 width (center of left half)
                const anchorX = isSplitScreen ? (DESIGN_WIDTH / 4) : (DESIGN_WIDTH / 2);

                if (mouse.m2Released || !mouse.m2Held) this.clearAimLock();

                if (this.aimLockActive) {
                    this.resolveAimLock(asteroids);
                    const delta = nearestWrappedDisplacement(this.x, this.y, this.lockedAimX, this.lockedAimY);
                    if (Math.hypot(delta.x, delta.y) > 2) {
                        this.rotation = Math.atan2(delta.y, delta.x) + Math.PI / 2;
                    }
                } else {
                    const dx = mouse.x - anchorX;
                    const dy = mouse.y - (DESIGN_HEIGHT / 2);
                    const mouseDeadzone = 2;
                    if (Math.abs(dx) > mouseDeadzone || Math.abs(dy) > mouseDeadzone || mouse.clicked) {
                        this.rotation = Math.atan2(dy, dx) + Math.PI / 2;
                    }
                }

                if (this.wasdMode === 'ABSOLUTE' && !this.aimLockActive) {
                    if (keys['KeyW']) fy -= this.thrust;
                    if (keys['KeyS']) fy += this.thrust;
                    if (keys['KeyA']) fx -= this.thrust;
                    if (keys['KeyD']) fx += this.thrust;
                    this.isThrusting = Boolean(keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD']);
                } else {
                    if (keys['KeyW']) {
                        fx += Math.sin(this.rotation) * this.thrust;
                        fy -= Math.cos(this.rotation) * this.thrust;
                        this.isThrusting = true;
                    }
                    if (keys['KeyS']) {
                        fx -= Math.sin(this.rotation) * this.thrust;
                        fy += Math.cos(this.rotation) * this.thrust;
                        this.isThrusting = true;
                    }
                    if (keys['KeyA']) {
                        fx -= Math.cos(this.rotation) * this.thrust;
                        fy -= Math.sin(this.rotation) * this.thrust;
                        this.isThrusting = true;
                    }
                    if (keys['KeyD']) {
                        fx += Math.cos(this.rotation) * this.thrust;
                        fy += Math.sin(this.rotation) * this.thrust;
                        this.isThrusting = true;
                    }
                }
                
                if (keys['Space']) {
                    this.activatePowerUp();
                    keys['Space'] = false;
                }

            }
        } else if (this.id === 2) {
            // Player 2: Controller ONLY
            if (gp) {
                const lsX = gp.axes[0];
                const lsY = gp.axes[1];
                const deadzone = 0.15;

                if (Math.abs(lsX) > deadzone || Math.abs(lsY) > deadzone) {
                    fx += lsX * this.thrust;
                    fy += lsY * this.thrust;
                    this.isThrusting = true;
                }

                const rsX = gp.axes[2];
                const rsY = gp.axes[3];
                if (Math.abs(rsX) > deadzone || Math.abs(rsY) > deadzone) {
                    this.rotation = Math.atan2(rsY, rsX) + Math.PI / 2;
                }

                if (gp.buttons[0].pressed || gp.buttons[1].pressed) {
                    this.activatePowerUp();
                }

            }
            // NO KEYBOARD FALLBACK FOR P2
        }

        updateNewtonian(this, dt, { x: fx, y: fy });
        
        // Speed cap
        let maxSpeed = 800;
        if (this.isEventHorizon) {
            maxSpeed += this.bonusSpeed;
        }
        const currentSpeed = Math.hypot(this.vx, this.vy);
        if (currentSpeed > maxSpeed) {
            this.vx = (this.vx / currentSpeed) * maxSpeed;
            this.vy = (this.vy / currentSpeed) * maxSpeed;
        }

        if (this.fireCooldown > 0) this.fireCooldown -= dt;
        if (this.missileCooldown > 0) this.missileCooldown -= dt;
    }

    updateGhosts(dt) {
        if (this.isEventHorizon || this.isDead) {
            this.ghosts = [];
            return;
        }
        // Ghost logic: follow player breadcrumbs
        if (!this.history) this.history = [];
        this.history.unshift({ x: this.x, y: this.y, rotation: this.rotation });
        if (this.history.length > 180) this.history.pop(); // Increased buffer to accommodate tripled delay (2 ghosts * 45 + cushion)

        this.ghosts.forEach((ghost, i) => {
            // Calculate delay based on ship size to maintain "just over 1 ship" distance
            let shipSize = this.radius * 3.5;
            if (this.isMartian) shipSize *= 2;
            else if (this.isCyborg) shipSize *= 1.3;
            else if (this.isDimensionX) shipSize *= 1.6;
            
            // At max speed (800), one frame is ~13.3px. 
            // We want (shipSize + cushion) / 13.3 frames.
            const framesPerShip = Math.ceil((shipSize + 15) / 13.3);
            const delay = (i + 1) * framesPerShip;
            
            const pos = this.history[Math.min(delay, this.history.length - 1)];
            if (pos) {
                ghost.x = pos.x;
                ghost.y = pos.y;
                // Mirror aiming direction in real time
                ghost.rotation = this.rotation;
            }
        });
    }

    updateNPC(dt, others, asteroids, setForce, hazards = []) {
        if (this.isDummy) {
            setForce({ x: 0, y: 0 });
            return;
        }
        this.npcThinkTimer -= dt;
        this.npcBehaviorTimer -= dt;

        // Personality/Behavior state transitions
        if (this.npcBehaviorTimer <= 0) {
            if (this.aggressionLevel === 1) { // Timmy
                // 30% chance to flee for 2-4 seconds
                if (Math.random() < 0.3 && this.npcBehaviorState === 'NORMAL') {
                    this.npcBehaviorState = 'FLEE';
                    this.npcBehaviorTimer = 2 + Math.random() * 2;
                } else {
                    this.npcBehaviorState = 'NORMAL';
                    this.npcBehaviorTimer = 3 + Math.random() * 5;
                }
            } else if (this.aggressionLevel === 2) { // Gus
                // 40% chance to stop shooting for 1-3 seconds
                if (Math.random() < 0.4 && this.npcBehaviorState === 'NORMAL') {
                    this.npcBehaviorState = 'NO_FIRE';
                    this.npcBehaviorTimer = 1 + Math.random() * 2;
                } else {
                    this.npcBehaviorState = 'NORMAL';
                    this.npcBehaviorTimer = 3 + Math.random() * 4;
                }
            } else {
                this.npcBehaviorState = 'NORMAL';
                this.npcBehaviorTimer = 10;
            }
        }

        // Aggression Range: 1-5 scale set on spawn/respawn (see rollAggression()).
        // Scaled 3x linearly to match the 9x9 world expansion (from 3x3).
        const aggressionRange = 900 + this.aggressionLevel * 900; // Level 1 = 1800, Level 5 = 5400

        // Target selection priority:
        // 1. Nearest alive player/NPC within aggression range
        // 2. Nearest satellite or debris within aggression range (if no players found)
        if (this.npcThinkTimer <= 0) {
            this.npcThinkTimer = 0.5 + Math.random();
            let minDist = Infinity;
            this.npcTarget = null;
            
            // Priority 1: Players
            others.forEach(other => {
                if (other === this || other.isDead) return;
                const d = Math.hypot(other.x - this.x, other.y - this.y);
                if (d < minDist && d <= aggressionRange) {
                    minDist = d;
                    this.npcTarget = other;
                }
            });

            // Priority 2: Hazards (if no players in range)
            if (!this.npcTarget) {
                hazards.forEach(h => {
                    if (h.isDestroyed) return;
                    const d = Math.hypot(h.x - this.x, h.y - this.y);
                    if (d < minDist && d <= aggressionRange) {
                        minDist = d;
                        this.npcTarget = h;
                    }
                });
            }

            // Update wander angle occasionally if no target
            if (!this.npcTarget) {
                this.npcWanderAngle += (Math.random() - 0.5) * 2;
            }
        }

        // --- Asteroid Avoidance (predictive) ---
        // NPCs steer away from asteroids, but with human-like error and awareness lapses.
        let avoidFx = 0, avoidFy = 0;
        let threatLevel = 0; 
        const detectionRange = 180; // Reduced from 260
        const lookAheadTime = 0.7; // Reduced from 1.1
        
        // Random "awareness lapse": 20% of the time, bots are less effective at dodging
        const hasAwarenessLapse = Math.random() < 0.2;

        asteroids.forEach(a => {
            const dx = a.x - this.x;
            const dy = a.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= 0) return;

            // Near-field repulsion
            const avoidDist = a.radius + detectionRange;
            if (dist < avoidDist && !hasAwarenessLapse) {
                // Reduced force multiplier from 2.2 to 1.5
                const forceMag = (1 - dist / avoidDist) * this.thrust * 1.5;
                avoidFx -= (dx / dist) * forceMag;
                avoidFy -= (dy / dist) * forceMag;
                threatLevel = Math.max(threatLevel, 1 - dist / avoidDist);
            }

            // Predictive check
            const relVx = a.vx - this.vx;
            const relVy = a.vy - this.vy;
            const futureDx = dx + relVx * lookAheadTime;
            const futureDy = dy + relVy * lookAheadTime;
            const futureDist = Math.hypot(futureDx, futureDy);
            const collisionThreshold = a.radius + this.radius + 30; // Reduced buffer from 50 to 30
            if (dist < 500 && futureDist < collisionThreshold) {
                // Randomize avoidance slightly so they don't always pick the perfect path
                const errorAngle = (Math.random() - 0.5) * 0.5;
                const cosE = Math.cos(errorAngle);
                const sinE = Math.sin(errorAngle);
                
                // Reduced force multiplier from 2.4 to 1.8
                const forceMag = this.thrust * (hasAwarenessLapse ? 0.8 : 1.8);
                
                const rawAvoidX = -(dx / dist) * forceMag;
                const rawAvoidY = -(dy / dist) * forceMag;
                
                avoidFx += rawAvoidX * cosE - rawAvoidY * sinE;
                avoidFy += rawAvoidX * sinE + rawAvoidY * cosE;
                threatLevel = Math.max(threatLevel, hasAwarenessLapse ? 0.5 : 1);
            }
        });

        const isEvading = threatLevel > 0;
        // The more urgent the avoidance, the less the NPC prioritizes chasing its target
        const chaseWeight = isEvading ? Math.max(0, 1 - threatLevel) : 1;

        let fx = 0, fy = 0;
        if (this.npcTarget) {
            const dx = this.npcTarget.x - this.x;
            const dy = this.npcTarget.y - this.y;
            
            // Apply accuracy offset: lower accuracy = higher random deviation in aim
            // 1 = 60% accuracy, 5 = 95% accuracy
            const accuracyBase = 0.6 + (this.accuracyLevel - 1) * 0.0875; // 0.6 to 0.95
            let targetRot = Math.atan2(dy, dx) + Math.PI / 2;
            
            if (Math.random() > accuracyBase) {
                const spread = (1 - accuracyBase) * 1.5; // Max ~0.6 radians spread at lowest accuracy
                targetRot += (Math.random() - 0.5) * spread;
            }

            // Timmy (lvl 1) flee logic: run away if in FLEE state
            if (this.npcBehaviorState === 'FLEE') {
                targetRot += Math.PI; // Face away
            }

            // Smooth rotate (still track the target even while dodging, so it can keep firing)
            const diff = targetRot - this.rotation;
            this.rotation += Math.max(-4 * dt, Math.min(4 * dt, diff));

            const dist = Math.hypot(dx, dy);
            
            if (this.npcBehaviorState === 'FLEE') {
                // Thrust away at full speed
                fx = Math.sin(this.rotation) * this.thrust * chaseWeight;
                fy = -Math.cos(this.rotation) * this.thrust * chaseWeight;
                if (chaseWeight > 0) this.isThrusting = true;
            } else {
                if (dist > 300) {
                    fx = Math.sin(this.rotation) * this.thrust * chaseWeight;
                    fy = -Math.cos(this.rotation) * this.thrust * chaseWeight;
                    if (chaseWeight > 0) this.isThrusting = true;
                } else if (dist < 150) {
                    fx = -Math.sin(this.rotation) * this.thrust * chaseWeight;
                    fy = Math.cos(this.rotation) * this.thrust * chaseWeight;
                    if (chaseWeight > 0) this.isThrusting = true;
                }
            }

            // Fire if roughly facing target and within engagement range (scales with aggression)
            // Gus (lvl 2) stops shooting in NO_FIRE state
            const gusCanFire = this.npcBehaviorState !== 'NO_FIRE';
            const isFacingTarget = this.npcBehaviorState === 'FLEE' ? false : (Math.abs(diff) < 0.3);

            if (isFacingTarget && dist < aggressionRange && gusCanFire) {
                this.shouldFire = true;
            }

            // NPC Power-up logic: Use if capsules are high or defensive needed
            if (this.powerUpCapsules > 0) {
                const shouldActivate = (this.powerUpCapsules >= 4) || (this.powerUpCapsules >= 1 && Math.random() < 0.01);
                if (shouldActivate) {
                    this.activatePowerUp();
                }
            }
        } else {
            // Wandering behavior when no target
            // Non-aggressive travel speed set to 50%
            const travelWeight = 0.5;
            this.rotation += (this.npcWanderAngle - this.rotation) * dt * 2;
            fx = Math.sin(this.rotation) * this.thrust * travelWeight * chaseWeight;
            fy = -Math.cos(this.rotation) * this.thrust * travelWeight * chaseWeight;
            if (chaseWeight > 0) this.isThrusting = true;
        }

        fx += avoidFx;
        fy += avoidFy;
        if (isEvading) this.isThrusting = true;

        setForce({ x: fx, y: fy });
    }

    addCapsule() {
        if (this.isEventHorizon) return; // Event Horizon Horror does not gain power-ups
        this.powerUpCapsules++;
        if (this.powerUpCapsules > this.maxPowerUpSlots) {
            this.powerUpCapsules = 1;
        }
    }

    activatePowerUp() {
        if (this.powerUpCapsules === 0) return;

        const slot = this.powerUpCapsules;
        let success = true;

        switch (slot) {
            case 1: // Random Antigun or Double
                this.activeGun = this.slot1Type;
                break;
            case 2: // Missile
                this.hasMissile = true;
                this.missileReloadLevel++;
                break;
            case 3: // Laser (or Martian Parallel Guns)
                if (this.isMartian) {
                    if (this.martianParallelGuns === 1) {
                        this.martianParallelGuns = 2;
                    } else {
                        this.martianParallelGuns++;
                    }
                } else {
                    this.activeGun = 'Laser';
                }
                break;
            case 4: // Ghost
                if (this.ghosts.length < 2) {
                    this.ghosts.push({ x: this.x, y: this.y, rotation: this.rotation });
                } else {
                    success = false;
                    this.powerUpError = 'GHOST MAXED';
                }
                break;
            case 5: // Forcefield
                this.hasForcefield = true;
                this.shieldCharges = (this.shieldCharges || 0) + 1;
                break;
        }

        if (success) {
            this.powerUpCapsules = 0;
            this.powerUpError = null;
        }
    }

    fire(isBurstShot = false) {
        if (this.isEventHorizon) return null; // Event Horizon Horror does not shoot projectiles
        if (this.spawnImmunityTimer > 0) return null; // Cannot shoot during immunity

        if (this.fireCooldown <= 0 || isBurstShot) {
            // Main weapon logic
            const projectiles = [];
            
            // Check if this weapon supports burst
            const isBurstWeapon = (this.activeGun === 'Normal' || this.activeGun === 'Antigun' || this.activeGun === 'Double');

            if (!isBurstShot) {
                // Martian tier fires faster single shots instead of bursts
                this.fireCooldown = (isBurstWeapon && !this.isMartian) ? 0.75 : 0.35; 
                if (isBurstWeapon && !this.isMartian && !this.isCyborg && !this.isDimensionX) {
                    this.burstCount = 2; // Queue 2 more shots (total 3 shots per cycle)
                    this.burstTimer = 0.05; // Rate of fire (0.05)
                }
            }

            // Main Gun Fire
            const mainProjs = this.getGunProjectiles(this.x, this.y, this.rotation);
            projectiles.push(...mainProjs);

            // Ghost Fire
            this.ghosts.forEach(ghost => {
                const ghostProjs = this.getGunProjectiles(ghost.x, ghost.y, ghost.rotation);
                ghostProjs.forEach(p => p.isGhost = true);
                projectiles.push(...ghostProjs);
            });

        // Missile Add-on (only on initial shot, not bursts)
        if (!isBurstShot && this.missileCooldown <= 0 && this.hasMissile) {
            // Missile reload time tripled from 1.0 to 3.0. 
            // Every time capsule is selected, reload time decreases by 0.5s (min 0.5s)
            const baseReload = 3.0;
            this.missileCooldown = Math.max(0.5, baseReload - (this.missileReloadLevel - 1) * 0.5);
            const m = this.createMissile(this.x, this.y, this.rotation);
                projectiles.push(m);
                
                this.ghosts.forEach(ghost => {
                    projectiles.push(this.createMissile(ghost.x, ghost.y, ghost.rotation));
                });
            }

            return projectiles;
        }
        return null;
    }

    createMissile(x, y, rotation) {
        const speed = 560; // Reduced to 70% (800 -> 560)
        const vx = Math.sin(rotation) * speed;
        const vy = -Math.cos(rotation) * speed;
        const p = new Projectile(x, y, vx, vy, this.color);
        p.owner = this;
        p.isMissile = true;
        p.radius = 14; // Larger missile body/hitbox
        p.aoeRadius = 160; // Large area-of-effect blast radius on detonation
        return p;
    }

    getGunProjectiles(x, y, rotation) {
        const projs = [];
        const speed = 1200;

        const createProj = (angle, noWrap = false, offsetX = 0, offsetY = 0) => {
            const projSpeed = this.isCyborg ? speed * 0.5 : speed; // Cyborg orbs move 50% slower
            const vx = Math.sin(angle) * projSpeed;
            const vy = -Math.cos(angle) * projSpeed;
            
            // Base offset from ship center (larger offset for larger ships)
            let spawnOffset = 40;
            if (this.isMartian) spawnOffset = 80;
            else if (this.isDimensionX) spawnOffset = 64; // Scaled with ship size
            else if (this.isCyborg) spawnOffset = 52;
            
            let sx = x + Math.sin(angle) * spawnOffset;
            let sy = y - Math.cos(angle) * spawnOffset;
            
            // Parallel offset (for Martian Laser upgrade)
            if (offsetX !== 0 || offsetY !== 0) {
                const perpAngle = angle + Math.PI / 2;
                sx += Math.cos(perpAngle) * offsetX;
                sy += Math.sin(perpAngle) * offsetX;
            }

            const p = new Projectile(sx, sy, vx, vy, this.color);
            p.owner = this;
            if (noWrap) p.canWrap = false;
            
            // Martian base projectile is a laser
            if (this.isMartian) {
                p.isLaser = true;
                p.lifeSpan = 10;
                p.canWrap = true; // Enabled wrapping
            }

            // Cyborg base projectile is a single shot orb
            if (this.isCyborg) {
                p.isLaser = false;
                p.radius = 45; // Reduced to 75% of previous size (60 -> 45)
                p.lifeSpan = 1.8; // Increased lifespan to compensate for slower speed
                p.aoeRadius = 80; // Adjusted AoE proportionally
            }

            // Dimension X base projectile is a tentacle
            if (this.isDimensionX) {
                p.isLaser = false;
                p.isTentacle = true;
                p.radius = 16; // Scaled down with ship
                p.lifeSpan = 1.0; // Life handled by tentacle phase logic
            }
            
            // Infinite life for standard ballistic types (Normal, Antigun, Double)
            if (this.activeGun !== 'Laser' && !this.isMartian && !this.isCyborg && !this.isDimensionX) {
                p.lifeSpan = 999999;
            }
            
            return p;
        };

        const addBurstPair = (angle) => {
            if (this.isMartian) {
                // Parallel guns for Martian (scaled by capsule 4)
                const count = this.martianParallelGuns || 1;
                const totalWidth = (count - 1) * 30;
                const startOffset = -totalWidth / 2;
                for (let i = 0; i < count; i++) {
                    projs.push(createProj(angle, false, startOffset + i * 30));
                }
            } else if (this.isCyborg && this.activeGun === 'Laser') {
                // Cyborg Laser powerup: Decoy (Fake Asteroid)
                const dp = createProj(angle);
                dp.isDecoy = true;
                dp.radius = 50; // Hitbox for the large decoy
                dp.lifeSpan = 5.0; // Lasts longer
                dp.vx *= 0.25; // Moves slower like an asteroid
                dp.vy *= 0.25;
                projs.push(dp);
            } else if (this.isDimensionX && this.activeGun === 'Laser') {
                // Dimension X Laser powerup: Dual tentacles
                projs.push(createProj(angle - 0.3));
                projs.push(createProj(angle + 0.3));
            } else {
                projs.push(createProj(angle, this.isMartian)); // Martian base is laser, others are not
            }
        };

        switch (this.activeGun) {
            case 'Antigun':
                projs.push(createProj(rotation, false));
                projs.push(createProj(rotation + Math.PI, false));
                break;
            case 'Double':
                projs.push(createProj(rotation - 0.25, false));
                projs.push(createProj(rotation + 0.25, false));
                break;
            case 'Laser':
                if (this.isMartian) {
                    addBurstPair(rotation);
                } else {
                    const lp = createProj(rotation, false); // Standard laser now wraps
                    lp.isLaser = true;
                    lp.lifeSpan = 10;
                    lp.canWrap = true;
                    projs.push(lp);
                }
                break;
            default: // Normal
                if (this.isMartian) {
                    addBurstPair(rotation);
                } else {
                    addBurstPair(rotation);
                }
                break;
        }
        return projs;
    }

    drawSpriteWithTint(ctx, img, size, accentAlpha = 0.7) {
        if (this.color === '#00ffff' || this.isDimensionX) {
            ctx.drawImage(img, -size / 2, -size / 2, size, size);
            return;
        }

        const filter = this.getHueFilter(this.color);
        if (!filter) {
            ctx.drawImage(img, -size / 2, -size / 2, size, size);
            return;
        }

        ctx.save();
        ctx.filter = filter;
        ctx.drawImage(img, -size / 2, -size / 2, size, size);
        ctx.restore();
    }

    draw(ctx, assets, camera) {
        // Draw Ghosts
        this.ghosts.forEach(ghost => {
            ctx.save();
            camera.apply(ctx, ghost.x, ghost.y);
            ctx.rotate(ghost.rotation);
            ctx.globalAlpha = 0.5;
            let size = this.radius * 3.5;
            if (this.isMartian) size *= 2; 
            else if (this.isDimensionX) size *= 2.4; // Increased by 50% (1.6 * 1.5 = 2.4)
            else if (this.isEventHorizon) size *= (1 + (this.highTide || 0) * 0.02); // More reasonable scaling
            else if (this.isCyborg) size *= 1.3;
            let img = assets.ship;
            if (this.isMartian) img = assets.ufo;
            if (this.isCyborg) img = assets.cyborg;
            if (this.isDimensionX) img = assets.dimensionX;
            if (this.isEventHorizon) img = assets.eventHorizon;
            this.drawSpriteWithTint(ctx, img, size, 0.45);
            ctx.restore();
        });

        // Draw Player
        ctx.save();
        camera.apply(ctx, this.x, this.y);
        
        // Forcefield
        if (this.hasForcefield) {
            ctx.strokeStyle = this.color; // Match ship color
            ctx.lineWidth = 3;
            ctx.beginPath();
            const shieldRadius = this.radius * 2.2;
            ctx.arc(0, 0, shieldRadius, 0, Math.PI * 2);
            ctx.stroke();

            // Shield charges number
            if (this.shieldCharges > 0) {
                ctx.save();
                // Number stays fixed (drawn BEFORE ship rotation)
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 16px Orbitron';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                // Position at bottom right outside the shield
                const offset = shieldRadius + 10;
                ctx.fillText(this.shieldCharges, offset, offset);
                ctx.restore();
            }
        }

        // Spawn Immunity Flashing
        if (this.spawnImmunityTimer > 0) {
            ctx.globalAlpha = 0.5 + Math.sin(Date.now() * 0.02) * 0.3;
        }

        ctx.rotate(this.rotation);
        
        let size = this.radius * 3.6;
        if (this.isMartian) size *= 2;
        else if (this.isDimensionX) size *= 1.6; // 4 * 0.4 = 1.6
        else if (this.isEventHorizon) size *= (1 + (this.highTide || 0) * 0.02);
        else if (this.isCyborg) size *= 1.3;
        let img = assets.ship;
        if (this.isMartian) img = assets.ufo;
        if (this.isCyborg) img = assets.cyborg;
        if (this.isDimensionX) img = assets.dimensionX;
        if (this.isEventHorizon) img = assets.eventHorizon;
        this.drawSpriteWithTint(ctx, img, size, 0.7);
        ctx.restore();
    }

    getHueFilter(color) {
        // Approximate hue rotation from cyan (#00ffff) to target color
        const colors = {
            '#00ffff': '', // Cyan (Original)
            '#ff00ff': 'hue-rotate(120deg)', // Magenta
            '#ffff00': 'hue-rotate(-60deg)', // Yellow
            '#ff0000': 'hue-rotate(180deg)', // Red
            '#00ff00': 'hue-rotate(-120deg)', // Green
            '#0000ff': 'hue-rotate(60deg)', // Blue
            '#ff8800': 'hue-rotate(210deg)', // Orange
            '#8800ff': 'hue-rotate(90deg)' // Purple
        };
        return colors[color] || '';
    }

    get speed() {
        return Math.hypot(this.vx, this.vy);
    }
}
