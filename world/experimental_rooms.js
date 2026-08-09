export const EXPERIMENTAL_WALL_COLLISION_THICKNESS = 32;
export const EXPERIMENTAL_WALL_VISUAL_CORE_THICKNESS = 4;
export const EXPERIMENTAL_WALL_SEPARATION_EPSILON = 0.5;
export const EXPERIMENTAL_WALL_MAX_CORRECTION_PASSES = 4;

const SPAWN_INSET = 120;
// A normal ship renders at 3.5 times its 25-unit collision radius. Sector 9's
// cover clearance is five of those normal physical footprints.
export const EXPERIMENTAL_NORMAL_SHIP_LENGTH = 25 * 3.5;
export const EXPERIMENTAL_SECTOR_9_NOOK_DEPTH = EXPERIMENTAL_NORMAL_SHIP_LENGTH * 5;
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
    npcAggressionLevel: 1,
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

export const EXPERIMENTAL_SHORTCUT_ID = Object.freeze({
    SECTOR_1_TO_4: 'sector-1-to-4',
    SECTOR_1_TO_6: 'sector-1-to-6',
    SECTOR_1_TO_8: 'sector-1-to-8'
});

const SHORTCUT_ROUTE = Object.freeze([
    Object.freeze({ id: EXPERIMENTAL_SHORTCUT_ID.SECTOR_1_TO_4, destinationRoomNumber: 4, direction: 'LEFT', sourceWall: 'left', destinationWall: 'right', color: '#248cff', colorName: 'blue' }),
    Object.freeze({ id: EXPERIMENTAL_SHORTCUT_ID.SECTOR_1_TO_6, destinationRoomNumber: 6, direction: 'UP', sourceWall: 'top', destinationWall: 'bottom', color: '#25d366', colorName: 'green' }),
    Object.freeze({ id: EXPERIMENTAL_SHORTCUT_ID.SECTOR_1_TO_8, destinationRoomNumber: 8, direction: 'RIGHT', sourceWall: 'right', destinationWall: 'left', color: '#ff2bd6', colorName: 'magenta' })
]);

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
    id, areaType, roomNumber, bounds, walls = [], spawnExclusionRegions = [], entrances = [], connectedAreaIds = [], population = null, ...properties
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
        spawnExclusionRegions: Object.freeze(spawnExclusionRegions.map(region => Object.freeze({ ...region }))),
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
const wall = (id, x1, y1, x2, y2, isTwoSided = false) => Object.freeze({
    id, start: point(x1, y1), end: point(x2, y2), ...(isTwoSided ? { isTwoSided: true } : {})
});

const interiorWall = (id, x1, y1, x2, y2) => wall(id, x1, y1, x2, y2, true);

function centeredWall(id, centerX, centerY, angle, length) {
    const halfX = Math.cos(angle) * length / 2;
    const halfY = Math.sin(angle) * length / 2;
    return interiorWall(id, centerX - halfX, centerY - halfY, centerX + halfX, centerY + halfY);
}

function squareGeometry(id, centerX, centerY, sideLength) {
    const half = sideLength / 2;
    return Object.freeze({
        walls: Object.freeze([
            interiorWall(`${id}-top`, centerX - half, centerY - half, centerX + half, centerY - half),
            interiorWall(`${id}-right`, centerX + half, centerY - half, centerX + half, centerY + half),
            interiorWall(`${id}-bottom`, centerX + half, centerY + half, centerX - half, centerY + half),
            interiorWall(`${id}-left`, centerX - half, centerY + half, centerX - half, centerY - half)
        ]),
        enclosedRegion: Object.freeze({ id, left: centerX - half, top: centerY - half, right: centerX + half, bottom: centerY + half })
    });
}

function inwardCornerWalls(id, cornerX, cornerY, horizontalDirection, verticalDirection, length) {
    return [
        interiorWall(`${id}-horizontal`, cornerX, cornerY, cornerX + horizontalDirection * length, cornerY),
        interiorWall(`${id}-vertical`, cornerX, cornerY, cornerX, cornerY + verticalDirection * length)
    ];
}

