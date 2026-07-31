export const EXPERIMENTAL_WALL_COLLISION_THICKNESS = 32;
export const EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS = 4;
export const EXPERIMENTAL_WALL_SEPARATION_EPSILON = 0.5;
export const EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES = 4;

const SPAWN_INSET = 120;

export function createExperimentalRooms(worldWidth, worldHeight) {
    const sharedBoundaryY = worldHeight;
    const room1 = Object.freeze({
        id: 'experimental-room-1',
        origin: Object.freeze({ x: 0, y: 0 }),
        width: worldWidth,
        height: worldHeight,
        bounds: Object.freeze({ left: 0, top: 0, right: worldWidth, bottom: worldHeight }),
        walls: Object.freeze([
            Object.freeze({ id: 'room-1-wall-top', start: Object.freeze({ x: 0, y: 0 }), end: Object.freeze({ x: worldWidth, y: 0 }) }),
            Object.freeze({ id: 'room-1-wall-right', start: Object.freeze({ x: worldWidth, y: 0 }), end: Object.freeze({ x: worldWidth, y: worldHeight }) }),
            Object.freeze({ id: 'room-1-wall-bottom', start: Object.freeze({ x: worldWidth, y: worldHeight }), end: Object.freeze({ x: 0, y: worldHeight }) }),
            Object.freeze({ id: 'room-1-wall-left', start: Object.freeze({ x: 0, y: worldHeight }), end: Object.freeze({ x: 0, y: 0 }) })
        ]),
        wallCollisionThickness: EXPERIMENTAL_WALL_COLLISION_THICKNESS,
        wallVisualCoreThickness: EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS,
        collisionEpsilon: EXPERIMENTAL_WALL_SEPARATION_EPSILON,
        maxCorrectionPasses: EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES,
        spawnRegion: Object.freeze({
            left: SPAWN_INSET,
            top: SPAWN_INSET,
            right: worldWidth - SPAWN_INSET,
            bottom: worldHeight - SPAWN_INSET
        }),
        npcCount: 1
    });
    const room2 = Object.freeze({
        id: 'experimental-room-2',
        origin: Object.freeze({ x: 0, y: sharedBoundaryY }),
        width: room1.width,
        height: room1.height,
        bounds: Object.freeze({
            left: room1.bounds.left,
            top: sharedBoundaryY,
            right: room1.bounds.right,
            bottom: sharedBoundaryY + room1.height
        }),
        // Room 1's bottom wall is the single authoritative shared boundary.
        // Room 2 owns only its three exterior walls until the doorway slice.
        walls: Object.freeze([
            Object.freeze({ id: 'room-2-wall-right', start: Object.freeze({ x: worldWidth, y: sharedBoundaryY }), end: Object.freeze({ x: worldWidth, y: sharedBoundaryY + worldHeight }) }),
            Object.freeze({ id: 'room-2-wall-bottom', start: Object.freeze({ x: worldWidth, y: sharedBoundaryY + worldHeight }), end: Object.freeze({ x: 0, y: sharedBoundaryY + worldHeight }) }),
            Object.freeze({ id: 'room-2-wall-left', start: Object.freeze({ x: 0, y: sharedBoundaryY + worldHeight }), end: Object.freeze({ x: 0, y: sharedBoundaryY }) })
        ]),
        wallCollisionThickness: room1.wallCollisionThickness,
        wallVisualCoreThickness: room1.wallVisualCoreThickness,
        collisionEpsilon: room1.collisionEpsilon,
        maxCorrectionPasses: room1.maxCorrectionPasses,
        spawnRegion: Object.freeze({
            left: room1.spawnRegion.left,
            top: sharedBoundaryY + SPAWN_INSET,
            right: room1.spawnRegion.right,
            bottom: sharedBoundaryY + room1.height - SPAWN_INSET
        }),
        npcCount: 0
    });
    return [room1, room2];
}
