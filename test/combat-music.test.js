import test from 'node:test';
import assert from 'node:assert/strict';

import { Player } from '../entities/player.js';
import { Satellite, SpaceDebris } from '../entities/hazards.js';
import { Asteroid } from '../entities/asteroid.js';
import { COMBAT_MUSIC_HOLD_DURATION, Game } from '../game.js';

const makeGame = (players) => ({
    players,
    combatMusicTimer: 0,
    lastCombatMusicTier: null,
    audio: { mixes: [], setGameplayMusicMix(intensity, drumsActive) { this.mixes.push({ intensity, drumsActive }); } },
    getActiveCameras: () => [],
    playSpatialEvent() {},
    clearAimLocksForTarget() {},
    createExplosion() {},
    isHardcoreActive: () => false,
    saveExperimentalProfile() {},
    gameState: 'SOLO'
});

const readyPlayer = (id, isNPC = false) => {
    const player = new Player(0, 0, id);
    player.isNPC = isNPC;
    player.spawnImmunityTimer = 0;
    return player;
};

test('confirmed human and NPC damage refreshes combat, including shield-only damage', () => {
    const human = readyPlayer(1);
    const npc = readyPlayer(2, true);
    human.configureShields(1, 4);
    const game = makeGame([human, npc]);

    Game.prototype.resolvePlayerDamage.call(game, npc, 1, human);
    assert.equal(game.combatMusicTimer, COMBAT_MUSIC_HOLD_DURATION);

    game.combatMusicTimer = 1;
    Game.prototype.resolvePlayerDamage.call(game, human, 1, npc);
    assert.equal(game.combatMusicTimer, COMBAT_MUSIC_HOLD_DURATION);

    human.configureShields(1, 4);
    game.combatMusicTimer = 1;
    Game.prototype.resolvePlayerDamage.call(game, human, 1, { owner: npc });
    assert.equal(human.shieldCharges, 0);
    assert.equal(game.combatMusicTimer, COMBAT_MUSIC_HOLD_DURATION);
});

test('environment, NPC-versus-NPC, and human-versus-human damage do not activate combat', () => {
    const human = readyPlayer(1);
    const otherHuman = readyPlayer(2);
    const npc = readyPlayer(3, true);
    const otherNPC = readyPlayer(4, true);
    const game = makeGame([human, otherHuman, npc, otherNPC]);
    const excludedSources = [
        new Asteroid(0, 0, 'small'),
        new Satellite(0, 0),
        new SpaceDebris(0, 0),
        { owner: new Satellite(0, 0) }
    ];

    for (const source of excludedSources) {
        Game.prototype.refreshCombatMusicForDamage.call(game, source, human);
        assert.equal(game.combatMusicTimer, 0);
    }
    Game.prototype.refreshCombatMusicForDamage.call(game, npc, otherNPC);
    Game.prototype.refreshCombatMusicForDamage.call(game, human, otherHuman);
    assert.equal(game.combatMusicTimer, 0);
});

test('combat timer expires, a later hit resets it, and intensity tiers derive from Player 1', () => {
    const human = readyPlayer(1);
    const npc = readyPlayer(2, true);
    human.configureShields(1, 4);
    const game = makeGame([human, npc]);

    assert.deepEqual(Game.prototype.getCombatMusicMix.call(game), { intensity: 1, drumsActive: false });
    Game.prototype.refreshCombatMusicForDamage.call(game, human, npc);
    assert.deepEqual(Game.prototype.getCombatMusicMix.call(game), { intensity: 1.15, drumsActive: true });

    human.shieldCharges = 0;
    assert.deepEqual(Game.prototype.getCombatMusicMix.call(game), { intensity: 1.3, drumsActive: true });
    human.shieldCharges = 1;
    human.currentHP = human.maxHP / 2;
    assert.deepEqual(Game.prototype.getCombatMusicMix.call(game), { intensity: 1.3, drumsActive: true });
    human.shieldCharges = 0;
    assert.deepEqual(Game.prototype.getCombatMusicMix.call(game), { intensity: 1.45, drumsActive: true });

    Game.prototype.updateCombatMusic.call(game, COMBAT_MUSIC_HOLD_DURATION);
    assert.equal(game.combatMusicTimer, 0);
    assert.deepEqual(game.audio.mixes.at(-1), { intensity: 1, drumsActive: false });
    Game.prototype.refreshCombatMusicForDamage.call(game, { owner: npc }, human);
    assert.equal(game.combatMusicTimer, COMBAT_MUSIC_HOLD_DURATION);
});

test('low shields and HP remain baseline outside combat and Player 2 does not drive Local PvP music', () => {
    const player1 = readyPlayer(1);
    const player2 = readyPlayer(2);
    const npc = readyPlayer(3, true);
    player1.shieldCharges = 0;
    player1.currentHP = 1;
    const game = makeGame([player1, player2, npc]);

    assert.deepEqual(Game.prototype.getCombatMusicMix.call(game), { intensity: 1, drumsActive: false });
    assert.equal(Game.prototype.refreshCombatMusicForDamage.call(game, player2, npc), false);
    assert.equal(game.combatMusicTimer, 0);
});
