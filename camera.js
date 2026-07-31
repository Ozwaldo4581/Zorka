import { DESIGN_WIDTH, DESIGN_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT } from './game.js';
import { nearestWrappedDisplacement } from './physics.js';

export class Camera {
    constructor() {
        this.x = 0;
        this.y = 0;
        this.zoom = 0.6; // Zoomed out a bit
        this.shake = 0;
        this.boundaryMode = 'WRAP';
        this.roomBounds = null;
    }

    follow(target) {
        if (!target) return;
        
        // Target is the center of the camera
        this.x = target.x;
        this.y = target.y;
        if (this.boundaryMode === 'ROOM' && this.roomBounds) this.clampToRoom(this.roomBounds);
    }

    useWrappedWorld() {
        this.boundaryMode = 'WRAP';
        this.roomBounds = null;
    }

    useRoomBounds(bounds) {
        this.boundaryMode = 'ROOM';
        this.roomBounds = bounds;
        this.clampToRoom(bounds);
    }

    useDirectWorld() {
        this.boundaryMode = 'ROOM';
        this.roomBounds = null;
    }

    clampToRoom(bounds, viewport = { width: DESIGN_WIDTH, height: DESIGN_HEIGHT }) {
        const halfWidth = viewport.width / (2 * this.zoom);
        const halfHeight = viewport.height / (2 * this.zoom);
        const centerX = (bounds.left + bounds.right) / 2;
        const centerY = (bounds.top + bounds.bottom) / 2;
        this.x = bounds.right - bounds.left <= halfWidth * 2 ? centerX : Math.max(bounds.left + halfWidth, Math.min(bounds.right - halfWidth, this.x));
        this.y = bounds.bottom - bounds.top <= halfHeight * 2 ? centerY : Math.max(bounds.top + halfHeight, Math.min(bounds.bottom - halfHeight, this.y));
    }

    screenToWorld(screenX, screenY, viewport = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT }) {
        return {
            x: this.x + (screenX - (viewport.x + viewport.width / 2)) / this.zoom,
            y: this.y + (screenY - (viewport.y + viewport.height / 2)) / this.zoom
        };
    }

    worldToScreen(worldX, worldY, viewport = { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT }) {
        const delta = this.boundaryMode === 'ROOM'
            ? { x: worldX - this.x, y: worldY - this.y }
            : nearestWrappedDisplacement(this.x, this.y, worldX, worldY);
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
        if (this.boundaryMode === 'WRAP' && dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH;
        if (this.boundaryMode === 'WRAP' && dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH;
        if (this.boundaryMode === 'WRAP' && dy > WORLD_HEIGHT / 2) dy -= WORLD_HEIGHT;
        if (this.boundaryMode === 'WRAP' && dy < -WORLD_HEIGHT / 2) dy += WORLD_HEIGHT;

        ctx.translate(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
        ctx.scale(this.zoom, this.zoom);
        ctx.translate(dx, dy);
    }

    isPointOnScreen(worldX, worldY) {
        let dx = worldX - this.x;
        let dy = worldY - this.y;

        // Wrapping awareness
        if (this.boundaryMode === 'WRAP' && dx > WORLD_WIDTH / 2) dx -= WORLD_WIDTH;
        if (this.boundaryMode === 'WRAP' && dx < -WORLD_WIDTH / 2) dx += WORLD_WIDTH;
        if (this.boundaryMode === 'WRAP' && dy > WORLD_HEIGHT / 2) dy -= WORLD_HEIGHT;
        if (this.boundaryMode === 'WRAP' && dy < -WORLD_HEIGHT / 2) dy += WORLD_HEIGHT;

        // Apply zoom factor to screen dimensions for accurate bounds check
        const halfVisibleW = (DESIGN_WIDTH / 2) / this.zoom;
        const halfVisibleH = (DESIGN_HEIGHT / 2) / this.zoom;

        return Math.abs(dx) <= halfVisibleW && Math.abs(dy) <= halfVisibleH;
    }
}
