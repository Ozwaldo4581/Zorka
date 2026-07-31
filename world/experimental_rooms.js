export const EXPERIMENTAL_WALL_COLLISION_THICKNESS = 32;
export const EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS = 4;
export const EXPERIMENTAL_WALL_SEPARATION_EPSILON = 0.5;
export const EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES = 4;

const SPAWN_INSET = 120;
const DOOR_WIDTH = 960;
const DOOR_TRANSITION_TOLERANCE = 16;
const FULL_ARENA_POPULATION = Object.freeze({
    densitySource: 'ARENA_OPTIONS', scale: 'FULL_ARENA', independentlyResolved: true
});

export const EXPERIMENTAL_AREA_TYPE = Object.freeze({
    ROOM: 'ROOM',
    HALLWAY: 'HALLWAY'
});

const ROOM_LAYOUT = Object.freeze([
    [1, 0, 0], [2, 0, 1], [3, -1, 1], [4, -1, 0], [5, -1, -1],
    [6, 0, -1], [7, 1, -1], [8, 1, 0], [9, 1, 1]
]);

const DOOR_CONNECTIONS = Object.freeze([
    [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9]
]);

export function createExperimentalRoomProgression(roomNumber) {
    const normalizedRoomNumber = Math.max(1, Math.floor(Number(roomNumber) || 1));
    return Object.freeze({ roomNumber: normalizedRoomNumber, npcCount: normalizedRoomNumber, npcLevel: normalizedRoomNumber });
}

export function createExperimentalArea({
    id,
    areaType,
    roomNumber,
    bounds,
    walls = [],
    entrances = [],
    connectedAreaIds = [],
    population = null,
    ...properties
}) {
    if (!id || !bounds) throw new Error('Experimental areas require a unique ID and bounds.');
    if (!Object.values(EXPERIMENTAL_AREA_TYPE).includes(areaType)) {
        throw new Error(`Unsupported Experimental area type: ${areaType}`);
    }

    const normalizedRoomNumber = Math.floor(Number(roomNumber));
    if (areaType === EXPERIMENTAL_AREA_TYPE.HALLWAY && normalizedRoomNumber !== 0) {
        throw new Error('Experimental hallways must use room number 0.');
    }
    if (areaType === EXPERIMENTAL_AREA_TYPE.ROOM && normalizedRoomNumber <= 0) {
        throw new Error('Experimental combat rooms require a positive room number.');
    }

    return Object.freeze({
        ...properties,
        id,
        areaType,
        roomNumber: normalizedRoomNumber,
        isPopulationEligible: areaType === EXPERIMENTAL_AREA_TYPE.ROOM,
        bounds: Object.freeze({ ...bounds }),
        walls: Object.freeze([...walls]),
        entrances: Object.freeze([...entrances]),
        connectedAreaIds: Object.freeze([...connectedAreaIds]),
        population: areaType === EXPERIMENTAL_AREA_TYPE.ROOM ? population : null
    });
}

export const EXPERIMENTAL_COLLISION_CATEGORY = Object.freeze({
    HUMAN_PLAYER: 'human-player', NPC_SHIP: 'npc-ship', PROJECTILE: 'ordinary-projectile',
    MISSILE: 'missile', LASER: 'laser', TENTACLE: 'tentacle', ORBITAL: 'orbital',
    LARGE_ASTEROID: 'large-asteroid', MEDIUM_ASTEROID: 'medium-asteroid', SMALL_ASTEROID: 'small-asteroid',
    SATELLITE: 'satellite', SPACE_DEBRIS: 'space-debris'
});

const point = (x, y) => Object.freeze({ x, y });
const wall = (id, x1, y1, x2, y2) => Object.freeze({ id, start: point(x1, y1), end: point(x2, y2) });

function connectionGeometry(first, second) {
    if (first.bounds.bottom === second.bounds.top || second.bounds.bottom === first.bounds.top) {
        const boundary = first.bounds.bottom === second.bounds.top ? first.bounds.bottom : second.bounds.bottom;
        const overlapMin = Math.max(first.bounds.left, second.bounds.left);
        const overlapMax = Math.min(first.bounds.right, second.bounds.right);
        return { orientation: 'HORIZONTAL', boundaryCoordinate: boundary, openingCenter: (overlapMin + overlapMax) / 2 };
    }
    const boundary = first.bounds.right === second.bounds.left ? first.bounds.right : second.bounds.right;
    const overlapMin = Math.max(first.bounds.top, second.bounds.top);
    const overlapMax = Math.min(first.bounds.bottom, second.bounds.bottom);
    return { orientation: 'VERTICAL', boundaryCoordinate: boundary, openingCenter: (overlapMin + overlapMax) / 2 };
}

