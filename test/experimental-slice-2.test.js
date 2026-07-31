import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, GAME_MODE, PLAYER_COLORS, chooseRandomPlayerColor } from '../game.js';
import { Player } from '../entities/player.js';
import { HUD } from '../ui/hud.js';

test('XP progress is derived from cumulative thresholds and final level', () => {
    const player = new Player(0, 0);
    assert.equal(player.getXPProgressRatio(), 0);
    player.addXP(50);
    assert.equal(player.getXPProgressRatio(), 0.5);
    player.addXP(50);
    assert.equal(player.level, 2);
    assert.equal(player.getXPProgressRatio(), 0);
    player.addXP(200);
    assert.equal(player.getXPProgressRatio(), 0.5);
    player.totalXP = Number.MAX_SAFE_INTEGER;
    assert.equal(player.getXPProgressRatio(), 1);
});

test('authoritative XP awards emit exact source and one level-up toast', () => {
    const killer = new Player(10, 20, 1, '#abcdef');
    killer.controlMode = 'KEYBOARD';
    const game = { players: [killer], vfx: [], gameState: GAME_MODE.SOLO };
    const source = { x: 100, y: 200, radius: 25, roomId: 'room' };
    assert.equal(Game.prototype.awardXP.call(game, killer, 500, source), 2);
    assert.equal(killer.totalXP, 500);
    assert.equal(killer.pendingLevelUps, 2);
    assert.deepEqual(game.vfx.map(({ text, x, y, color, roomId }) => ({ text, x, y, color, roomId })), [
        { text: '+500 XP', x: 100, y: 157, color: '#ffff66', roomId: 'room' },
        { text: 'Lvl Up!', x: 10, y: -29, color: '#abcdef', roomId: null }
    ]);
});

test('invalid or non-leveling rewards do not create inappropriate toasts', () => {
    const killer = new Player(0, 0);
    const game = { players: [killer], vfx: [], gameState: GAME_MODE.SOLO };
    assert.equal(Game.prototype.awardXP.call(game, killer, 0, { x: 1, y: 2 }), 0);
    assert.equal(Game.prototype.awardXP.call(game, {}, 10, { x: 1, y: 2 }), 0);
    assert.equal(game.vfx.length, 0);
    Game.prototype.awardXP.call(game, killer, 5, { x: 1, y: 2 });
    assert.deepEqual(game.vfx.map(effect => effect.text), ['+5 XP']);
});

test('number keys dispatch ordered upgrades only to an eligible keyboard player', () => {
    const keyboard = new Player(0, 0);
    keyboard.controlMode = 'KEYBOARD';
    keyboard.pendingLevelUps = 3;
    const gamepad = new Player(0, 0, 2);
    gamepad.controlMode = 'GAMEPAD';
    gamepad.pendingLevelUps = 3;
    const game = { players: [gamepad, keyboard], isPauseMenuOpen: false, activeModal: null, isInGameplayState: () => true };
    assert.equal(Game.prototype.handleLevelUpgradeKey.call(game, 'Digit1'), true);
    assert.equal(Game.prototype.handleLevelUpgradeKey.call(game, 'Digit2'), true);
    assert.equal(Game.prototype.handleLevelUpgradeKey.call(game, 'Digit3'), true);
    assert.deepEqual([keyboard.projectileUpgradeCount, keyboard.speedUpgradeCount, keyboard.levelShieldUpgradeCount], [1, 1, 1]);
    assert.equal(gamepad.pendingLevelUps, 3);
    assert.equal(Game.prototype.handleLevelUpgradeKey.call(game, 'Digit1'), false);
    game.isPauseMenuOpen = true;
    keyboard.pendingLevelUps = 1;
    assert.equal(Game.prototype.handleLevelUpgradeKey.call(game, 'Digit1'), false);
});

test('HUD upgrade prompts and XP bar use the shared order, capsule width, and player color', () => {
    const player = new Player(0, 0, 1, '#123456');
    player.pendingLevelUps = 1;
    player.addXP(50);
    const texts = [];
    const fills = [];
    const ctx = {
        save() {}, restore() {}, strokeRect() {},
        fillText(text) { texts.push(text); },
        fillRect(x, y, width, height) { fills.push({ x, y, width, height, color: this.fillStyle, blur: this.shadowBlur }); }
    };
    const hud = new HUD();
    hud.drawLevelUpChoices(ctx, player, 960, 980);
    hud.drawXPBar(ctx, player, 960, 980, 5);
    assert.deepEqual(hud.getLevelUpgradeBoxes(960, 980).map(box => box.choice), ['projectile', 'speed', 'shield']);
    for (const label of ['Select a Power Up', '1 / A', '2 / Y', '3 / B']) assert.ok(texts.includes(label));
    assert.deepEqual(fills.slice(-2).map(fill => [fill.width, fill.color, fill.blur]), [[482, '#222', 0], [241, '#123456', 0]]);
});

test('Experimental transformation policy and NPC palette are mode isolated', () => {
    assert.equal(Game.prototype.areTransformationsEnabled.call({ gameState: GAME_MODE.EXPERIMENTAL }), false);
    assert.equal(Game.prototype.areTransformationsEnabled.call({ gameState: GAME_MODE.ARCADE }), false);
    assert.equal(Game.prototype.areTransformationsEnabled.call({ gameState: GAME_MODE.SOLO }), true);
    assert.equal(Game.prototype.areTransformationsEnabled.call({ gameState: GAME_MODE.PVP }), true);
    assert.equal(chooseRandomPlayerColor(() => 0), PLAYER_COLORS[0]);
    assert.equal(chooseRandomPlayerColor(() => 0.999), PLAYER_COLORS.at(-1));

    const transformed = new Player(0, 0);
    transformed.score = 100;
    transformed.setEvolutionForm('DIMENSION X');
    transformed.update(0, {}, {}, null, [], [], [], false, 20, [], null, false);
    assert.equal(transformed.isDimensionX, false);
});
