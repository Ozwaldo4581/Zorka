import { WORLD_WIDTH, WORLD_HEIGHT } from './game.js';

export function wrap(entity) {
    // Standard Newtonian wrapping: teleport to opposite side
    if (entity.x < 0) entity.x = WORLD_WIDTH + (entity.x % WORLD_WIDTH);
    if (entity.x >= WORLD_WIDTH) entity.x = entity.x % WORLD_WIDTH;
    if (entity.y < 0) entity.y = WORLD_HEIGHT + (entity.y % WORLD_HEIGHT);
    if (entity.y >= WORLD_HEIGHT) entity.y = entity.y % WORLD_HEIGHT;
}

export function wrapCoordinate(value, size) {
    return ((value % size) + size) % size;
}

export function shortestWrappedDelta(from, to, size) {
    let delta = to - from;
    if (delta > size / 2) delta -= size;
    if (delta < -size / 2) delta += size;
    return delta;
}

export function nearestWrappedDisplacement(fromX, fromY, toX, toY) {
    return {
        x: shortestWrappedDelta(fromX, toX, WORLD_WIDTH),
        y: shortestWrappedDelta(fromY, toY, WORLD_HEIGHT)
    };
}

export function checkCollision(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < (a.radius + b.radius);
}

// Newtonian update with no friction
export function updateNewtonian(entity, dt, thrustForce = { x: 0, y: 0 }) {
    // a = F / m (m = 1 for simplicity)
    entity.vx += thrustForce.x * dt;
    entity.vy += thrustForce.y * dt;

    entity.x += entity.vx * dt;
    entity.y += entity.vy * dt;

    wrap(entity);
}
