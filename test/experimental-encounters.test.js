import test from 'node:test';
import assert from 'node:assert/strict';

import { Game, GAME_MODE, EXPERIMENTAL_ROOM_WIDTH, EXPERIMENTAL_ROOM_HEIGHT } from '../game.js';
import { Player } from '../entities/player.js';
import {
    createExperimentalAreas, createExperimentalDoors,
    EXPERIMENTAL_HALLWAY_LENGTH, EXPERIMENTAL_HALLWAY_WIDTH
} from '../world/experimental_rooms.js';

function createContext() {
    const experimentalRooms = createExperimentalAreas(EXPERIMENTAL_ROOM_WIDTH, EXPERIMENTAL_ROOM_HEIGHT);
    const context = {
        gameState: GAME_MODE.EXPERIMENTAL,
        experimentalRooms,
        experimentalDoors: createExperimentalDoors(experimentalRooms),
        experimentalAreaIndexes: new Map(experimentalRooms.map(area => [area.id, {
            players: new Set(), asteroids: new Set(), hazards: new Set(), projectiles: new Set(), vfx: new Set()
        }])),
        players: [], botAggressionLevel: 3, experimentalNewGamePlusCycle: 0,
        configurePlayerShields() {}
    };
    Game.prototype.initializeExperimentalEncounterStates.call(context);
    return context;
}

function ordinaryNPC(roomId, id) {
    return Object.assign(new Player(100 + id * 200, 100, id), {
        isNPC: true, isOrdinaryExperimentalNPC: true, noRespawn: true, roomId
    });
}

test('ordinary encounter records gate only the outgoing progression door and exclude Sector 9', () => {
    const game = createContext();
    assert.equal(game.experimentalEncounterStates.size, 8);
    assert.equal(game.experimentalEncounterStates.has('experimental-room-9'), false);
    assert.equal([...game.experimentalEncounterStates.keys()].some(id => id.includes('hallway')), false);

    const room1 = game.experimentalEncounterStates.get('experimental-room-1');
    assert.deepEqual({ cleared: room1.encounterCleared, unlocked: room1.doorUnlocked, count: room1.npcCount, level: room1.npcLevel },
        { cleared: false, unlocked: false, count: 1, level: 1 });
    const outgoing = game.experimentalDoors.find(door => door.id === room1.progressionDoorId);
    const incoming = game.experimentalDoors.find(door => door.roomIds.includes('experimental-room-1') && door !== outgoing);
    assert.equal(Game.prototype.isExperimentalProgressionDoorLocked.call(game, outgoing), true);
    assert.equal(Game.prototype.isExperimentalProgressionDoorLocked.call(game, incoming), false);
});

test('partial deaths stay locked, the final ordinary death permanently unlocks, and reset preserves history', () => {
    const game = createContext();
    const roomId = 'experimental-room-2';
    game.players = [ordinaryNPC(roomId, 2), ordinaryNPC(roomId, 3), ordinaryNPC(roomId, 4)];
    for (const npc of game.players) Game.prototype.indexExperimentalEntity.call(game, 'players', npc);

    const [first, second, final] = game.players;
    first.isDead = first.isEliminated = true;
    assert.equal(Game.prototype.evaluateExperimentalRoomClear.call(game, first), false);
    second.isDead = second.isEliminated = true;
    assert.equal(Game.prototype.evaluateExperimentalRoomClear.call(game, second), false);
    final.isDead = final.isEliminated = true;
    assert.equal(Game.prototype.evaluateExperimentalRoomClear.call(game, final), true);

    const state = game.experimentalEncounterStates.get(roomId);
    assert.equal(state.doorUnlocked, true);
    assert.equal(Game.prototype.evaluateExperimentalRoomClear.call(game, final), false);
    const replacements = Game.prototype.resetExperimentalRoomEncounter.call(game, roomId);
    assert.equal(replacements.length, state.npcCount);
    assert.equal(game.players.filter(player => player.roomId === roomId && player.isOrdinaryExperimentalNPC).length, state.npcCount);
    assert.equal(state.encounterCleared, true);
    assert.equal(state.doorUnlocked, true);
    assert.ok(replacements.every(player => player.noRespawn && player.respawnTimer === 0));
});

test('locked progression collision is human-only while ordinary blockers remain unchanged', () => {
    const game = createContext();
    const roomId = 'experimental-room-1';
    const doorId = game.experimentalEncounterStates.get(roomId).progressionDoorId;
    const human = Object.assign(new Player(4800, 5400, 1), { roomId });
    const npc = Object.assign(new Player(4800, 5400, 2), { roomId, isNPC: true });
    const lockedHumanWalls = Game.prototype.getExperimentalCollisionWalls.call(game, human);
    const npcWalls = Game.prototype.getExperimentalCollisionWalls.call(game, npc);
    assert.ok(lockedHumanWalls.some(wall => wall.id === `${doorId}-blocker`));
    assert.ok(npcWalls.some(wall => wall.id === `${doorId}-blocker`));

    game.experimentalEncounterStates.get(roomId).doorUnlocked = true;
    assert.equal(Game.prototype.getExperimentalCollisionWalls.call(game, human).some(wall => wall.id === `${doorId}-blocker`), false);
    assert.ok(Game.prototype.getExperimentalCollisionWalls.call(game, npc).some(wall => wall.id === `${doorId}-blocker`));
});

test('encounter state does not alter frozen hallway dimensions or doorway geometry', () => {
    const game = createContext();
    for (const hallway of game.experimentalRooms.filter(area => area.roomNumber === 0)) {
        assert.ok([hallway.width, hallway.height].includes(EXPERIMENTAL_HALLWAY_LENGTH));
        assert.ok([hallway.width, hallway.height].includes(EXPERIMENTAL_HALLWAY_WIDTH));
        assert.ok(Object.isFrozen(hallway));
    }
    assert.ok(game.experimentalDoors.every(door => Object.isFrozen(door) && door.openingWidth === 960));
});
