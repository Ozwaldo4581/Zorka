import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseRandomPlayerColor, PLAYER_COLORS } from '../game.js';

test('Arcade player color selection uses the shared player palette', () => {
    assert.equal(chooseRandomPlayerColor(() => 0), PLAYER_COLORS[0]);
    assert.equal(chooseRandomPlayerColor(() => 0.999999), PLAYER_COLORS.at(-1));

    for (let index = 0; index < PLAYER_COLORS.length; index++) {
        const color = chooseRandomPlayerColor(() => (index + 0.5) / PLAYER_COLORS.length);
        assert.equal(color, PLAYER_COLORS[index]);
    }
});