function buildInteriorLayout(shell) {
    const emptyLayout = () => ({ walls: [], spawnExclusionRegions: [] });
    if (shell.areaType !== EXPERIMENTAL_AREA_TYPE.ROOM || shell.roomNumber <= 1) return emptyLayout();
    const { left, right, top, bottom } = shell.bounds;
    const width = right - left;
    const height = bottom - top;
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const prefix = `${shell.id}-interior`;
    const cardinal = (id, x, y, angle, length) => centeredWall(`${prefix}-${id}`, x, y, angle, length);
    const diagonalDown = Math.PI / 4;
    const diagonalUp = -Math.PI / 4;

    if (shell.roomNumber === 2) {
        const length = height * 0.12 * 3;
        return { walls: [
            cardinal('top', centerX, centerY - height * 0.22, Math.PI / 2, length),
            cardinal('bottom', centerX, centerY + height * 0.22, Math.PI / 2, length),
            cardinal('left', centerX - width * 0.22, centerY, 0, length),
            cardinal('right', centerX + width * 0.22, centerY, 0, length)
        ], spawnExclusionRegions: [] };
    }
    if (shell.roomNumber === 3 || shell.roomNumber === 4) {
        const length = height * 0.11 * 3;
        const xOffset = width * 0.2;
        const yOffset = height * 0.21;
        const diagonals = [
            cardinal('upper-left', centerX - xOffset, centerY - yOffset, diagonalDown, length),
            cardinal('upper-right', centerX + xOffset, centerY - yOffset, diagonalUp, length),
            cardinal('lower-left', centerX - xOffset, centerY + yOffset, diagonalUp, length),
            cardinal('lower-right', centerX + xOffset, centerY + yOffset, diagonalDown, length)
        ];
        if (shell.roomNumber === 3) return { walls: diagonals, spawnExclusionRegions: [] };
        return { walls: [
            diagonals[0], cardinal('upper-center', centerX, centerY - yOffset, Math.PI / 2, length), diagonals[1],
            cardinal('middle-left', centerX - xOffset, centerY, 0, length),
            cardinal('middle-right', centerX + xOffset, centerY, 0, length),
            diagonals[2], cardinal('lower-center', centerX, centerY + yOffset, Math.PI / 2, length), diagonals[3]
        ], spawnExclusionRegions: [] };
    }
    if (shell.roomNumber === 5) {
        const length = height * 0.1;
        const xOffset = width * 0.2;
        const yOffset = height * 0.22;
        const squares = [
            squareGeometry(`${prefix}-upper-left-square`, centerX - xOffset, centerY - yOffset, length),
            squareGeometry(`${prefix}-upper-right-square`, centerX + xOffset, centerY - yOffset, length),
            squareGeometry(`${prefix}-lower-left-square`, centerX - xOffset, centerY + yOffset, length),
            squareGeometry(`${prefix}-lower-right-square`, centerX + xOffset, centerY + yOffset, length)
        ];
        return {
            walls: [...squares.flatMap(square => square.walls),
                cardinal('center-plus-horizontal', centerX, centerY, 0, length * 2),
                cardinal('center-plus-vertical', centerX, centerY, Math.PI / 2, length * 2)],
            spawnExclusionRegions: squares.map(square => square.enclosedRegion)
        };
    }
    if (shell.roomNumber === 6 || shell.roomNumber === 7) {
        const baseLength = height * 0.11;
        const cornerLength = baseLength * 2;
        const xOffset = width * 0.28;
        const yOffset = height * 0.29;
        const corners = [
            ...inwardCornerWalls(`${prefix}-upper-left-l`, centerX - xOffset, centerY - yOffset, 1, 1, cornerLength),
            ...inwardCornerWalls(`${prefix}-upper-right-l`, centerX + xOffset, centerY - yOffset, -1, 1, cornerLength),
            ...inwardCornerWalls(`${prefix}-lower-left-l`, centerX - xOffset, centerY + yOffset, 1, -1, cornerLength),
            ...inwardCornerWalls(`${prefix}-lower-right-l`, centerX + xOffset, centerY + yOffset, -1, -1, cornerLength)
        ];
        if (shell.roomNumber === 6) {
            const centerSquare = squareGeometry(`${prefix}-center-square`, centerX, centerY, baseLength);
            return { walls: [...corners, ...centerSquare.walls], spawnExclusionRegions: [centerSquare.enclosedRegion] };
        }
        return { walls: [...corners,
            cardinal('center-x-down', centerX, centerY, diagonalDown, baseLength * 2),
            cardinal('center-x-up', centerX, centerY, diagonalUp, baseLength * 2)], spawnExclusionRegions: [] };
    }
    if (shell.roomNumber === 8) {
        const length = height * 0.075;
        const squares = [];
        for (let row = 0; row < 4; row++) for (let column = 0; column < 5; column++) {
            const squareX = centerX + (column - 2) * width * 0.15;
            const squareY = centerY + (row - 1.5) * height * 0.2;
            squares.push(squareGeometry(`${prefix}-square-${row + 1}-${column + 1}`, squareX, squareY, length));
        }
        return { walls: squares.flatMap(square => square.walls), spawnExclusionRegions: squares.map(square => square.enclosedRegion) };
    }
    if (shell.roomNumber === 9) {
        const length = height * 0.22;
        const gap = EXPERIMENTAL_SECTOR_9_NOOK_DEPTH;
        return { walls: [
            cardinal('top', centerX, top + gap, 0, length),
            cardinal('bottom', centerX, bottom - gap, 0, length),
            cardinal('left', left + gap, centerY, Math.PI / 2, length),
            cardinal('right', right - gap, centerY, Math.PI / 2, length)
        ], spawnExclusionRegions: [] };
    }
    return emptyLayout();
}

