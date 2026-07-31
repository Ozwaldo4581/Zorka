import { nearestWrappedDisplacement, updateNewtonian } from '../physics.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../game.js';

export class Projectile {
    constructor(x, y, vx, vy, color = '#00ffff') {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.radius = 8;
        this.lifeSpan = 1.0; 
        this.distanceTraveled = 0;
        this.maxTravelDistance = null;
        this.rotation = Math.atan2(vy, vx) + Math.PI / 2;
        this.canWrap = true;
        this.isLaser = false;
        this.isGhost = false;
        this.isMissile = false;
        this.isDecoy = false;
        this.isTentacle = false;
        this.isSkinnyMissile = false;
        this.isOrbital = false;
        this.orbitalAngle = 0;
        this.orbitalDistance = 150;
        this.tentacleLength = 0;
        this.maxTentacleLength = 550; // Decreased from 800
        this.tentaclePhase = 'OUT'; // OUT or IN
        this.missileTarget = null;
        this.aoeRadius = 0;
    }

    update(dt, asteroids = [], players = [], hazards = [], projectiles = [], worldRules = null) {
        this.previousX = this.x;
        this.previousY = this.y;
        if (this.isMissile) {
            this.updateMissile(dt, asteroids, players, hazards, projectiles, worldRules);
        } else if (this.isTentacle) {
            this.updateTentacle(dt);
        } else if (this.isOrbital) {
            this.updateOrbital(dt);
        } else {
            const dx = this.vx * dt;
            const dy = this.vy * dt;
            this.x += dx;
            this.y += dy;

            if (Number.isFinite(this.maxTravelDistance)) {
                this.distanceTraveled += Math.hypot(dx, dy);
                if (this.distanceTraveled >= this.maxTravelDistance) {
                    this.lifeSpan = 0;
                }
            }
        }

        if (worldRules?.wrap === false) {
            // Experimental wall coordination owns boundary outcomes.
        } else if (this.canWrap) {
            if (this.x < 0) this.x += WORLD_WIDTH;
            if (this.x > WORLD_WIDTH) this.x -= WORLD_WIDTH;
            if (this.y < 0) this.y += WORLD_HEIGHT;
            if (this.y > WORLD_HEIGHT) this.y -= WORLD_HEIGHT;
        } else {
            // Destroy non-wrapping projectiles when they leave the world bounds
            if (this.x < 0 || this.x > WORLD_WIDTH || this.y < 0 || this.y > WORLD_HEIGHT) {
                this.lifeSpan = 0;
            }
        }

        if (!this.isMissile && !this.isTentacle) {
            this.lifeSpan -= dt;
        }
    }

    updateOrbital(dt) {
        if (this.owner) {
            this.orbitalAngle += dt * 2; // Speed of orbit
            this.x = this.owner.x + Math.cos(this.orbitalAngle) * this.orbitalDistance;
            this.y = this.owner.y + Math.sin(this.orbitalAngle) * this.orbitalDistance;
        }
    }

    updateTentacle(dt) {
        const speed = 1200; // Tentacle speed matching Earthling projectile
        
        // Immediate cleanup if owner is no longer Dimension X
        if (!this.owner || !this.owner.isDimensionX || this.owner.isDead) {
            this.tentaclePhase = 'IN';
        }

        if (this.tentaclePhase === 'OUT') {
            this.tentacleLength += speed * dt;
            if (this.tentacleLength >= this.maxTentacleLength) {
                this.tentacleLength = this.maxTentacleLength;
                this.tentaclePhase = 'IN';
            }
        } else {
            this.tentacleLength -= speed * dt;
            if (this.tentacleLength <= 0) {
                this.tentacleLength = 0;
                this.lifeSpan = 0; // Destroy tentacle
            }
        }

        if (this.owner) {
            this.x = this.owner.x + Math.sin(this.rotation) * this.tentacleLength;
            this.y = this.owner.y - Math.cos(this.rotation) * this.tentacleLength;
        }
    }

