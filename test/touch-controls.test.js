import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DESIGN_WIDTH,
    Game,
    TOUCH_AIM_DRAG_THRESHOLD,
    TOUCH_AIM_LOCK_PADDING,
    TOUCH_LOCK_HOLD_MS,
    isTouchMovementHalf,
    normalizeTouchJoystick
} from '../game.js';
import { Player } from '../entities/player.js';
import { Asteroid } from '../entities/asteroid.js';
import { HUD } from '../ui/hud.js';

const touchEvent = (pointerId, clientX, clientY, timeStamp = 0) => ({
    pointerType: 'touch', pointerId, clientX, clientY, timeStamp
});

function createTouchGame() {
    const captured = new Set();
    const game = {
        canvas: {
            getBoundingClientRect: () => ({ left: 10, top: 20 }),
            setPointerCapture: id => captured.add(id),
            hasPointerCapture: id => captured.has(id),
            releasePointerCapture: id => captured.delete(id)
        },
        scale: 2,
        players: [new Player(0, 0, 1)],
        hud: new HUD(),
        gameState: 'SOLO',
        isPauseMenuOpen: false,
        activeModal: null,
        optionsOpenedFromPause: false,
        victoryFadeActive: false,
        victoryScreenActive: false,
        isInGameplayState: () => true
    };
    for (const method of [
        'createTouchInputState', 'getDesignPoint', 'canAcceptGameplayTouch', 'handleTouchPointerDown',
        'handleTouchPointerMove', 'handleTouchPointerEnd', 'resetTouchInput', 'getTouchIntent'
    ]) game[method] = Game.prototype[method];
    game.touch = game.createTouchInputState();
    return { game, captured };
}

test('touch helpers convert halves and normalize a deadzoned, clamped floating stick', () => {
    assert.equal(isTouchMovementHalf(DESIGN_WIDTH / 2 - 1), true);
    assert.equal(isTouchMovementHalf(DESIGN_WIDTH / 2), false);
    assert.deepEqual(normalizeTouchJoystick(1, 1), { x: 0, y: 0 });
    const diagonal = normalizeTouchJoystick(120, 120);
    assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-10);
    assert.deepEqual(normalizeTouchJoystick(0, -120), { x: 0, y: -1 });

    const { game } = createTouchGame();
    assert.deepEqual(game.getDesignPoint({ clientX: 210, clientY: 120 }), { x: 100, y: 50 });
});

test('independent left and right pointers produce movement and aim/fire intents', () => {
    const { game, captured } = createTouchGame();
    assert.equal(game.handleTouchPointerDown(touchEvent(1, 210, 220)), true);
    assert.equal(game.handleTouchPointerDown(touchEvent(2, 3010, 220)), true);
    game.handleTouchPointerMove(touchEvent(1, 450, 220));
    game.handleTouchPointerMove(touchEvent(2, 3250, 220));

    const intent = game.getTouchIntent();
    assert.equal(intent.movementActive, true);
    assert.equal(intent.moveX, 1);
    assert.equal(intent.aimActive, true);
    assert.equal(intent.fireHeld, true);
    assert.deepEqual([...captured], [1, 2]);
    assert.equal(game.handleTouchPointerDown(touchEvent(3, 3410, 220)), false, 'a second right pointer is ignored');

    game.handleTouchPointerEnd(touchEvent(2, 3250, 220));
    assert.equal(game.getTouchIntent().fireHeld, false);
    assert.equal(game.getTouchIntent().movementActive, true);
    game.resetTouchInput();
    assert.equal(game.getTouchIntent().movementActive, false);
    assert.equal(captured.size, 0);
});