function nextRoomOrigin(source, direction, roomWidth, roomHeight) {
    if (direction === 'DOWN') return { left: source.left, top: source.top + roomHeight + EXPERIMENTAL_HALLWAY_LENGTH };
    if (direction === 'UP') return { left: source.left, top: source.top - roomHeight - EXPERIMENTAL_HALLWAY_LENGTH };
    if (direction === 'LEFT') return { left: source.left - roomWidth - EXPERIMENTAL_HALLWAY_LENGTH, top: source.top };
    return { left: source.left + roomWidth + EXPERIMENTAL_HALLWAY_LENGTH, top: source.top };
}

function hallwayBounds(source, direction) {
    const centerX = (source.left + source.right) / 2;
    const centerY = (source.top + source.bottom) / 2;
    if (direction === 'DOWN') return boundsAt(centerX - EXPERIMENTAL_HALLWAY_WIDTH / 2, source.bottom, EXPERIMENTAL_HALLWAY_WIDTH, EXPERIMENTAL_HALLWAY_LENGTH);
    if (direction === 'UP') return boundsAt(centerX - EXPERIMENTAL_HALLWAY_WIDTH / 2, source.top - EXPERIMENTAL_HALLWAY_LENGTH, EXPERIMENTAL_HALLWAY_WIDTH, EXPERIMENTAL_HALLWAY_LENGTH);
    if (direction === 'LEFT') return boundsAt(source.left - EXPERIMENTAL_HALLWAY_LENGTH, centerY - EXPERIMENTAL_HALLWAY_WIDTH / 2, EXPERIMENTAL_HALLWAY_LENGTH, EXPERIMENTAL_HALLWAY_WIDTH);
    return boundsAt(source.right, centerY - EXPERIMENTAL_HALLWAY_WIDTH / 2, EXPERIMENTAL_HALLWAY_LENGTH, EXPERIMENTAL_HALLWAY_WIDTH);
}

