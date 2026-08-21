import test from 'node:test';
import assert from 'node:assert/strict';

import { CircleSpatialHash, forEachNearbyCirclePair } from '../world/spatial_hash.js';

function collectPairs(entities, options = {}) {
    const pairs = [];
    const candidateCount = forEachNearbyCirclePair(
        entities,
        (_first, _second, firstIndex, secondIndex) => pairs.push([firstIndex, secondIndex]),
        options
    );
    return { pairs, candidateCount };
}

test('spatial hash visits nearby pairs in stable nested-loop order', () => {
    const entities = [
        { x: 10, y: 10, radius: 8 },
        { x: 20, y: 10, radius: 8 },
        { x: 30, y: 10, radius: 8 },
        { x: 900, y: 900, radius: 8 }
    ];
    assert.deepEqual(collectPairs(entities, { cellSize: 64 }).pairs, [[0, 1], [0, 2], [1, 2]]);
});

test('spatial hash includes wrapped seam neighbors and isolates partitions', () => {
    const wrapped = [
        { x: 3, y: 50, radius: 8 },
        { x: 997, y: 50, radius: 8 }
    ];
    assert.deepEqual(collectPairs(wrapped, {
        cellSize: 100, wrap: true, width: 1000, height: 1000
    }).pairs, [[0, 1]]);

    const partitioned = [
        { x: 10, y: 10, radius: 8, roomId: 'one' },
        { x: 10, y: 10, radius: 8, roomId: 'two' }
    ];
    assert.deepEqual(collectPairs(partitioned, {
        cellSize: 64, getPartition: entity => entity.roomId
    }).pairs, []);
});

test('spatial hash prunes distant projectile candidates', () => {
    const entities = Array.from({ length: 1000 }, (_, index) => ({
        x: (index % 100) * 1000,
        y: Math.floor(index / 100) * 1000,
        radius: 8
    }));
    const { candidateCount } = collectPairs(entities, { cellSize: 128 });
    assert.equal(candidateCount, 0);
});

test('spatial hash retains every brute-force circle overlap', () => {
    let seed = 0x5eed1234;
    const random = () => {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 0x100000000;
    };
    const entities = Array.from({ length: 300 }, () => ({
        x: random() * 4096,
        y: random() * 2048,
        radius: 4 + random() * 60
    }));
    const visited = new Set(collectPairs(entities, {
        cellSize: 128, wrap: true, width: 4096, height: 2048
    }).pairs.map(pair => pair.join(':')));

    for (let first = 0; first < entities.length; first++) {
        for (let second = first + 1; second < entities.length; second++) {
            let dx = Math.abs(entities[first].x - entities[second].x);
            let dy = Math.abs(entities[first].y - entities[second].y);
            dx = Math.min(dx, 4096 - dx);
            dy = Math.min(dy, 2048 - dy);
            const radius = entities[first].radius + entities[second].radius;
            if (dx * dx + dy * dy < radius * radius) {
                assert.equal(visited.has(`${first}:${second}`), true, `missing ${first}:${second}`);
            }
        }
    }
});

test('reusable spatial hash returns nearby cross-collection candidates in source order', () => {
    const targets = [
        { x: 20, y: 20, radius: 40, roomId: 'one' },
        { x: 3000, y: 3000, radius: 40, roomId: 'one' },
        { x: 22, y: 20, radius: 40, roomId: 'two' },
        { x: 30, y: 20, radius: 80, roomId: 'one' }
    ];
    const index = new CircleSpatialHash(targets, {
        cellSize: 128,
        getPartition: entity => entity.roomId
    });
    const projectile = { x: 10, y: 20, radius: 8, roomId: 'one' };
    assert.deepEqual(index.queryNearby(projectile), [targets[0], targets[3]]);
});

test('allocation-light nearby iteration preserves direction, early exit, and wrapped deduplication', () => {
    const targets = [
        { x: 3, y: 50, radius: 60 },
        { x: 997, y: 50, radius: 60 },
        { x: 20, y: 50, radius: 60 }
    ];
    const index = new CircleSpatialHash(targets, {
        cellSize: 100, wrap: true, width: 1000, height: 1000
    });
    const query = { x: 5, y: 50, radius: 60 };
    const forward = [];
    assert.equal(index.forEachNearby(query, (_target, targetIndex) => forward.push(targetIndex)), 3);
    assert.deepEqual(forward, [0, 1, 2]);

    const reverse = [];
    assert.equal(index.forEachNearby(query, (_target, targetIndex) => {
        reverse.push(targetIndex);
        return false;
    }, 0, true), 1);
    assert.deepEqual(reverse, [2]);
});