test('right drag threshold takes manual aim authority while a stationary hold does not fire', () => {
    const { game } = createTouchGame();
    const player = game.players[0];
    player.beginAimLock({ x: 10, y: 10, radius: 1 });
    game.touch.persistentLock = true;
    game.handleTouchPointerDown(touchEvent(7, 3010, 220, 100));
    game.handleTouchPointerMove(touchEvent(7, 3010 + TOUCH_AIM_DRAG_THRESHOLD - 1, 220, 150));
    assert.equal(game.getTouchIntent().fireHeld, false);
    assert.equal(player.aimLockActive, true);
    game.handleTouchPointerMove(touchEvent(7, 3010 + TOUCH_AIM_DRAG_THRESHOLD * 3, 220, 160));
    assert.equal(game.getTouchIntent().fireHeld, true);
    assert.equal(player.aimLockActive, false);
});

test('touch hold reuses camera conversion, padded ranking, and ship/asteroid filtering', () => {
    const player = new Player(0, 0, 1);
    const asteroid = new Asteroid(510, 500, 'small');
    const hazard = { x: 500, y: 500, radius: 100 };
    let options;
    const game = {
        touch: Game.prototype.createTouchInputState(),
        players: [player],
        gameState: 'SOLO',
        getPlayerOneCamera: () => ({ screenToWorld: (x, y) => ({ x: x + 400, y: y + 400 }) }),
        findAimLockTargetAt(_player, x, y, suppliedOptions) {
            assert.deepEqual({ x, y }, { x: 500, y: 500 });
            options = suppliedOptions;
            return suppliedOptions.filter(hazard) ? hazard : asteroid;
        }
    };
    Object.assign(game.touch.aim, { active: true, mode: 'UNDECIDED', startedAt: 10, startX: 100, startY: 100 });
    assert.equal(Game.prototype.updateTouchAimLock.call(game, 10 + TOUCH_LOCK_HOLD_MS - 1), false);
    assert.equal(Game.prototype.updateTouchAimLock.call(game, 10 + TOUCH_LOCK_HOLD_MS), true);
    assert.equal(options.padding, TOUCH_AIM_LOCK_PADDING);
    assert.equal(options.filter(player), true);
    assert.equal(options.filter(asteroid), true);
    assert.equal(options.filter(hazard), false);
    assert.equal(player.lockedAimTarget, asteroid);
    assert.equal(game.touch.aim.mode, 'LOCK_HOLD');
});

test('HUD touch priority consumes upgrades and capsules before assigning controls', () => {
    const { game } = createTouchGame();
    const player = game.players[0];
    player.pendingLevelUps = 1;
    const upgradeBox = game.hud.getLevelUpgradeBoxes(960, 74)[0];
    game.handleTouchPointerDown(touchEvent(11, 10 + (upgradeBox.x + 1) * 2, 20 + (upgradeBox.y + 1) * 2));
    assert.equal(player.projectileUpgradeCount, 1);
    assert.equal(game.touch.movement.active, false);
    assert.equal(game.touch.aim.active, false);

    player.pendingLevelUps = 0;
    player.powerUpCapsules = 1;
    let consumed = 0;
    player.consumeCapsules = () => { consumed++; };
    const capsuleX = 960 - (5 * 90 + 4 * 8) / 2 + 1;
    game.handleTouchPointerDown(touchEvent(12, 10 + capsuleX * 2, 20 + 981 * 2));
    assert.equal(consumed, 1);
    assert.equal(game.touch.aim.active, false);
});

test('Player consumes normalized touch movement, aim, and held-fire intent', () => {
    const player = new Player(100, 100, 1);
    player.beginAimLock({ x: 200, y: 100, radius: 10 });
    player.update(0.1, { KeyW: true }, {}, null, [], [], [], false, 20, [], () => true, true, null, {
        movementActive: true, moveX: 1, moveY: 0,
        aimActive: true, aimX: 0, aimY: 1, fireHeld: true, preserveAimLock: false
    });
    assert.ok(player.vx > 0);
    assert.ok(Math.abs(player.vy) < 1e-10, 'touch movement replaces rather than sums with keyboard thrust');
    assert.equal(player.rotation, Math.PI);
    assert.equal(player.shouldFire, true);
    assert.equal(player.aimLockActive, false);
});
