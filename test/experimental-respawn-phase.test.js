import test from 'node:test';
import assert from 'node:assert/strict';

import {
    EXPERIMENTAL_RESPAWN_PHASE_DURATION,
    Player,
    SPAWN_IMMUNITY_DURATION
} from '../entities/player.js';
import {
    chooseDifferentPlayerColor,
    Game,
    GAME_MODE,
    PLAYER_COLORS,
    WORLD_HEIGHT,
    WORLD_WIDTH
} from '../game.js';
import { createExperimentalAreas } from '../world/experimental_rooms.js';

const idleMouse = { x: 1200, y: 540, clicked: false, m2Held: false };
const directWorld = { wrap: false, usesRooms: true };

test('Experimental materialization anchors movement, preserves aim, and sequences immunity', () => {
    const player = new Player(100, 200, 1);
    player.controlMode = 'KEYBOARD';
    player.resetTransientLifeState();
    player.startExperimentalRespawnPhase(400, 500);

    assert.equal(player.experimentalRespawnPhaseTimer, EXPERIMENTAL_RESPAWN_PHASE_DURATION);
    assert.equal(player.spawnImmunityTimer, 0);
    assert.equal(player.experimentalRespawnAnchorX, 400);
    assert.equal(player.experimentalRespawnAnchorY, 500);

    const initialRotation = player.rotation;
    player.update(1, { KeyW: true }, idleMouse, null, [], [], [], false, 20, [], null, false, directWorld);
    assert.deepEqual([player.x, player.y, player.vx, player.vy], [400, 500, 0, 0]);
    assert.notEqual(player.rotation, initialRotation);
    assert.equal(player.getExperimentalRespawnTintProgress(), 0);
    assert.equal(player.spawnImmunityTimer, 0);
    assert.equal(player.fire(), null);

    player.burstCount = 2;
    player.shouldTriggerBurstFire = true;
    player.update(2, { KeyW: true }, idleMouse, null, [], [], [], false, 20, [], null, false, directWorld);
    assert.deepEqual([player.x, player.y, player.vx, player.vy], [400, 500, 0, 0]);
    assert.equal(player.isExperimentalRespawnPhaseActive(), false);
    assert.equal(player.spawnImmunityTimer, SPAWN_IMMUNITY_DURATION);
    assert.equal(player.experimentalRespawnAnchorX, null);
    assert.equal(player.burstCount, 0);
    assert.equal(player.shouldTriggerBurstFire, false);

    player.update(0.25, {}, idleMouse, null, [], [], [], false, 20, [], null, false, directWorld);
    assert.equal(player.spawnImmunityTimer, SPAWN_IMMUNITY_DURATION - 0.25);
});

test('Experimental materialization is immune at the authoritative damage seam', () => {
    const player = new Player(0, 0, 1);
    player.configureShields(2, 6);
    player.startExperimentalRespawnPhase(0, 0);
    const hp = player.currentHP;
    const game = { players: [player] };

    assert.equal(Game.prototype.resolvePlayerDamage.call(game, player, 5), undefined);
    assert.equal(player.currentHP, hp);
    assert.equal(player.shieldCharges, 2);
    assert.equal(player.isDead, false);
});

test('Experimental human respawn returns to Sector 1 and chooses a different shared color', () => {
    const rooms = createExperimentalAreas(WORLD_WIDTH, WORLD_HEIGHT);
    const player = Object.assign(new Player(1, 2, 1, PLAYER_COLORS[0]), {
        isDead: true,
        roomId: rooms.find(room => room.roomNumber === 2).id
    });
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL,
        experimentalRooms: rooms,
        experimentalAreaIndexes: null,
        players: [player],
        audio: { startGameplayMusic() {} },
        showExperimentalSectorMessage() {}
    };

    Game.prototype.respawnPlayer.call(game, player);
    const sectorOne = rooms.find(room => room.roomNumber === 1);
    const center = [
        (sectorOne.bounds.left + sectorOne.bounds.right) / 2,
        (sectorOne.bounds.top + sectorOne.bounds.bottom) / 2
    ];
    assert.deepEqual([player.x, player.y], center);
    assert.deepEqual([player.previousX, player.previousY], center);
    assert.equal(player.roomId, sectorOne.id);
    assert.notEqual(player.color, PLAYER_COLORS[0]);
    assert.equal(PLAYER_COLORS.includes(player.color), true);
    assert.equal(player.experimentalRespawnPhaseTimer, EXPERIMENTAL_RESPAWN_PHASE_DURATION);
    assert.equal(player.spawnImmunityTimer, 0);
});

test('Experimental human respawn reassigns only living NPC color conflicts', () => {
    const rooms = createExperimentalAreas(WORLD_WIDTH, WORLD_HEIGHT);
    const previousColor = PLAYER_COLORS[0];
    const expectedNewColor = chooseDifferentPlayerColor(previousColor, () => 0);
    const human = Object.assign(new Player(1, 2, 1, previousColor), {
        isDead: true,
        roomId: rooms.find(room => room.roomNumber === 2).id
    });
    const conflicting = Object.assign(new Player(10, 10, 2, expectedNewColor), { isNPC: true });
    const unchanged = Object.assign(new Player(20, 20, 3, PLAYER_COLORS.at(-1)), { isNPC: true });
    const deadConflict = Object.assign(new Player(30, 30, 4, expectedNewColor), { isNPC: true, isDead: true });
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL,
        experimentalRooms: rooms,
        experimentalAreaIndexes: null,
        players: [human, conflicting, unchanged, deadConflict],
        audio: { startGameplayMusic() {} },
        showExperimentalSectorMessage() {}
    };
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
        Game.prototype.respawnPlayer.call(game, human);
    } finally {
        Math.random = originalRandom;
    }

    assert.equal(human.color, expectedNewColor);
    assert.notEqual(conflicting.color, human.color);
    assert.equal(unchanged.color, PLAYER_COLORS.at(-1));
    assert.equal(deadConflict.color, expectedNewColor);
});

test('different-color selection reuses the shared palette and excludes the current color', () => {
    for (const currentColor of PLAYER_COLORS) {
        assert.notEqual(chooseDifferentPlayerColor(currentColor, () => 0), currentColor);
        assert.equal(PLAYER_COLORS.includes(chooseDifferentPlayerColor(currentColor, () => 0.999999)), true);
    }
});