    updateMissile(dt, asteroids, players, hazards, projectiles, worldRules = null) {
        const HOMING_RANGE = 1920;
        const isInProjectileRoom = target => !worldRules?.usesRooms || target.roomId === this.roomId;
        const getDistance = target => {
            const delta = worldRules?.wrap === false
                ? { x: target.x - this.x, y: target.y - this.y }
                : nearestWrappedDisplacement(this.x, this.y, target.x, target.y);
            return Math.hypot(delta.x, delta.y);
        };
        const isActiveTarget = target => {
            if (!target || target === this || target === this.owner) return false;
            if (!isInProjectileRoom(target)) return false;
            if (players.includes(target)) return !target.isDead && !target.isEliminated;
            if (asteroids.includes(target)) return !target.isDestroyed;
            if (hazards.includes(target)) return !target.isDestroyed;
            if (projectiles.includes(target)) {
                return (target.isMissile || target.isSkinnyMissile)
                    && !target.hasDetonated
                    && !target.isRemoved
                    && target.lifeSpan > 0;
            }
            return false;
        };

        const lockedTarget = this.owner?.lockedAimTarget;
        let target = isActiveTarget(lockedTarget) ? lockedTarget : null;

        // missileTarget remains the missile-owned automatic fallback; the owner's
        // explicit lock overrides it only for the current update.
        if (!target) {
            if (!isActiveTarget(this.missileTarget)) {
                let minDist = Infinity;
                this.missileTarget = null;

                players.forEach(player => {
                    if (player === this.owner || player.isDead || player.isEliminated || !isInProjectileRoom(player)) return;
                    const distance = getDistance(player);
                    if (distance < minDist && distance < HOMING_RANGE) {
                        minDist = distance;
                        this.missileTarget = player;
                    }
                });

                hazards.forEach(hazard => {
                    if (!hazard.isSatellite || hazard.isDestroyed || !isInProjectileRoom(hazard)) return;
                    const distance = getDistance(hazard);
                    if (distance < minDist && distance < HOMING_RANGE) {
                        minDist = distance;
                        this.missileTarget = hazard;
                    }
                });
            }

            if (this.missileTarget && getDistance(this.missileTarget) < HOMING_RANGE) {
                target = this.missileTarget;
            } else {
                this.missileTarget = null;
            }
        }

        if (target) {
            const delta = worldRules?.wrap === false
                ? { x: target.x - this.x, y: target.y - this.y }
                : nearestWrappedDisplacement(this.x, this.y, target.x, target.y);
            const targetRot = Math.atan2(delta.y, delta.x) + Math.PI / 2;
            const currentRot = Math.atan2(this.vy, this.vx) + Math.PI / 2;
            let diff = targetRot - currentRot;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;

            const maxTurn = 2.7 * dt;
            const newRot = currentRot + Math.max(-maxTurn, Math.min(maxTurn, diff));
            const speed = Math.hypot(this.vx, this.vy);
            this.vx = Math.sin(newRot) * speed;
            this.vy = -Math.cos(newRot) * speed;
            this.rotation = Math.atan2(this.vy, this.vx) + Math.PI / 2;
        }

        this.x += this.vx * dt;
        this.y += this.vy * dt;
    }

    draw(ctx, assets, camera) {
        ctx.save();
        camera.apply(ctx, this.x, this.y);
        
        if (this.isTentacle && this.owner) {
            // Do not draw tentacle if owner is no longer Dimension X
            if (!this.owner.isDimensionX || this.owner.isDead) {
                ctx.restore();
                return;
            }
            ctx.restore();
            ctx.save();
            // Draw stretchy tentacle arm
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 24; // Doubled from 12
            ctx.lineCap = 'round';
            ctx.shadowBlur = 10;
            ctx.shadowColor = this.color;

            // Apply camera relative to owner
            camera.apply(ctx, this.owner.x, this.owner.y);
            
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(Math.sin(this.rotation) * this.tentacleLength, -Math.cos(this.rotation) * this.tentacleLength);
            ctx.stroke();

            // Tip of tentacle (claw/sucker)
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(Math.sin(this.rotation) * this.tentacleLength, -Math.cos(this.rotation) * this.tentacleLength, 30, 0, Math.PI * 2); // Doubled from 15
            ctx.fill();
        } else if (this.isOrbital) {
            // Draw satellite
            const size = this.radius * 3;
            ctx.rotate(this.orbitalAngle + Math.PI / 2);
            ctx.drawImage(assets.satellite, -size / 2, -size / 2, size, size);
        } else if (this.isSkinnyMissile) {
            ctx.rotate(this.rotation);
            ctx.shadowBlur = 12;
            ctx.shadowColor = this.color;
            ctx.fillStyle = this.color;
            ctx.fillRect(-3, -22, 6, 44); // Skinny version
            ctx.fillStyle = '#ffffff'; 
            ctx.fillRect(-3, -22, 6, 10); 
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ffaa00'; 
            ctx.fillRect(-2, 22, 4, 15); 
        } else if (this.isDecoy) {
            // Draw as a larger, slightly glitchy asteroid
            ctx.globalAlpha = 0.8;
            const size = 120;
            ctx.shadowBlur = 10;
            ctx.shadowColor = this.color;
            ctx.drawImage(assets.asteroid, -size / 2, -size / 2, size, size);
            
            // Subtle digital glitch overlay
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 2;
            ctx.strokeRect(-size / 2 - 2, -size / 2 - 2, size + 4, size + 4);
        } else if (this.isLaser) {
            ctx.fillStyle = this.color;
            ctx.shadowBlur = 15;
            ctx.shadowColor = this.color;
            ctx.rotate(this.rotation);
            ctx.fillRect(-3, -40, 6, 80);
        } else if (this.isMissile) {
            ctx.rotate(this.rotation);
            ctx.shadowBlur = 12;
            ctx.shadowColor = this.color;
            ctx.fillStyle = this.color;
            ctx.fillRect(-9, -22, 18, 44);
            ctx.fillStyle = '#ffffff'; // White nose for contrast
            ctx.fillRect(-9, -22, 18, 10); // Nose highlight
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#ff2200'; // Engine fire remains red-orange
            ctx.fillRect(-5, 22, 10, 22); // Engine fire
        } else {
            if (this.isGhost) ctx.globalAlpha = 0.6;
            // Draw as a glowing sphere
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.radius);
            gradient.addColorStop(0, '#fff');
            gradient.addColorStop(0.4, this.color);
            gradient.addColorStop(1, 'transparent');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(0, 0, this.radius * 2, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.restore();
    }
}
