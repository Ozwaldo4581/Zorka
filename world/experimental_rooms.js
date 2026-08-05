export const EXPERIMENTAL_WALL_COLLISION_THICKNESS = 32;
export const EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS = 4;
export const EXPERIMENTAL_WALL_SEPARATION_EPSILON = 0.5;
export const EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES = 4;

const SPAWN_INSET = 120;
export const EXPERIMENTAL_ENTRANCE_WIDTH = 960;
// At zoom 0.6 the 1920-wide viewport spans 3200 world units. The extra 800
// units ensure that rooms separated along either axis cannot share a viewport.
export const EXPERIMENTAL_HALLWAY_LENGTH = 4000;
// A 960-unit entrance plus 240 units of wall shoulder on either side gives
// transformed human ships ample room to turn and slide without widening doors.
export const EXPERIMENTAL_HALLWAY_WIDTH = 1440;
const DOOR_TRANSITION_TOLERANCE = 16;
const FULL_ARENA_POPULATION = Object.freeze({
    densitySource: 'ARENA_OPTIONS', scale: 'FULL_ARENA', independentlyResolved: true
});
const BBG_ONLY_POPULATION = Object.freeze({
    ...FULL_ARENA_POPULATION, ordinaryNPCsAllowed: false, specialEncounterNPCsAllowed: true
});


export const SECTOR_9_BBG_ENCOUNTER = Object.freeze({
    id: 'sector-9-bbg',
    roomNumber: 9,
    imageAssetKey: 'bbgScenery',
    imagePath: 'assets/BSG5.png',
    nativeWidth: 1024,
    nativeHeight: 1536,
    scale: 2,
    baseNpcLevel: 20,
    npcAggressionLevel: 2,
    anchors: Object.freeze([
        Object.freeze({ id: 'bbg-node-top', sourceX: 514, sourceY: 193, label: 'Top' }),
        Object.freeze({ id: 'bbg-node-left-upper', sourceX: 210, sourceY: 622, label: 'Left Upper' }),
        Object.freeze({ id: 'bbg-node-right-upper', sourceX: 818, sourceY: 623, label: 'Right Upper' }),
        Object.freeze({ id: 'bbg-node-center', sourceX: 515, sourceY: 800, label: 'Center' }),
        Object.freeze({ id: 'bbg-node-left-lower', sourceX: 202, sourceY: 984, label: 'Left Lower' }),
        Object.freeze({ id: 'bbg-node-right-lower', sourceX: 825, sourceY: 984, label: 'Right Lower' }),
        Object.freeze({ id: 'bbg-node-bottom', sourceX: 513, sourceY: 1212, label: 'Bottom' })
    ])
});

export function getSector9BBGImageRect(room) {
    if (!room?.bounds) return null;
    const width = SECTOR_9_BBG_ENCOUNTER.nativeWidth * SECTOR_9_BBG_ENCOUNTER.scale;
    const height = SECTOR_9_BBG_ENCOUNTER.nativeHeight * SECTOR_9_BBG_ENCOUNTER.scale;
    const centerX = (room.bounds.left + room.bounds.right) / 2;
    const centerY = (room.bounds.top + room.bounds.bottom) / 2;
    return Object.freeze({
        left: centerX - width / 2,
        top: centerY - height / 2,
        width,
        height,
        right: centerX + width / 2,
        bottom: centerY + height / 2,
        centerX,
        centerY,
        scale: SECTOR_9_BBG_ENCOUNTER.scale
    });
}

export function getSector9BBGAnchorWorldPosition(room, anchor) {
    const rect = getSector9BBGImageRect(room);
    if (!rect || !anchor) return null;
    return Object.freeze({
        x: rect.left + anchor.sourceX * rect.scale,
        y: rect.top + anchor.sourceY * rect.scale
    });
}

export const EXPERIMENTAL_AREA_TYPE = Object.freeze({ ROOM: 'ROOM', HALLWAY: 'HALLWAY' });

const ROUTE = Object.freeze([
    [1, 2, 'DOWN'], [2, 3, 'LEFT'], [3, 4, 'UP'], [4, 5, 'UP'],
    [5, 6, 'RIGHT'], [6, 7, 'RIGHT'], [7, 8, 'DOWN'], [8, 9, 'DOWN']
]);

