import test from 'node:test';
import assert from 'node:assert/strict';

import { HUD } from '../ui/hud.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../game.js';
import { createExperimentalAreas, createExperimentalRooms } from '../world/experimental_rooms.js';

function createContext() {
    const arcs = [];
    const lines = [];
    let currentPoint = null;
    const ctx = {
        beginPath() {}, fill() {}, stroke() {}, fillRect() {}, strokeRect() {},
        moveTo(x, y) { currentPoint = { x, y }; },
        lineTo(x, y) { if (currentPoint) lines.push({ start: currentPoint, end: { x, y } }); currentPoint = { x, y }; },
        arc(x, y, radius) { arcs.push({ x, y, radius, fillStyle: this.fillStyle }); }
    };
    return { ctx, arcs, lines };
}

function drawMinimap({ owner, players = [owner], asteroids = [], hazards = [], usesRooms = true }) {
    const { ctx, arcs } = createContext();
    const rooms = createExperimentalAreas(WORLD_WIDTH, WORLD_HEIGHT);
    new HUD().drawMinimap(ctx, players, asteroids, null, false, { usesRooms, owner, rooms, hazards });
    return arcs;
}

test('Experimental minimap maps every room across its full room-local bounds', () => {
    const rooms = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    for (const room of rooms) {
        const owner = { id: 1, roomId: room.id, x: room.bounds.left, y: room.bounds.top };
        const maximum = { x: room.bounds.right, y: room.bounds.bottom, radius: 10, roomId: room.id };
        const center = {
            x: (room.bounds.left + room.bounds.right) / 2,
            y: (room.bounds.top + room.bounds.bottom) / 2,
            radius: 10,
            roomId: room.id
        };
        const arcs = drawMinimap({ owner, asteroids: [maximum, center] });
        assert.deepEqual(arcs.slice(0, 2).map(({ x, y }) => ({ x, y })), [
            { x: 1900, y: 1060 },
            { x: 1740, y: 970 }
        ]);
    }
});

test('Experimental minimap filters all markers by the owning player room and snaps per draw', () => {
    const [room1, room2] = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    const owner = { id: 1, roomId: room1.id, x: 100, y: 100, color: '#0ff' };
    const players = [owner, { id: 3, isNPC: true, roomId: room1.id, x: 200, y: 200 },
        { id: 4, isNPC: true, roomId: room2.id, x: 200, y: 10000 }];
    const asteroids = [{ roomId: room1.id, x: 300, y: 300, radius: 10 },
        { roomId: room2.id, x: 300, y: 10000, radius: 10 }];
    const hazards = [{ roomId: room1.id, x: 400, y: 400 }, { roomId: room2.id, x: 400, y: 10000 }];

    assert.equal(drawMinimap({ owner, players, asteroids, hazards }).length, 4);
    owner.roomId = room2.id;
    owner.y = 10000;
    assert.equal(drawMinimap({ owner, players, asteroids, hazards }).length, 4);
});

test('Experimental minimap snaps to a Room 0 hallway and hides both connected rooms', () => {
    const areas = createExperimentalAreas(WORLD_WIDTH, WORLD_HEIGHT);
    const hallway = areas.find(area => area.id === 'experimental-hallway-1-2');
    const owner = {
        id: 1,
        roomId: hallway.id,
        x: (hallway.bounds.left + hallway.bounds.right) / 2,
        y: (hallway.bounds.top + hallway.bounds.bottom) / 2,
        color: '#0ff'
    };
    const players = [owner,
        { id: 2, roomId: 'experimental-room-1', x: 8640, y: 9600 },
        { id: 3, roomId: 'experimental-room-2', x: 8640, y: 13800 }];
    const asteroids = [
        { roomId: 'experimental-room-1', x: 8640, y: 9600, radius: 10 },
        { roomId: 'experimental-room-2', x: 8640, y: 13800, radius: 10 }
    ];

    const arcs = drawMinimap({ owner, players, asteroids });
    assert.equal(arcs.length, 1);
    assert.deepEqual({ x: arcs[0].x, y: arcs[0].y }, { x: 1740, y: 970 });
});

test('invalid Experimental room membership draws no world markers', () => {
    const owner = { id: 1, roomId: null, x: 100, y: 100 };
    assert.deepEqual(drawMinimap({ owner, asteroids: [{ x: 100, y: 100, radius: 10 }] }), []);
});

test('standard minimap keeps global scaling and ignores room IDs', () => {
    const owner = { id: 1, x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    const otherRoomMarker = { x: WORLD_WIDTH, y: WORLD_HEIGHT, radius: 10, roomId: 'unused' };
    const arcs = drawMinimap({ owner, asteroids: [otherRoomMarker], usesRooms: false });
    assert.deepEqual(arcs.map(({ x, y }) => ({ x, y })), [
        { x: 1900, y: 1060 },
        { x: 1740, y: 970 }
    ]);
});

test('Specter minimap markers are white without changing their ship color', () => {
    const [room] = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    const owner = { id: 1, roomId: room.id, x: 100, y: 100, color: '#0ff' };
    const specter = {
        id: 2, isNPC: true, isExperimentalFleeingNPC: true,
        roomId: room.id, x: 200, y: 200, color: '#f00'
    };
    const arcs = drawMinimap({ owner, players: [owner, specter] });
    assert.equal(arcs.at(-1).fillStyle, '#ffffff');
    assert.equal(specter.color, '#f00');
});

test('Experimental minimap projects authoritative current-room interior walls', () => {
    const room = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT)[7];
    const owner = { id: 1, roomId: room.id, x: room.bounds.left, y: room.bounds.top };
    const { ctx, lines } = createContext();
    new HUD().drawMinimap(ctx, [owner], [], null, false, {
        usesRooms: true, owner, rooms: createExperimentalAreas(WORLD_WIDTH, WORLD_HEIGHT), hazards: []
    });
    const interior = room.walls.filter(wall => wall.id.includes('-interior-'));
    assert.equal(interior.length, 80);
    for (const wall of interior) {
        const expected = {
            start: {
                x: 1580 + (wall.start.x - room.bounds.left) / room.width * 320,
                y: 880 + (wall.start.y - room.bounds.top) / room.height * 180
            },
            end: {
                x: 1580 + (wall.end.x - room.bounds.left) / room.width * 320,
                y: 880 + (wall.end.y - room.bounds.top) / room.height * 180
            }
        };
        assert.ok(lines.some(line => JSON.stringify(line) === JSON.stringify(expected)));
    }
});
