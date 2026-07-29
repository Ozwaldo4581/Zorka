import test from 'node:test';
import assert from 'node:assert/strict';

import { Game, WORLD_WIDTH } from '../game.js';
import { Player } from '../entities/player.js';

test('LT hysteresis consumes one attempt until release', () => {
    const player = new Player(0, 0);

    assert.equal(player.updateControllerAimLockTrigger(0.4, 0.65, 0.25), false);
    assert.equal(player.updateControllerAimLockTrigger(0.65, 0.65, 0.25), true);
    assert.equal(player.updateControllerAimLockTrigger(1, 0.65, 0.25), false);
    player.beginAimLock({ x: 10, y: 0 });
    player.resolveAimLock(() => false);
    assert.equal(player.aimLockActive, false);
    assert.equal(player.updateControllerAimLockTrigger(1, 0.65, 0.25), false);
    player.beginAimLock({ x: 10, y: 0 });
    assert.equal(player.updateControllerAimLockTrigger(0.4, 0.65, 0.25), false);
    assert.equal(player.aimLockActive, true);
    assert.equal(player.updateControllerAimLockTrigger(0.25, 0.65, 0.25), false);
    assert.equal(player.aimLockActive, false);
    assert.equal(player.updateControllerAimLockTrigger(0.65, 0.65, 0.25), true);
});

test('controller aim uses normalized right stick and facing fallback', () => {
    const player = new Player(0, 0);
    player.rotation = Math.PI / 2;

    const fallback = player.getControllerAimDirection({ axes: [0, 0, 0, 0] });
    assert.ok(Math.abs(fallback.x - 1) < Number.EPSILON);
    assert.ok(Math.abs(fallback.y) < Number.EPSILON);
    assert.deepEqual(player.getControllerAimDirection({ axes: [0, 0, 3, 4] }), { x: 0.6, y: 0.8 });
});

test('ray corridor is wrap-aware and chooses first hit with stable tie behavior', () => {
    const player = new Player(WORLD_WIDTH - 20, 100);
    const centeredFar = { x: 180, y: 100, radius: 10 };
    const offAxisNear = { x: 80, y: 120, radius: 10 };
    const behind = { x: WORLD_WIDTH - 100, y: 100, radius: 100 };
    const fakeGame = {
        getAimLockCandidates: () => [
            { entity: centeredFar, stableIndex: 0 },
            { entity: offAxisNear, stableIndex: 1 },
            { entity: behind, stableIndex: 2 }
        ]
    };

    assert.equal(Game.prototype.findControllerAimLockTarget.call(fakeGame, player, { x: 1, y: 0 }), offAxisNear);
});

test('controller assignment preserves P1/P2 pad selection', () => {
    const pad0 = { index: 0 };
    const pad1 = { index: 1 };
    const p1 = { id: 1, controlMode: 'GAMEPAD' };
    const p2 = { id: 2, controlMode: 'GAMEPAD' };
    const fakeGame = { players: [p1, p2] };

    assert.equal(Game.prototype.getAssignedGamepad.call(fakeGame, p1, [pad0, pad1]), pad0);
    assert.equal(Game.prototype.getAssignedGamepad.call(fakeGame, p2, [pad0, pad1]), pad1);
    p1.controlMode = 'KEYBOARD';
    assert.equal(Game.prototype.getAssignedGamepad.call(fakeGame, p2, [pad0]), pad0);
});
