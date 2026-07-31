import test from 'node:test';
import assert from 'node:assert/strict';

import { Projectile } from '../entities/projectile.js';
import { Player } from '../entities/player.js';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../game.js';

function makePlayer(activeGun = 'Normal') {
    const player = new Player(100, 100);
    player.spawnImmunityTimer = 0;
    player.activeGun = activeGun;
    return player;
}

test('distance-limited projectile accumulates linear movement across wrapping and expires', () => {
    const projectile = new Projectile(WORLD_WIDTH - 10, WORLD_HEIGHT - 10, 30, 40);
    projectile.lifeSpan = 1000;
    projectile.maxTravelDistance = 100;

    projectile.update(1);
    assert.equal(projectile.distanceTraveled, 50);
    assert.ok(projectile.x >= 0 && projectile.x <= WORLD_WIDTH);
    assert.ok(projectile.y >= 0 && projectile.y <= WORLD_HEIGHT);

    projectile.update(1);
    assert.equal(projectile.distanceTraveled, 100);
    assert.ok(projectile.lifeSpan < 0);
});

test('high-delta movement uses displacement magnitude and expires after overshooting the cap', () => {
    const projectile = new Projectile(0, 0, 300, 400);
    projectile.lifeSpan = 1000;
    projectile.maxTravelDistance = WORLD_WIDTH;

    projectile.update(40);

    assert.equal(projectile.distanceTraveled, 20000);
    assert.ok(projectile.lifeSpan < 0);
});

test('uncapped and specialized projectiles do not accumulate ordinary travel distance', () => {
    const uncapped = new Projectile(0, 0, 30, 40);
    uncapped.update(1);
    assert.equal(uncapped.distanceTraveled, 0);
    assert.equal(uncapped.maxTravelDistance, null);

    for (const type of ['isMissile', 'isTentacle', 'isOrbital']) {
        const specialized = new Projectile(0, 0, 30, 40);
        specialized.maxTravelDistance = WORLD_WIDTH;
        specialized[type] = true;
        specialized.update(0.1);
        assert.equal(specialized.distanceTraveled, 0, `${type} should not use ordinary travel tracking`);
    }
});

test('Normal, Antigun, and both Double projectiles receive independent world-width caps', () => {
    const normalShots = makePlayer('Normal').fire();
    assert.equal(normalShots.length, 1);
    assert.equal(normalShots[0].maxTravelDistance, WORLD_WIDTH);

    const antigunShots = makePlayer('Antigun').fire();
    assert.equal(antigunShots.length, 2);
    antigunShots.forEach(shot => assert.equal(shot.maxTravelDistance, WORLD_WIDTH));
    assert.ok(antigunShots[0].vy * antigunShots[1].vy < 0);

    const doubleShots = makePlayer('Double').fire();
    assert.equal(doubleShots.length, 2);
    doubleShots.forEach(shot => assert.equal(shot.maxTravelDistance, WORLD_WIDTH));
    doubleShots[0].update(0.25);
    assert.notEqual(doubleShots[0].distanceTraveled, doubleShots[1].distanceTraveled);
});

test('Laser, missile, and transformation-specific projectiles remain uncapped', () => {
    const laser = makePlayer('Laser').fire()[0];
    assert.equal(laser.isLaser, true);
    assert.equal(laser.maxTravelDistance, null);

    const missileOwner = makePlayer('Normal');
    missileOwner.hasMissile = true;
    const missile = missileOwner.fire().find(shot => shot.isMissile);
    assert.equal(missile.maxTravelDistance, null);

    for (const transformation of ['isMartian', 'isCyborg', 'isDimensionX']) {
        const player = makePlayer('Normal');
        player[transformation] = true;
        player.fire().forEach(shot => assert.equal(
            shot.maxTravelDistance,
            null,
            `${transformation} projectile should remain uncapped`,
        ));
    }
});
