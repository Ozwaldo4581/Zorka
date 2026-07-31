export const EXPERIMENTAL_WALL_COLLISION_THICKNESS = 32;
export const EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS = 4;
export const EXPERIMENTAL_WALL_SEPARATION_EPSILON = 0.5;
export const EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES = 4;

const SPAWN_INSET = 120;

export function createExperimentalRooms(worldWidth, worldHeight) {
    const room = Object.freeze({
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
    return [room];
}
