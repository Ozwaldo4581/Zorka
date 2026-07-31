export const EXPERIMENTAL_WALL_COLLISION_THICKNESS = 32;
export const EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS = 4;
export const EXPERIMENTAL_WALL_SEPARATION_EPSILON = 0.5;
export const EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES = 4;

const ROOM_WIDTH = 1920;
const ROOM_HEIGHT = 1080;

const ROOM_ONE = Object.freeze({
    id: 'experimental-room-1',
    origin: Object.freeze({ x: 0, y: 0 }),
    width: ROOM_WIDTH,
    height: ROOM_HEIGHT,
    bounds: Object.freeze({ left: 0, top: 0, right: ROOM_WIDTH, bottom: ROOM_HEIGHT }),
    walls: Object.freeze([
        Object.freeze({ id: 'room-1-wall-top', start: Object.freeze({ x: 0, y: 0 }), end: Object.freeze({ x: ROOM_WIDTH, y: 0 }) }),
        Object.freeze({ id: 'room-1-wall-right', start: Object.freeze({ x: ROOM_WIDTH, y: 0 }), end: Object.freeze({ x: ROOM_WIDTH, y: ROOM_HEIGHT }) }),
        Object.freeze({ id: 'room-1-wall-bottom', start: Object.freeze({ x: ROOM_WIDTH, y: ROOM_HEIGHT }), end: Object.freeze({ x: 0, y: ROOM_HEIGHT }) }),
        Object.freeze({ id: 'room-1-wall-left', start: Object.freeze({ x: 0, y: ROOM_HEIGHT }), end: Object.freeze({ x: 0, y: 0 }) })
    ]),
    wallCollisionThickness: EXPERIMENTAL_WALL_COLLISION_THICKNESS,
    wallVisualCoreThickness: EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS,
    collisionEpsilon: EXPERIMENTAL_WALL_SEPARATION_EPSILON,
    maxCorrectionPasses: EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES,
    spawnRegion: Object.freeze({ left: 120, top: 120, right: ROOM_WIDTH - 120, bottom: ROOM_HEIGHT - 120 }),
    populationMappings: Object.freeze({
        asteroids: Object.freeze([0, 1, 2, 3, 4, 5]),
        debris: Object.freeze([0, 1, 1, 2, 3, 4]),
        satellites: Object.freeze([0, 1, 1, 2, 2, 3])
    }),
    npcCount: 1
});

export function createExperimentalRooms() {
    // Room data is immutable, so a new collection is enough to isolate each match.
    return [ROOM_ONE];
}
