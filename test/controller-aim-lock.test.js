import test from 'node:test';
import assert from 'node:assert/strict';

import { Game, MOUSE_AIM_LOCK_PADDING, WORLD_HEIGHT, WORLD_WIDTH } from '../game.js';
import { Player } from '../entities/player.js';

const mouseInput = overrides => ({
    x: 1920,
    y: 540,
    m2Held: false,
    m2Released: false,
    clicked: false,
    ...overrides
});

const gamepadInput = ({ leftX = 0, leftY = -1, rightX = 1, rightY = 0 } = {}) => ({
    axes: [leftX, leftY, rightX, rightY],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }))
});

const updateKeyboard = (player, { targetIsValid = () => true, mouse = {}, keys = { KeyW: true } } = {}) => {
    player.controlMode = 'KEYBOARD';
    player.update(0.1, keys, mouseInput(mouse), null, [], [], [], false, 20, [], targetIsValid);
};

const updateController = (player, pad, targetIsValid = () => true) => {
    player.controlMode = 'GAMEPAD';
    player.update(0.1, {}, mouseInput(), null, [], [], [pad], false, 20, [], targetIsValid);
};

test('keyboard movement remains absolute with a valid lock', () => {
    const player = new Player(100, 100);

    updateKeyboard(player);
    assert.ok(Math.abs(player.vx) < 1e-10);
    assert.ok(player.vy < 0);

    player.vx = 0;
    player.vy = 0;
    player.x = 100;
    player.y = 100;
    player.beginAimLock({ x: 200, y: 100, radius: 10 });
    updateKeyboard(player, { mouse: { m2Held: true } });
    assert.ok(Math.abs(player.vx) < 1e-10);
    assert.ok(player.vy < 0);

    player.vx = 0;
    player.vy = 0;
    player.x = 100;
    player.y = 100;
    updateKeyboard(player, { mouse: { m2Released: true } });
    assert.equal(player.aimLockActive, false);
    assert.ok(Math.abs(player.vx) < 1e-10);
    assert.ok(player.vy < 0);
});

test('invalid and failed mouse locks remain absolute', () => {
    const invalidated = new Player(100, 100);
    invalidated.beginAimLock({ x: 200, y: 100, radius: 10 });
    updateKeyboard(invalidated, { mouse: { m2Held: true }, targetIsValid: () => false });
    assert.equal(invalidated.aimLockActive, false);
    assert.ok(Math.abs(invalidated.vx) < 1e-10);
    assert.ok(invalidated.vy < 0);

    const failed = new Player(100, 100);
    updateKeyboard(failed, { mouse: { m2Held: true } });
    assert.equal(failed.aimLockActive, false);
    assert.ok(Math.abs(failed.vx) < 1e-10);
    assert.ok(failed.vy < 0);
});

test('controller movement remains absolute with a valid lock', () => {
    const player = new Player(100, 100);
    const pad = gamepadInput();

    updateController(player, pad);
    assert.ok(Math.abs(player.vx) < 1e-10);
    assert.ok(player.vy < 0);

    player.vx = 0;
    player.vy = 0;
    player.x = 100;
    player.y = 100;
    player.beginAimLock({ x: 200, y: 100, radius: 10 });
    updateController(player, pad);
    assert.ok(Math.abs(player.vx) < 1e-10);
    assert.ok(player.vy < 0);

    player.vx = 0;
    player.vy = 0;
    player.x = 100;
    player.y = 100;
    player.clearAimLock();
    updateController(player, pad);
    assert.ok(Math.abs(player.vx) < 1e-10);
    assert.ok(player.vy < 0);
});

test('target locking does not change movement axes or NPC steering', () => {
    const unlocked = new Player(100, 100);
    const locked = new Player(100, 100);
    locked.beginAimLock({ x: 200, y: 100, radius: 10 });
    updateKeyboard(unlocked);
    updateKeyboard(locked, { mouse: { m2Held: true } });
    assert.ok(unlocked.vy < 0);
    assert.ok(Math.abs(locked.vx) < 1e-10);
    assert.ok(locked.vy < 0);

    const npc = new Player(100, 100, 3);
    npc.isNPC = true;
    npc.beginAimLock({ x: 200, y: 100, radius: 10 });
    npc.updateNPC = (_dt, _others, _asteroids, setForce) => setForce({ x: 123, y: 456 });
    npc.update(0.1, { KeyW: true }, mouseInput({ m2Held: true }), null, [], [], [], false, 20, [], () => true);
    assert.ok(npc.vx > 0);
    assert.ok(npc.vy > 0);
});

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