export function createExperimentalRoomProgression(roomNumber) {
    const normalizedRoomNumber = Math.max(1, Math.floor(Number(roomNumber) || 1));
    return Object.freeze({
        roomNumber: normalizedRoomNumber,
        npcCount: 1 + 2 * (normalizedRoomNumber - 1),
        npcLevel: normalizedRoomNumber
    });
}

export function createExperimentalArea({
    id, areaType, roomNumber, bounds, walls = [], entrances = [], connectedAreaIds = [], population = null, ...properties
}) {
    if (!id || !bounds) throw new Error('Experimental areas require a unique ID and bounds.');
    if (!Object.values(EXPERIMENTAL_AREA_TYPE).includes(areaType)) throw new Error(`Unsupported Experimental area type: ${areaType}`);
    const normalizedRoomNumber = Math.floor(Number(roomNumber));
    if (areaType === EXPERIMENTAL_AREA_TYPE.HALLWAY && normalizedRoomNumber !== 0) throw new Error('Experimental hallways must use room number 0.');
    if (areaType === EXPERIMENTAL_AREA_TYPE.ROOM && normalizedRoomNumber <= 0) throw new Error('Experimental combat rooms require a positive room number.');
    return Object.freeze({
        ...properties, id, areaType, roomNumber: normalizedRoomNumber,
        isPopulationEligible: areaType === EXPERIMENTAL_AREA_TYPE.ROOM,
        ordinaryNPCsAllowed: areaType === EXPERIMENTAL_AREA_TYPE.ROOM && population?.ordinaryNPCsAllowed !== false,
        specialEncounterNPCsAllowed: areaType === EXPERIMENTAL_AREA_TYPE.ROOM && population?.specialEncounterNPCsAllowed === true,
        bounds: Object.freeze({ ...bounds }), walls: Object.freeze([...walls]),
        entrances: Object.freeze([...entrances]), connectedAreaIds: Object.freeze([...connectedAreaIds]),
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
const boundsAt = (left, top, width, height) => Object.freeze({ left, top, right: left + width, bottom: top + height });
const wall = (id, x1, y1, x2, y2) => Object.freeze({ id, start: point(x1, y1), end: point(x2, y2) });

function nextRoomOrigin(source, direction, worldWidth, worldHeight) {
    if (direction === 'DOWN') return { left: source.left, top: source.top + worldHeight + EXPERIMENTAL_HALLWAY_LENGTH };
    if (direction === 'UP') return { left: source.left, top: source.top - worldHeight - EXPERIMENTAL_HALLWAY_LENGTH };
    if (direction === 'LEFT') return { left: source.left - worldWidth - EXPERIMENTAL_HALLWAY_LENGTH, top: source.top };
    return { left: source.left + worldWidth + EXPERIMENTAL_HALLWAY_LENGTH, top: source.top };
}

function hallwayBounds(source, direction) {
    const centerX = (source.left + source.right) / 2;
    const centerY = (source.top + source.bottom) / 2;
    if (direction === 'DOWN') return boundsAt(centerX - EXPERIMENTAL_HALLWAY_WIDTH / 2, source.bottom, EXPERIMENTAL_HALLWAY_WIDTH, EXPERIMENTAL_HALLWAY_LENGTH);
    if (direction === 'UP') return boundsAt(centerX - EXPERIMENTAL_HALLWAY_WIDTH / 2, source.top - EXPERIMENTAL_HALLWAY_LENGTH, EXPERIMENTAL_HALLWAY_WIDTH, EXPERIMENTAL_HALLWAY_LENGTH);
    if (direction === 'LEFT') return boundsAt(source.left - EXPERIMENTAL_HALLWAY_LENGTH, centerY - EXPERIMENTAL_HALLWAY_WIDTH / 2, EXPERIMENTAL_HALLWAY_LENGTH, EXPERIMENTAL_HALLWAY_WIDTH);
    return boundsAt(source.right, centerY - EXPERIMENTAL_HALLWAY_WIDTH / 2, EXPERIMENTAL_HALLWAY_LENGTH, EXPERIMENTAL_HALLWAY_WIDTH);
}

function connectionGeometry(first, second) {
    if (first.bounds.bottom === second.bounds.top || second.bounds.bottom === first.bounds.top) {
        const boundaryCoordinate = first.bounds.bottom === second.bounds.top ? first.bounds.bottom : second.bounds.bottom;
        return { orientation: 'HORIZONTAL', boundaryCoordinate, openingCenter: (Math.max(first.bounds.left, second.bounds.left) + Math.min(first.bounds.right, second.bounds.right)) / 2 };
    }
    if (first.bounds.right === second.bounds.left || second.bounds.right === first.bounds.left) {
        const boundaryCoordinate = first.bounds.right === second.bounds.left ? first.bounds.right : second.bounds.right;
        return { orientation: 'VERTICAL', boundaryCoordinate, openingCenter: (Math.max(first.bounds.top, second.bounds.top) + Math.min(first.bounds.bottom, second.bounds.bottom)) / 2 };
    }
    throw new Error(`Experimental areas ${first.id} and ${second.id} are not physically adjacent.`);
}

function buildWalls(shell, entranceShells) {
    const b = shell.bounds;
    const sides = [
        ['top', b.left, b.top, b.right, b.top, 'HORIZONTAL', b.top],
        ['right', b.right, b.top, b.right, b.bottom, 'VERTICAL', b.right],
        ['bottom', b.right, b.bottom, b.left, b.bottom, 'HORIZONTAL', b.bottom],
        ['left', b.left, b.bottom, b.left, b.top, 'VERTICAL', b.left]
    ];
    const walls = [];
    for (const [side, x1, y1, x2, y2, orientation, boundary] of sides) {
        const entrance = entranceShells.find(candidate => candidate.orientation === orientation && candidate.boundaryCoordinate === boundary);
        if (!entrance) {
            walls.push(wall(`${shell.id}-wall-${side}`, x1, y1, x2, y2));
            continue;
        }
        const min = entrance.openingCenter - EXPERIMENTAL_ENTRANCE_WIDTH / 2;
        const max = entrance.openingCenter + EXPERIMENTAL_ENTRANCE_WIDTH / 2;
        if (orientation === 'HORIZONTAL') {
            walls.push(wall(`${shell.id}-wall-${side}-right`, Math.max(x1, x2), boundary, max, boundary));
            walls.push(wall(`${shell.id}-wall-${side}-left`, min, boundary, Math.min(x1, x2), boundary));
        } else {
            walls.push(wall(`${shell.id}-wall-${side}-bottom`, boundary, Math.max(y1, y2), boundary, max));
            walls.push(wall(`${shell.id}-wall-${side}-top`, boundary, min, boundary, Math.min(y1, y2)));
        }
    }
    return walls;
}

export function createExperimentalAreas(worldWidth, worldHeight) {
    const roomOrigins = new Map([[1, { left: 0, top: 0 }]]);
    for (const [from, to, direction] of ROUTE) {
        const source = roomOrigins.get(from);
        roomOrigins.set(to, nextRoomOrigin(source, direction, worldWidth, worldHeight));
    }
    const shells = [];
    for (let roomNumber = 1; roomNumber <= 9; roomNumber++) {
        const origin = roomOrigins.get(roomNumber);
        shells.push({
            ...createExperimentalRoomProgression(roomNumber), id: `experimental-room-${roomNumber}`,
            areaType: EXPERIMENTAL_AREA_TYPE.ROOM, origin: point(origin.left, origin.top),
            width: worldWidth, height: worldHeight, bounds: boundsAt(origin.left, origin.top, worldWidth, worldHeight),
            population: roomNumber === SECTOR_9_BBG_ENCOUNTER.roomNumber ? BBG_ONLY_POPULATION : FULL_ARENA_POPULATION,
            npcAggressionSource: 'ARENA_OPTIONS'
        });
    }
    const byId = new Map(shells.map(area => [area.id, area]));
    for (const [from, to, direction] of ROUTE) {
        const id = `experimental-hallway-${from}-${to}`;
        shells.push({
            id, areaType: EXPERIMENTAL_AREA_TYPE.HALLWAY, roomNumber: 0,
            width: ['LEFT', 'RIGHT'].includes(direction) ? EXPERIMENTAL_HALLWAY_LENGTH : EXPERIMENTAL_HALLWAY_WIDTH,
            height: ['UP', 'DOWN'].includes(direction) ? EXPERIMENTAL_HALLWAY_LENGTH : EXPERIMENTAL_HALLWAY_WIDTH,
            bounds: hallwayBounds(byId.get(`experimental-room-${from}`).bounds, direction),
            connectedAreaIds: [`experimental-room-${from}`, `experimental-room-${to}`]
        });
        byId.set(id, shells.at(-1));
    }
    const connections = ROUTE.flatMap(([from, to]) => {
        const hallway = byId.get(`experimental-hallway-${from}-${to}`);
        return [[byId.get(`experimental-room-${from}`), hallway], [hallway, byId.get(`experimental-room-${to}`)]];
    }).map(([first, second]) => ({ first, second, ...connectionGeometry(first, second) }));

    return shells.map(shell => {
        const areaConnections = connections.filter(connection => connection.first.id === shell.id || connection.second.id === shell.id);
        const connectedAreaIds = areaConnections.map(connection => connection.first.id === shell.id ? connection.second.id : connection.first.id);
        const walls = buildWalls(shell, areaConnections);
        const b = shell.bounds;
        return createExperimentalArea({
            ...shell, walls, connectedAreaIds,
            entrances: areaConnections.map(connection => `experimental-entrance-${connection.first.id}-${connection.second.id}`),
            wallCollisionThickness: EXPERIMENTAL_WALL_COLLISION_THICKNESS,
            wallVisualCoreThickness: EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS,
            collisionEpsilon: EXPERIMENTAL_WALL_SEPARATION_EPSILON,
            maxCorrectionPasses: EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES,
            spawnRegion: shell.areaType === EXPERIMENTAL_AREA_TYPE.ROOM
                ? Object.freeze({ left: b.left + SPAWN_INSET, top: b.top + SPAWN_INSET, right: b.right - SPAWN_INSET, bottom: b.bottom - SPAWN_INSET }) : null
        });
    });
}

export function createExperimentalRooms(worldWidth, worldHeight) {
    return createExperimentalAreas(worldWidth, worldHeight).filter(area => area.areaType === EXPERIMENTAL_AREA_TYPE.ROOM);
}

export function createExperimentalHallways(worldWidth, worldHeight) {
    return createExperimentalAreas(worldWidth, worldHeight).filter(area => area.areaType === EXPERIMENTAL_AREA_TYPE.HALLWAY);
}

export function createExperimentalDoors(areas) {
    const byId = new Map(areas.map(area => [area.id, area]));
    const blockedCategories = Object.freeze(Object.values(EXPERIMENTAL_COLLISION_CATEGORY).filter(category => category !== EXPERIMENTAL_COLLISION_CATEGORY.HUMAN_PLAYER));
    const seen = new Set();
    const doors = [];
    for (const area of areas) for (const connectedId of area.connectedAreaIds || []) {
        const pairKey = [area.id, connectedId].sort().join('|');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        const connected = byId.get(connectedId);
        if (!connected) continue;
        const geometry = connectionGeometry(area, connected);
        const openingMin = geometry.openingCenter - EXPERIMENTAL_ENTRANCE_WIDTH / 2;
        const openingMax = geometry.openingCenter + EXPERIMENTAL_ENTRANCE_WIDTH / 2;
        const horizontal = geometry.orientation === 'HORIZONTAL';
        const id = `experimental-entrance-${area.id}-${connected.id}`;
        doors.push(Object.freeze({
            id, roomIds: Object.freeze([area.id, connected.id]), ...geometry,
            openingMin, openingMax, openingWidth: EXPERIMENTAL_ENTRANCE_WIDTH,
            transitionTolerance: DOOR_TRANSITION_TOLERANCE, sharedWallIds: Object.freeze([]),
            blocker: Object.freeze({
                id: `${id}-blocker`, isDoorBlocker: true, isTwoSided: true,
                start: horizontal ? point(openingMin, geometry.boundaryCoordinate) : point(geometry.boundaryCoordinate, openingMin),
                end: horizontal ? point(openingMax, geometry.boundaryCoordinate) : point(geometry.boundaryCoordinate, openingMax)
            }),
            allowedCategories: Object.freeze([EXPERIMENTAL_COLLISION_CATEGORY.HUMAN_PLAYER]), blockedCategories
        }));
    }
    return doors;
}
