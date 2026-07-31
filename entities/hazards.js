import { updateNewtonian } from '../physics.js';
import { Projectile } from './projectile.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../game.js';

export class SpaceDebris {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 45; // Medium asteroid size
        this.maxHits = 2;
        this.hits = 0;
        this.isDestroyed = false;
        this.isDebris = true; // For reward check

        const baseSpeed = 40 + Math.random() * 80;
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * baseSpeed;
        this.vy = Math.sin(angle) * baseSpeed;
        this.rotation = Math.random() * Math.PI * 2;
        this.rotSpeed = (Math.random() - 0.5) * 1.5;
    }

    update(dt, worldRules = null) {
        updateNewtonian(this, dt, undefined, worldRules);
        this.rotation += this.rotSpeed * dt;
    }

    draw(ctx, assets, camera) {
        ctx.save();
        camera.apply(ctx, this.x, this.y);
        ctx.rotate(this.rotation);
        const drawSize = this.radius * 2.2;
        ctx.drawImage(assets.spaceDebris, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        ctx.restore();
    }
}

export class Satellite {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 32; // Between small (20) and medium (45)
        this.maxHits = 1;
        this.hits = 0;
        this.isDestroyed = false;
        this.isSatellite = true; // For reward check

        const baseSpeed = 220 + Math.random() * 80;
        const angle = Math.random() * Math.PI * 2;
        this.vx = Math.cos(angle) * baseSpeed;
        this.vy = Math.sin(angle) * baseSpeed;
        this.rotation = Math.random() * Math.PI * 2;
        this.rotSpeed = (Math.random() - 0.5) * 0.5;

        this.fireCooldown = 0;
        // Faster fire rate: 0.8s to 1.0s
        this.fireRate = 0.8 + Math.random() * 0.2; 
    }

    update(dt, game, worldRules = null) {
        updateNewtonian(this, dt, undefined, worldRules);
        this.rotation += this.rotSpeed * dt;

        this.fireCooldown -= dt;
        if (this.fireCooldown <= 0) {
            this.fireCooldown = this.fireRate;
            this.shoot(game);
        }
    }

    shoot(game) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1200;
        const vx = Math.sin(angle) * speed;
        const vy = -Math.cos(angle) * speed;
        
        const sx = this.x + Math.sin(angle) * (this.radius + 10);
        const sy = this.y - Math.cos(angle) * (this.radius + 10);

        const p = new Projectile(sx, sy, vx, vy, '#ff0000'); // Red laser
        p.owner = this;
        p.isLaser = true;
        p.lifeSpan = 10;
        p.canWrap = false;
        game.projectiles.push(p);

        // Spatial audio (reuse laser sound)
        const cameras = game.getActiveCameras();
        game.audio.playSpatial('laser_fire', this.x, this.y, cameras, WORLD_WIDTH, WORLD_HEIGHT);
    }

    draw(ctx, assets, camera) {
        ctx.save();
        camera.apply(ctx, this.x, this.y);
        ctx.rotate(this.rotation);
        const drawSize = this.radius * 2.5;
        ctx.drawImage(assets.satellite, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        ctx.restore();
    }
}
