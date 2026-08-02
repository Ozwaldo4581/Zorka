import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioManager, DEFAULT_MUSIC_VOLUME_LEVEL, DEFAULT_SFX_VOLUME_LEVEL } from '../audio_manager.js';
import { Game, GAME_MODE, PLAYER_COLORS, DEFAULT_P1_CONTROL_MODE, WORLD_WIDTH, WORLD_HEIGHT, chooseRandomPlayerColor } from '../game.js';
import { Player } from '../entities/player.js';
import { HUD } from '../ui/hud.js';
import { createExperimentalRooms } from '../world/experimental_rooms.js';

test('XP progress is derived from cumulative thresholds and final level', () => {
    const player = new Player(0, 0);
    assert.equal(player.getXPProgressRatio(), 0);
    player.addXP(50);
    assert.equal(player.getXPProgressRatio(), 0.5);
    player.addXP(50);
    assert.equal(player.level, 1);
    assert.equal(player.getXPProgressRatio(), 0);
    player.addXP(50);
    assert.equal(player.getXPProgressRatio(), 0.125);
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
    for (const label of ['Select a Level Up Bonus', '1 / X', '2 / Y', '3 / B']) assert.ok(texts.includes(label));
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

test('default audio and input settings use SFX level 2 and keyboard/mouse', () => {
    const audio = new AudioManager();
    assert.equal(DEFAULT_SFX_VOLUME_LEVEL, 2);
    assert.equal(audio.getSfxVolumeLevel(), 2);
    assert.equal(audio.volumeLevelToGain(2), 0.4);
    assert.equal(audio.getMusicVolumeLevel(), DEFAULT_MUSIC_VOLUME_LEVEL);
    audio.setSfxVolumeLevel(4);
    assert.equal(audio.getSfxVolumeLevel(), 4, 'an explicit preference remains selected');
    assert.equal(DEFAULT_P1_CONTROL_MODE, 'KEYBOARD');
});

test('Experimental NPC respawns restore the numbered-room level, bounds, area, and color palette', () => {
    const rooms = createExperimentalRooms(WORLD_WIDTH, WORLD_HEIGHT);
    for (const roomNumber of [2, 3, 9]) {
        const room = rooms.find(candidate => candidate.roomNumber === roomNumber);
        const npc = new Player(room.spawnRegion.left, room.spawnRegion.top, roomNumber + 1, '#not-a-palette-color');
        npc.isNPC = true;
        npc.roomId = room.id;
        npc.initializeNPCLevel(1);
        npc.isDead = true;
        const game = {
            gameState: GAME_MODE.EXPERIMENTAL,
            experimentalRooms: rooms,
            players: [npc],
            startingShieldCharges: 0,
            findExperimentalSpawn: Game.prototype.findExperimentalSpawn
        };
        Game.prototype.respawnPlayer.call(game, npc);
        assert.equal(npc.level, roomNumber);
        assert.equal(npc.roomId, room.id);
        assert.ok(npc.x >= room.spawnRegion.left && npc.x <= room.spawnRegion.right);
        assert.ok(npc.y >= room.spawnRegion.top && npc.y <= room.spawnRegion.bottom);
        assert.ok(PLAYER_COLORS.includes(npc.color));
        assert.equal(game.players.filter(player => player.isNPC && !player.isDead).length, 1);
    }
});

test('the shared reward schema creates one event pair in every active mode', () => {
    for (const gameState of [GAME_MODE.SOLO, GAME_MODE.PVP, GAME_MODE.ARCADE, GAME_MODE.EXPERIMENTAL]) {
        const killer = new Player(10, 20, 1, '#00ffff');
        const npc = new Player(100, 200, 2, '#ff00ff');
        npc.isNPC = true;
        npc.initializeNPCLevel(2);
        const game = { players: [killer, npc], vfx: [], gameState };
        const reward = Game.prototype.getNPCXPReward.call(game, npc);
        assert.equal(reward, 200);
        assert.equal(Game.prototype.awardXP.call(game, killer, reward, npc), 1);
        assert.equal(killer.totalXP, 200);
        assert.equal(killer.level, 1);
        assert.equal(killer.pendingLevelUps, 1);
        assert.equal(killer.getXPProgressRatio(), 0.25);
        assert.deepEqual(game.vfx.map(effect => effect.text), ['+200 XP', 'Lvl Up!']);
    }
});
