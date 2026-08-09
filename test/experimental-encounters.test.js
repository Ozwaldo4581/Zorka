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

test('human spawn creates a level-sized evenly spaced Specter ring without legacy encounter Specters', () => {
    const game = createContext();
    game.experimentalNewGamePlusCycle = 2;
    Game.prototype.initializeExperimentalEncounterStates.call(game);
    const roomId = 'experimental-room-1';
    const room = Game.prototype.getExperimentalRoom.call(game, roomId);
    const human = Object.assign(new Player(
        (room.bounds.left + room.bounds.right) / 2,
        (room.bounds.top + room.bounds.bottom) / 2,
        1
    ), { roomId, level: 5 });
    game.players = [human];
    Game.prototype.indexExperimentalEntity.call(game, 'players', human);

    const ordinary = Game.prototype.spawnOrdinaryExperimentalRoomNPCs.call(game, roomId, game.players);
    assert.equal(ordinary.some(npc => npc.isExperimentalFleeingNPC), false);
    const specters = Game.prototype.spawnExperimentalPlayerSpecterRing.call(game, human);
    assert.equal(specters.length, 5);
    assert.ok(specters.every(npc => npc.isExperimentalSpawnSpecter && npc.isExperimentalFleeingNPC
        && npc.noRespawn && npc.roomId === roomId && npc.level === 1));
    assert.ok(specters.every(npc => Math.abs(Math.hypot(npc.x - human.x, npc.y - human.y) - 70) < 1e-9));
    const angles = specters.map(npc => {
        const angle = Math.atan2(npc.y - human.y, npc.x - human.x);
        return angle < 0 ? angle + Math.PI * 2 : angle;
    }).sort((a, b) => a - b);
    assert.ok(angles.slice(1).every((angle, index) => Math.abs(angle - angles[index] - Math.PI * 2 / 5) < 1e-9));

    human.level = 3;
    const replacementRing = Game.prototype.spawnExperimentalPlayerSpecterRing.call(game, human);
    assert.equal(replacementRing.length, 3);
    assert.equal(game.players.filter(player => player.isExperimentalSpawnSpecter).length, 3);
});

test('Specter deaths neither grant encounter credit nor replace a progression enemy', () => {
    const game = createContext();
    const roomId = 'experimental-room-2';
    const human = Object.assign(new Player(0, 0, 1), { roomId, level: 1 });
    game.players = [human];
    const [specter] = Game.prototype.spawnExperimentalPlayerSpecterRing.call(game, human);
    const state = game.experimentalEncounterStates.get(roomId);
    assert.equal(Game.prototype.resolveExperimentalOrdinaryNPCDeath.call(game, specter, human), false);
    assert.equal(state.playerCreditedKills, 0);
    assert.equal(game.players.some(player => player.isExperimentalFleeingNPC), false);
});

test('Specters flee the nearest human without firing and render the base sprite untinted', () => {
    const specter = Object.assign(new Player(0, 0, 2, '#ff0000'), {
        isNPC: true, isExperimentalFleeingNPC: true, roomId: 'experimental-room-1',
        shouldFire: true, shouldTriggerBurstFire: true
    });
    const fartherHuman = Object.assign(new Player(500, 0, 1), { roomId: specter.roomId });
    const nearerHuman = Object.assign(new Player(100, 0, 3), { roomId: specter.roomId });
    let force = null;
    specter.updateNPC(1, [fartherHuman, nearerHuman], [], value => { force = value; }, [], {
        usesRooms: true, hasHumanInArea: () => true
    });

    assert.equal(specter.npcTarget, nearerHuman);
    assert.equal(specter.shouldFire, false);
    assert.equal(specter.shouldTriggerBurstFire, false);
    assert.equal(specter.npcBehaviorState, 'FLEE');
    assert.ok(force.x < 0, 'flee thrust should point away from a threat to the right');

    const calls = [];
    const image = {};
    specter.drawSpriteWithTint({ drawImage: (...args) => calls.push(args) }, image, 50);
    assert.deepEqual(calls, [[image, -25, -25, 50, 50]]);
});

test('Specter wall recovery steers to the supplied room center once, then resumes fleeing', () => {
    const specter = Object.assign(new Player(0, 0, 2), {
        isNPC: true, isExperimentalFleeingNPC: true, roomId: 'experimental-room-1'
    });
    assert.equal(specter.beginExperimentalSpecterWallRecovery(500, 0), true);
    assert.equal(specter.beginExperimentalSpecterWallRecovery(900, 0), false);
    let force;
    specter.updateNPC(0.1, [], [], value => { force = value; }, [], {
        usesRooms: true, hasHumanInArea: () => true
    });
    assert.equal(specter.experimentalSpecterRecovering, true);
    assert.ok(force.x > 0);
    specter.x = 450;
    specter.updateNPC(0.1, [], [], value => { force = value; }, [], {
        usesRooms: true, hasHumanInArea: () => true
    });
    assert.equal(specter.experimentalSpecterRecovering, false);
    assert.equal(specter.experimentalSpecterRecoveryTarget, null);
});

test('ordinary Experimental NPCs cannot target Specters, while humans can', () => {
    const game = createContext();
    const roomId = 'experimental-room-1';
    const ordinary = Object.assign(ordinaryNPC(roomId, 2), { color: '#ff0000' });
    const specter = Object.assign(ordinaryNPC(roomId, 3), {
        color: '#00ff00', isExperimentalFleeingNPC: true
    });
    const human = Object.assign(new Player(0, 0, 1), { roomId });
    assert.equal(Game.prototype.isHostileTarget.call(game, ordinary, specter), false);
    assert.equal(Game.prototype.isHostileTarget.call(game, human, specter), true);
});
