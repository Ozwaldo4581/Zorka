export const EXPERIMENTAL_WALL_COLLISION_THICKNESS = 32;
export const EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS = 4;
export const EXPERIMENTAL_WALL_SEPARATION_EPSILON = 0.5;
export const EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES = 4;

const SPAWN_INSET = 120;
const DOOR_WIDTH = 960;
const DOOR_TRANSITION_TOLERANCE = 16;

export const EXPERIMENTAL_COLLISION_CATEGORY = Object.freeze({
    HUMAN_PLAYER: 'human-player',
    NPC_SHIP: 'npc-ship',
    PROJECTILE: 'ordinary-projectile',
    MISSILE: 'missile',
    LASER: 'laser',
    TENTACLE: 'tentacle',
    ORBITAL: 'orbital',
    LARGE_ASTEROID: 'large-asteroid',
    MEDIUM_ASTEROID: 'medium-asteroid',
    SMALL_ASTEROID: 'small-asteroid',
    SATELLITE: 'satellite',
    SPACE_DEBRIS: 'space-debris'
});

export function createExperimentalRooms(worldWidth, worldHeight) {
    const sharedBoundaryY = worldHeight;
    const doorCenterX = worldWidth / 2;
    const doorMinX = doorCenterX - DOOR_WIDTH / 2;
    const doorMaxX = doorCenterX + DOOR_WIDTH / 2;
    const room1 = Object.freeze({
        id: 'experimental-room-1',
        origin: Object.freeze({ x: 0, y: 0 }),
        width: worldWidth,
        height: worldHeight,
        bounds: Object.freeze({ left: 0, top: 0, right: worldWidth, bottom: worldHeight }),
        walls: Object.freeze([
            Object.freeze({ id: 'room-1-wall-top', start: Object.freeze({ x: 0, y: 0 }), end: Object.freeze({ x: worldWidth, y: 0 }) }),
            Object.freeze({ id: 'room-1-wall-right', start: Object.freeze({ x: worldWidth, y: 0 }), end: Object.freeze({ x: worldWidth, y: worldHeight }) }),
            Object.freeze({ id: 'room-1-wall-bottom-right', start: Object.freeze({ x: worldWidth, y: worldHeight }), end: Object.freeze({ x: doorMaxX, y: worldHeight }) }),
            Object.freeze({ id: 'room-1-wall-bottom-left', start: Object.freeze({ x: doorMinX, y: worldHeight }), end: Object.freeze({ x: 0, y: worldHeight }) }),
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
        // Room 1 owns the two shared-boundary wall segments around the doorway;
        // Room 2 owns only its three exterior walls to avoid duplicate contacts.
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

export function createExperimentalDoors(rooms) {
    const room1 = rooms.find(room => room.id === 'experimental-room-1');
    const room2 = rooms.find(room => room.id === 'experimental-room-2');
    if (!room1 || !room2) return [];
    const sharedWalls = room1.walls.filter(wall =>
        wall.start.y === room1.bounds.bottom && wall.end.y === room1.bounds.bottom);
    const openingEdges = sharedWalls
        .flatMap(wall => [wall.start.x, wall.end.x])
        .filter(x => x !== room1.bounds.left && x !== room1.bounds.right)
        .sort((a, b) => a - b);
    const [openingMin, openingMax] = openingEdges;
    const openingCenter = (openingMin + openingMax) / 2;
    const blockedCategories = Object.values(EXPERIMENTAL_COLLISION_CATEGORY)
        .filter(category => category !== EXPERIMENTAL_COLLISION_CATEGORY.HUMAN_PLAYER);
    return [Object.freeze({
        id: 'experimental-door-1-2',
        roomIds: Object.freeze([room1.id, room2.id]),
        orientation: 'HORIZONTAL',
        boundaryCoordinate: room1.bounds.bottom,
        openingMin,
        openingMax,
        openingCenter,
        openingWidth: openingMax - openingMin,
        transitionTolerance: DOOR_TRANSITION_TOLERANCE,
        blocker: Object.freeze({
            id: 'experimental-door-1-2-blocker',
            isDoorBlocker: true,
            isTwoSided: true,
            start: Object.freeze({ x: openingMin, y: room1.bounds.bottom }),
            end: Object.freeze({ x: openingMax, y: room1.bounds.bottom })
        }),
        allowedCategories: Object.freeze([EXPERIMENTAL_COLLISION_CATEGORY.HUMAN_PLAYER]),
        blockedCategories: Object.freeze(blockedCategories)
    })];
}
