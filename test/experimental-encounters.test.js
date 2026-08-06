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
    assert.deepEqual({
        cleared: room1.encounterCleared, unlocked: room1.doorUnlocked, count: room1.npcCount,
        required: room1.requiredPlayerKills, credited: room1.playerCreditedKills, level: room1.npcLevel
    }, { cleared: false, unlocked: false, count: 1, required: 1, credited: 0, level: 1 });
    const outgoing = game.experimentalDoors.find(door => door.id === room1.progressionDoorId);
    const incoming = game.experimentalDoors.find(door => door.roomIds.includes('experimental-room-1') && door !== outgoing);
    assert.equal(Game.prototype.isExperimentalProgressionDoorLocked.call(game, outgoing), true);
    assert.equal(Game.prototype.isExperimentalProgressionDoorLocked.call(game, incoming), false);
});

test('only human-credited ordinary NPC deaths unlock at the configured target', () => {
    const game = createContext();
    const roomId = 'experimental-room-2';
    const human = Object.assign(new Player(100, 400, 1), { roomId });
    game.players = [human, ordinaryNPC(roomId, 2), ordinaryNPC(roomId, 3), ordinaryNPC(roomId, 4)];
    for (const npc of game.players) Game.prototype.indexExperimentalEntity.call(game, 'players', npc);

    const state = game.experimentalEncounterStates.get(roomId);
    const first = game.players[1];
    assert.equal(Game.prototype.resolveExperimentalOrdinaryNPCDeath.call(game, first, human), false);
    assert.equal(state.playerCreditedKills, 1);
    assert.equal(state.doorUnlocked, false);

    const second = game.players.find(player => player.isOrdinaryExperimentalNPC);
    assert.equal(Game.prototype.resolveExperimentalOrdinaryNPCDeath.call(game, second, { owner: human }), false);
    assert.equal(state.playerCreditedKills, 2);

    const final = game.players.find(player => player.isOrdinaryExperimentalNPC);
    assert.equal(Game.prototype.resolveExperimentalOrdinaryNPCDeath.call(game, final, human), true);
    assert.equal(state.doorUnlocked, true);
    const replacements = Game.prototype.resetExperimentalRoomEncounter.call(game, roomId);
    assert.equal(replacements.length, state.npcCount);
    assert.equal(game.players.filter(player => player.roomId === roomId && player.isOrdinaryExperimentalNPC).length, state.npcCount);
    assert.equal(state.encounterCleared, true);
    assert.equal(state.doorUnlocked, true);
    assert.ok(replacements.every(player => player.noRespawn && player.respawnTimer === 0));
    assert.equal(state.playerCreditedKills, state.requiredPlayerKills);
});

test('non-human and environmental ordinary NPC deaths replace one opportunity without progress', () => {
    const sources = [
        null,
        {},
        Object.assign(new Player(0, 0, 50), { isNPC: true }),
        { owner: Object.assign(new Player(0, 0, 51), { isNPC: true }) },
        { isSatellite: true },
        { isDebris: true },
        { size: 'large' },
        { owner: null }
    ];
    for (const source of sources) {
        const game = createContext();
        const roomId = 'experimental-room-2';
        const human = Object.assign(new Player(0, 0, 1), { roomId });
        const victim = ordinaryNPC(roomId, 2);
        game.players = [human, victim];
        Game.prototype.indexExperimentalEntity.call(game, 'players', victim);
        assert.equal(Game.prototype.resolveExperimentalOrdinaryNPCDeath.call(game, victim, source), false);
        const state = game.experimentalEncounterStates.get(roomId);
        assert.equal(state.playerCreditedKills, 0);
        assert.equal(state.requiredPlayerKills, 3);
        const replacements = game.players.filter(player => player.isOrdinaryExperimentalNPC);
        assert.equal(replacements.length, 1);
        assert.equal(replacements[0].roomId, roomId);
        assert.equal(replacements[0].level, state.npcLevel);
        assert.equal(replacements[0].aggressionLevel, game.botAggressionLevel);
        assert.ok(game.experimentalAreaIndexes.get(roomId).players.has(replacements[0]));
    }
});

test('self-kills and inactive human sources do not receive encounter credit', () => {
    const game = createContext();
    const roomId = 'experimental-room-1';
    const victim = ordinaryNPC(roomId, 2);
    game.players = [victim];
    assert.equal(Game.prototype.resolveExperimentalHumanKillCredit.call(game, victim, victim), null);
    assert.equal(Game.prototype.resolveExperimentalHumanKillCredit.call(game, victim, new Player(0, 0, 3)), null);
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
