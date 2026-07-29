import { DESIGN_WIDTH, DESIGN_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT } from './game.js';
import { nearestWrappedDisplacement } from './physics.js';

export class Camera {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.zoom = 0.8; // Zoomed out a bit
        this.shake = 0;
    }

    follow(target) {
        if (!target) return;
        
        // Target is the center of the camera
        this.x = target.x;
        this.y = target.y;
    }

    screenToWorld(screenX, screenY, viewport = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT }) {
        return {
            x: this.x + (screenX - (viewport.x + viewport.width / 2)) / this.zoom,
            y: this.y + (screenY - (viewport.y + viewport.height / 2)) / this.zoom
        };
    }

    worldToScreen(worldX, worldY, viewport = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT }) {
        const delta = nearestWrappedDisplacement(this.x, this.y, worldX, worldY);
        return {
            x: viewport.x + viewport.width / 2 + delta.x * this.zoom,
            y: viewport.y + viewport.height / 2 + delta.y * this.zoom
        };
    }

    apply(ctx, worldX, worldY) {
        // Draw coordinate relative to camera center
        let dx = worldX - this.x;
        let dy = worldY - this.y;

        // Wrapping awareness for drawing
        if (dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH;
        if (dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH;
        if (dy > WORLD_HEIGHT / 2) dy -= WORLD_HEIGHT;
        if (dy < -WORLD_HEIGHT / 2) dy += WORLD_HEIGHT;

        ctx.translate(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
        ctx.scale(this.zoom, this.zoom);
        ctx.translate(dx, dy);
    }

    isPointOnScreen(worldX, worldY) {
        let dx = worldX - this.x;
        let dy = worldY - this.y;

        // Wrapping awareness
        if (dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH;
        if (dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH;
        if (dy > WORLD_HEIGHT / 2) dy -= WORLD_HEIGHT;
        if (dy < -WORLD_HEIGHT / 2) dy += WORLD_HEIGHT;

        // Apply zoom factor to screen dimensions for accurate bounds check
        const halfVisibleW = (DESIGN_WIDTH / 2) / this.zoom;
        const halfVisibleH = (DESIGN_HEIGHT / 2) / this.zoom;

        return Math.abs(dx) <= halfVisibleW && Math.abs(dy) <= halfVisibleH;
    }
}