export function createExperimentalShortcutDefinitions(roomWidth, roomHeight) {
    const sourceBounds = boundsAt(0, 0, roomWidth, roomHeight);
    return Object.freeze(SHORTCUT_ROUTE.map(shortcut => {
        const destinationOrigin = nextRoomOrigin(sourceBounds, shortcut.direction, roomWidth, roomHeight);
        const destinationBounds = boundsAt(destinationOrigin.left, destinationOrigin.top, roomWidth, roomHeight);
        const corridorBounds = hallwayBounds(sourceBounds, shortcut.direction);
        const hallwayId = `experimental-shortcut-hallway-${shortcut.id}`;
        const sourceGeometry = connectionGeometry({ id: 'experimental-room-1', bounds: sourceBounds }, { id: hallwayId, bounds: corridorBounds });
        const destinationGeometry = connectionGeometry({ id: hallwayId, bounds: corridorBounds }, { id: `experimental-room-${shortcut.destinationRoomNumber}`, bounds: destinationBounds });
        return Object.freeze({
            ...shortcut,
            sourceRoomId: 'experimental-room-1',
            destinationRoomId: `experimental-room-${shortcut.destinationRoomNumber}`,
            hallwayId,
            hallwayBounds: corridorBounds,
            sourceEntrance: Object.freeze({ role: 'LOCKED_SOURCE', ...sourceGeometry }),
            destinationEntrance: Object.freeze({ role: 'UNLOCKING_DESTINATION', ...destinationGeometry }),
            sourceMessage: 'Door opens from other side',
            collisionCategory: 'persistent-shortcut'
        });
    }));
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

function buildWalls(shell, entranceShells, interiorWalls = []) {
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
    walls.push(...interiorWalls);
    return walls;
}

export function createExperimentalAreas(roomWidth, roomHeight) {
    const roomOrigins = new Map([[1, { left: 0, top: 0 }]]);
    for (const [from, to, direction] of ROUTE) {
        const source = roomOrigins.get(from);
        roomOrigins.set(to, nextRoomOrigin(source, direction, roomWidth, roomHeight));
    }
    const shells = [];
    for (let roomNumber = 1; roomNumber <= 9; roomNumber++) {
        const origin = roomOrigins.get(roomNumber);
        shells.push({
            ...createExperimentalRoomProgression(roomNumber), id: `experimental-room-${roomNumber}`,
            areaType: EXPERIMENTAL_AREA_TYPE.ROOM, origin: point(origin.left, origin.top),
            width: roomWidth, height: roomHeight, bounds: boundsAt(origin.left, origin.top, roomWidth, roomHeight),
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
    const shortcuts = createExperimentalShortcutDefinitions(roomWidth, roomHeight);
    for (const shortcut of shortcuts) {
        shells.push({
            id: shortcut.hallwayId, areaType: EXPERIMENTAL_AREA_TYPE.HALLWAY, roomNumber: 0,
            width: shortcut.hallwayBounds.right - shortcut.hallwayBounds.left,
            height: shortcut.hallwayBounds.bottom - shortcut.hallwayBounds.top,
            bounds: shortcut.hallwayBounds,
            connectedAreaIds: [shortcut.sourceRoomId, shortcut.destinationRoomId],
            shortcut
        });
        byId.set(shortcut.hallwayId, shells.at(-1));
    }
    const connections = ROUTE.flatMap(([from, to]) => {
        const hallway = byId.get(`experimental-hallway-${from}-${to}`);
        return [[byId.get(`experimental-room-${from}`), hallway], [hallway, byId.get(`experimental-room-${to}`)]];
    }).map(([first, second]) => ({ first, second, ...connectionGeometry(first, second) }));
    for (const shortcut of shortcuts) {
        const hallway = byId.get(shortcut.hallwayId);
        connections.push(
            { first: byId.get(shortcut.sourceRoomId), second: hallway, ...shortcut.sourceEntrance },
            { first: hallway, second: byId.get(shortcut.destinationRoomId), ...shortcut.destinationEntrance }
        );
    }

    return shells.map(shell => {
        const areaConnections = connections.filter(connection => connection.first.id === shell.id || connection.second.id === shell.id);
        const connectedAreaIds = areaConnections.map(connection => connection.first.id === shell.id ? connection.second.id : connection.first.id);
        const interiorLayout = buildInteriorLayout(shell);
        const walls = buildWalls(shell, areaConnections, interiorLayout.walls);
        const b = shell.bounds;
        return createExperimentalArea({
            ...shell, walls, spawnExclusionRegions: interiorLayout.spawnExclusionRegions, connectedAreaIds,
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
        const shortcut = area.shortcut || connected.shortcut || null;
        const isShortcutSource = Boolean(shortcut && [area.id, connected.id].includes(shortcut.sourceRoomId));
        const shortcutRole = shortcut
            ? (isShortcutSource ? shortcut.sourceEntrance.role : shortcut.destinationEntrance.role)
            : null;
        const openingMin = geometry.openingCenter - EXPERIMENTAL_ENTRANCE_WIDTH / 2;
        const openingMax = geometry.openingCenter + EXPERIMENTAL_ENTRANCE_WIDTH / 2;
        const horizontal = geometry.orientation === 'HORIZONTAL';
        const id = `experimental-entrance-${area.id}-${connected.id}`;
        doors.push(Object.freeze({
            id, roomIds: Object.freeze([area.id, connected.id]), ...geometry,
            shortcutId: shortcut?.id || null, shortcutRole,
            color: shortcut?.color || null, colorName: shortcut?.colorName || null,
            sourceMessage: isShortcutSource ? shortcut?.sourceMessage : null,
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
