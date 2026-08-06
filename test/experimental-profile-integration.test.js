import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { Game, GAME_MODE, WORLD_HEIGHT, WORLD_WIDTH } from '../game.js';
import { Player } from '../entities/player.js';
import { createExperimentalAreas } from '../world/experimental_rooms.js';

test('profile menu supplies five slots, name entry, and Adventure launch routing', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    for (const id of [
        'experimental-profile-menu', 'experimental-profile-slots', 'experimental-profile-name',
        'btn-experimental-profile-create', 'btn-experimental-profile-cancel', 'btn-experimental-profile-back'
    ]) assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(html, /id="btn-experimental-start">ADVENTURE<\/button>/);
    const game = await readFile(new URL('../game.js', import.meta.url), 'utf8');
    assert.match(game, /btn-experimental-start'[\s\S]{0,100}showExperimentalProfileSelection/);
    assert.match(game, /level\.textContent = `Lvl \$\{summary\.level\}`/);
    assert.doesNotMatch(game, /level\.textContent = `Lvl \$\{summary\.level\}[^`]+Projectile/);
});

test('Player restores permanent profile counters and derived stats exactly once', () => {
    const player = new Player(0, 0);
    player.configureShields(3, 4);
    player.applyPersistentProgression({
        level: 4, totalXP: 750, pendingLevelUps: 1,
        projectileUpgradeCount: 1, speedUpgradeCount: 1, shieldRechargeUpgradeCount: 1, deaths: 0
    });
    assert.deepEqual(player.getPersistentProgressionSnapshot(), {
        level: 4, totalXP: 750, pendingLevelUps: 1,
        projectileUpgradeCount: 1, speedUpgradeCount: 1, shieldRechargeUpgradeCount: 1, deaths: 0
    });
    assert.equal(player.getSpeedMultiplier(), 1.1);
    assert.equal(player.getBurstRoundCount(), 4);
    assert.equal(player.maxShieldCharges, 7);
    assert.equal(player.maxHP, 14);

    player.applyPersistentProgression(player.getPersistentProgressionSnapshot());
    assert.equal(player.maxShieldCharges, 7, 'reapplying a snapshot does not duplicate Shield capacity');
});

test('fresh Experimental life keeps progression and clears transient state at Sector 1 center', () => {
    const rooms = createExperimentalAreas(WORLD_WIDTH, WORLD_HEIGHT);
    const room = rooms.find(area => area.roomNumber === 1);
    const player = new Player(1, 2);
    player.configureShields(3, 4);
    player.applyPersistentProgression({
        level: 3, totalXP: 600, pendingLevelUps: 0,
        projectileUpgradeCount: 1, speedUpgradeCount: 1, shieldRechargeUpgradeCount: 1, deaths: 0
    });
    Object.assign(player, {
        x: 99, y: 88, vx: 7, vy: 8, roomId: 'experimental-room-9', powerUpCapsules: 5,
        activeGun: 'Laser', hasMissile: true, lockedAimTarget: {}, ghosts: [{}], history: [{}]
    });
    player.resetTransientLifeState(3);
    player.x = (room.bounds.left + room.bounds.right) / 2;
    player.y = (room.bounds.top + room.bounds.bottom) / 2;
    player.roomId = room.id;
    assert.deepEqual([player.x, player.y, player.roomId], [WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 'experimental-room-1']);
    assert.deepEqual([player.vx, player.vy, player.powerUpCapsules, player.activeGun], [0, 0, 0, 'Normal']);
    assert.equal(player.lockedAimTarget, null);
    assert.equal(player.hasMissile, false);
    assert.deepEqual(player.ghosts, []);
    assert.deepEqual(player.history, []);
    assert.deepEqual([player.level, player.totalXP, player.maxShieldCharges], [3, 600, 6]);
});

test('autosave accepts only the selected Experimental human', () => {
    const human = new Player(0, 0);
    const npc = Object.assign(new Player(0, 0, 2), { isNPC: true });
    const writes = [];
    const game = {
        gameState: GAME_MODE.EXPERIMENTAL,
        players: [human, npc],
        selectedExperimentalProfileSlot: 2,
        experimentalProfiles: { updateProfile(slot, snapshot) { writes.push({ slot, snapshot }); } }
    };
    assert.equal(Game.prototype.saveExperimentalProfile.call(game, human), true);
    assert.equal(Game.prototype.saveExperimentalProfile.call(game, npc), false);
    human.pendingLevelUps = 1;
    human.onPersistentProgressionChanged = player => Game.prototype.saveExperimentalProfile.call(game, player);
    assert.equal(human.applyLevelUpgrade('projectile'), true);
    assert.equal(writes.length, 2);
    game.gameState = GAME_MODE.SOLO;
    assert.equal(Game.prototype.saveExperimentalProfile.call(game, human), false);
    assert.equal(writes.length, 2);
    assert.equal(writes[0].slot, 2);
});
