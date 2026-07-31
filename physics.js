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
export function updateNewtonian(entity, dt, thrustForce = { x: 0, y: 0 }, worldRules = null) {
    // a = F / m (m = 1 for simplicity)
    entity.vx += thrustForce.x * dt;
    entity.vy += thrustForce.y * dt;

    entity.x += entity.vx * dt;
    entity.y += entity.vy * dt;

    if (worldRules?.wrap !== false) wrap(entity);
}

export function closestPointOnSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= Number.EPSILON) return { x: start.x, y: start.y, t: 0 };
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    return { x: start.x + dx * t, y: start.y + dy * t, t };
}

export function circleThickSegmentContact(circle, wall, thickness = 0) {
    const closest = closestPointOnSegment(circle, wall.start, wall.end);
    const dx = circle.x - closest.x;
    const dy = circle.y - closest.y;
    const distance = Math.hypot(dx, dy);
    const combinedRadius = Math.max(0, circle.radius || 0) + Math.max(0, thickness) / 2;
    if (distance >= combinedRadius) return null;
    let normal;
    if (distance > Number.EPSILON) {
        normal = { x: dx / distance, y: dy / distance };
    } else {
        const wx = wall.end.x - wall.start.x;
        const wy = wall.end.y - wall.start.y;
        const wallLength = Math.hypot(wx, wy);
        normal = wallLength > Number.EPSILON ? { x: -wy / wallLength, y: wx / wallLength } : { x: 1, y: 0 };
    }
    return { point: closest, normal, penetration: combinedRadius - distance };
}

export function correctWallPenetration(entity, contact, epsilon = 0.5) {
    const distance = Math.max(0, contact.penetration) + Math.max(0, epsilon);
    entity.x += contact.normal.x * distance;
    entity.y += contact.normal.y * distance;
    return entity;
}

export function slideVelocity(entity, normal) {
    const inwardSpeed = entity.vx * normal.x + entity.vy * normal.y;
    if (inwardSpeed >= 0) return entity;
    entity.vx -= inwardSpeed * normal.x;
    entity.vy -= inwardSpeed * normal.y;
    return entity;
}

export function reflectVelocity(entity, normal) {
    const inwardSpeed = entity.vx * normal.x + entity.vy * normal.y;
    if (inwardSpeed >= 0) return entity;
    entity.vx -= 2 * inwardSpeed * normal.x;
    entity.vy -= 2 * inwardSpeed * normal.y;
    return entity;
}

export function sweptCircleSegmentIntersection(from, to, radius, wall, thickness = 0) {
    const combinedRadius = Math.max(0, radius) + Math.max(0, thickness) / 2;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, combinedRadius)));
    for (let index = 0; index <= steps; index++) {
        const t = index / steps;
        const circle = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, radius };
        const contact = circleThickSegmentContact(circle, wall, thickness);
        if (contact) return { ...contact, x: circle.x, y: circle.y, t };
    }
    return null;
}

export function isPointInRoom(point, bounds, margin = 0) {
    return point.x >= bounds.left + margin && point.x <= bounds.right - margin
        && point.y >= bounds.top + margin && point.y <= bounds.bottom - margin;
}

export function isLineBlockedByWalls(from, to, walls, thickness = 0) {
    return walls.some(wall => {
        if (wall.isTwoSided) return Boolean(sweptCircleSegmentIntersection(from, to, 0, wall, thickness));
        const wx = wall.end.x - wall.start.x;
        const wy = wall.end.y - wall.start.y;
        const length = Math.hypot(wx, wy);
        if (length <= Number.EPSILON) return Boolean(sweptCircleSegmentIntersection(from, to, 0, wall, thickness));
        const signedDistance = point => (wx * (point.y - wall.start.y) - wy * (point.x - wall.start.x)) / length;
        const fromSide = signedDistance(from);
        const toSide = signedDistance(to);
        const halfThickness = Math.max(0, thickness) / 2;
        // Experimental room walls are clockwise, so their solid exterior is the
        // negative side. A blast beginning at the wall may travel back inward.
        if (Math.abs(fromSide) <= halfThickness && toSide >= -halfThickness) return false;
        if (fromSide > halfThickness && toSide > halfThickness) return false;
        if (fromSide < -halfThickness && toSide < -halfThickness) return false;
        return Boolean(sweptCircleSegmentIntersection(from, to, 0, wall, thickness));
    });
}