export function createExperimentalRooms(worldWidth, worldHeight) {
    const roomShells = ROOM_LAYOUT.map(([roomNumber, gridX, gridY]) => {
        const left = gridX * worldWidth;
        const top = gridY * worldHeight;
        return {
            ...createExperimentalRoomProgression(roomNumber), id: `experimental-room-${roomNumber}`,
            origin: point(left, top), width: worldWidth, height: worldHeight,
            bounds: Object.freeze({ left, top, right: left + worldWidth, bottom: top + worldHeight })
        };
    });
    const byNumber = new Map(roomShells.map(room => [room.roomNumber, room]));
    const connections = DOOR_CONNECTIONS.map(([a, b]) => ({ a, b, ...connectionGeometry(byNumber.get(a), byNumber.get(b)) }));

    return roomShells.map(room => {
        const b = room.bounds;
        const sides = [
            ['top', b.left, b.top, b.right, b.top, 'HORIZONTAL', b.top],
            ['right', b.right, b.top, b.right, b.bottom, 'VERTICAL', b.right],
            ['bottom', b.right, b.bottom, b.left, b.bottom, 'HORIZONTAL', b.bottom],
            ['left', b.left, b.bottom, b.left, b.top, 'VERTICAL', b.left]
        ];
        const walls = [];
        for (const [side, x1, y1, x2, y2, orientation, boundary] of sides) {
            const connection = connections.find(candidate => candidate.orientation === orientation
                && candidate.boundaryCoordinate === boundary && (candidate.a === room.roomNumber || candidate.b === room.roomNumber));
            if (!connection) {
                walls.push(wall(`room-${room.roomNumber}-wall-${side}`, x1, y1, x2, y2));
                continue;
            }
            // The first room in the path owns shared-wall geometry; both rooms query it through the door metadata.
            if (connection.a !== room.roomNumber) continue;
            const min = connection.openingCenter - DOOR_WIDTH / 2;
            const max = connection.openingCenter + DOOR_WIDTH / 2;
            if (orientation === 'HORIZONTAL') {
                walls.push(wall(`room-${room.roomNumber}-wall-${side}-right`, Math.max(x1, x2), boundary, max, boundary));
                walls.push(wall(`room-${room.roomNumber}-wall-${side}-left`, min, boundary, Math.min(x1, x2), boundary));
            } else {
                walls.push(wall(`room-${room.roomNumber}-wall-${side}-bottom`, boundary, Math.max(y1, y2), boundary, max));
                walls.push(wall(`room-${room.roomNumber}-wall-${side}-top`, boundary, min, boundary, Math.min(y1, y2)));
            }
        }
        return createExperimentalArea({
            ...room,
            areaType: EXPERIMENTAL_AREA_TYPE.ROOM,
            walls,
            wallCollisionThickness: EXPERIMENTAL_WALL_COLLISION_THICKNESS,
            wallVisualCoreThickness: EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS,
            collisionEpsilon: EXPERIMENTAL_WALL_SEPARATION_EPSILON,
            maxCorrectionPasses: EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES,
            spawnRegion: Object.freeze({ left: b.left + SPAWN_INSET, top: b.top + SPAWN_INSET, right: b.right - SPAWN_INSET, bottom: b.bottom - SPAWN_INSET }),
            population: FULL_ARENA_POPULATION, npcAggressionSource: 'ARENA_OPTIONS'
        });
    });
}

export function createExperimentalDoors(rooms) {
    const byNumber = new Map(rooms.map(room => [room.roomNumber, room]));
    const blockedCategories = Object.freeze(Object.values(EXPERIMENTAL_COLLISION_CATEGORY)
        .filter(category => category !== EXPERIMENTAL_COLLISION_CATEGORY.HUMAN_PLAYER));
    return DOOR_CONNECTIONS.flatMap(([a, b]) => {
        const first = byNumber.get(a);
        const second = byNumber.get(b);
        if (!first || !second) return [];
        const geometry = connectionGeometry(first, second);
        const openingMin = geometry.openingCenter - DOOR_WIDTH / 2;
        const openingMax = geometry.openingCenter + DOOR_WIDTH / 2;
        const horizontal = geometry.orientation === 'HORIZONTAL';
        const sharedWallIds = first.walls.filter(candidate => horizontal
            ? candidate.start.y === geometry.boundaryCoordinate && candidate.end.y === geometry.boundaryCoordinate
            : candidate.start.x === geometry.boundaryCoordinate && candidate.end.x === geometry.boundaryCoordinate).map(candidate => candidate.id);
        return [Object.freeze({
            id: `experimental-door-${a}-${b}`, roomIds: Object.freeze([first.id, second.id]),
            ...geometry, openingMin, openingMax, openingWidth: DOOR_WIDTH,
            transitionTolerance: DOOR_TRANSITION_TOLERANCE, sharedWallIds: Object.freeze(sharedWallIds),
            blocker: Object.freeze({
                id: `experimental-door-${a}-${b}-blocker`, isDoorBlocker: true, isTwoSided: true,
                start: horizontal ? point(openingMin, geometry.boundaryCoordinate) : point(geometry.boundaryCoordinate, openingMin),
                end: horizontal ? point(openingMax, geometry.boundaryCoordinate) : point(geometry.boundaryCoordinate, openingMax)
            }),
            allowedCategories: Object.freeze([EXPERIMENTAL_COLLISION_CATEGORY.HUMAN_PLAYER]), blockedCategories
        })];
    });
}