test('failed LT acquisition and held LT after invalidation stay absolute without reacquiring', () => {
    const player = new Player(100, 100);
    const pad = gamepadInput();

    assert.equal(player.updateControllerAimLockTrigger(0.7, 0.65, 0.25), true);
    updateController(player, pad);
    assert.equal(player.aimLockActive, false);
    assert.ok(Math.abs(player.vx) < 1e-10);
    assert.ok(player.vy < 0);
    assert.equal(player.updateControllerAimLockTrigger(1, 0.65, 0.25), false);

    player.vx = 0;
    player.vy = 0;
    player.x = 100;
    player.y = 100;
    player.beginAimLock({ x: 200, y: 100, radius: 10 });
    updateController(player, pad, () => false);
    assert.equal(player.aimLockActive, false);
    assert.ok(Math.abs(player.vx) < 1e-10);
    assert.ok(player.vy < 0);
    assert.equal(player.updateControllerAimLockTrigger(1, 0.65, 0.25), false);
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

const findMouseTarget = (candidates, x = 0, y = 0) => Game.prototype.findAimLockTargetAt.call({
    getAimLockCandidates: () => candidates.map((entity, stableIndex) => ({
        entity,
        tiePriority: stableIndex,
        stableIndex
    }))
}, {}, x, y);

test('mouse acquisition accepts exact and padded hits but rejects outside misses without changing radii', () => {
    const target = { x: 100, y: 100, radius: 10 };
    const originalRadius = target.radius;

    assert.equal(findMouseTarget([target], 105, 100), target);
    assert.equal(findMouseTarget([target], 100 + target.radius + MOUSE_AIM_LOCK_PADDING - 1, 100), target);
    assert.equal(findMouseTarget([target], 100 + target.radius + MOUSE_AIM_LOCK_PADDING + 1, 100), null);
    assert.equal(target.radius, originalRadius);
});

test('mouse acquisition prioritizes exact hits, then the closest padded edge', () => {
    const exact = { x: 8, y: 0, radius: 10 };
    const buffered = { x: 2, y: 0, radius: 1 };
    assert.equal(findMouseTarget([buffered, exact]), exact);

    const fartherEdge = { x: 20, y: 0, radius: 5 };
    const closerEdge = { x: 18, y: 0, radius: 10 };
    assert.equal(findMouseTarget([fartherEdge, closerEdge]), closerEdge);
});

test('mouse acquisition padding remains wrap-aware across both world seams', () => {
    const target = { x: WORLD_WIDTH - 5, y: WORLD_HEIGHT - 5, radius: 8 };
    assert.equal(findMouseTarget([target], 4, 4), target);
});

test('cursor visibility derives only from a valid keyboard Player 1 lock', () => {
    const p1 = new Player(0, 0, 1);
    p1.controlMode = 'KEYBOARD';
    const p2 = new Player(100, 0, 2);
    p2.controlMode = 'GAMEPAD';
    const fakeGame = {
        players: [p1, p2],
        projectiles: [],
        hazards: [],
        asteroids: [],
        isValidAimLockTarget: Game.prototype.isValidAimLockTarget,
        getMouseControlledPlayer: Game.prototype.getMouseControlledPlayer
    };

    assert.equal(Game.prototype.shouldHideMouseCursor.call(fakeGame), false);
    p2.beginAimLock(p1);
    assert.equal(Game.prototype.shouldHideMouseCursor.call(fakeGame), false);

    p1.beginAimLock(p2);
    assert.equal(Game.prototype.shouldHideMouseCursor.call(fakeGame), true);
    p1.clearAimLock();
    assert.equal(Game.prototype.shouldHideMouseCursor.call(fakeGame), false);

    p1.beginAimLock(p2);
    fakeGame.players = [p1];
    assert.equal(Game.prototype.shouldHideMouseCursor.call(fakeGame), false);
});

test('controller activity does not hide the cursor while Player 1 owns mouse controls', () => {
    const p1 = new Player(0, 0, 1);
    p1.controlMode = 'KEYBOARD';
    const fakeGame = {
        players: [p1],
        isInGameplayState: () => true,
        getMouseControlledPlayer: Game.prototype.getMouseControlledPlayer
    };

    assert.doesNotThrow(() => Game.prototype.updateGamepadVisibilityDetection.call(fakeGame));
});

test('drawCrosshair hides and restores the DOM cursor from the derived lock state', () => {
    const style = {
        display: '',
        setProperty() {}
    };
    const fakeGame = {
        cursorVisible: true,
        domCursor: { style },
        players: [],
        selectedCursorStyle: 0,
        shouldHideMouseCursor: () => true
    };

    Game.prototype.drawCrosshair.call(fakeGame);
    assert.equal(style.display, 'none');
    fakeGame.shouldHideMouseCursor = () => false;
    Game.prototype.drawCrosshair.call(fakeGame);
    assert.equal(style.display, 'block');
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

test('aim-lock outline is derived from each player target regardless of input mode', () => {
    const drawnArcs = [];
    const ctx = {
        save() {},
        restore() {},
        setLineDash() {},
        beginPath() {},
        stroke() {},
        arc(x, y, radius) { drawnArcs.push({ x, y, radius }); }
    };
    const camera = {
        zoom: 1,
        apply(_ctx, x, y) { this.appliedAt = { x, y }; }
    };
    const keyboardPlayer = new Player(0, 0, 1, '#00ffff');
    keyboardPlayer.controlMode = 'KEYBOARD';
    keyboardPlayer.beginAimLock({ x: 40, y: 50, radius: 20 });

    Game.prototype.drawAimLockOutline.call({}, ctx, keyboardPlayer, camera);

    assert.deepEqual(camera.appliedAt, { x: 40, y: 50 });
    assert.deepEqual(drawnArcs, [{ x: 0, y: 0, radius: 32 }]);

    const gamepadPlayer = new Player(0, 0, 2, '#ff00ff');
    gamepadPlayer.controlMode = 'GAMEPAD';
    gamepadPlayer.beginAimLock({ x: 80, y: 90, radius: 30 });
    Game.prototype.drawAimLockOutline.call({}, ctx, gamepadPlayer, camera);
    assert.deepEqual(camera.appliedAt, { x: 80, y: 90 });
    assert.deepEqual(drawnArcs.at(-1), { x: 0, y: 0, radius: 42 });

    keyboardPlayer.clearAimLock();
    Game.prototype.drawAimLockOutline.call({}, ctx, keyboardPlayer, camera);
    assert.equal(drawnArcs.length, 2);
});
