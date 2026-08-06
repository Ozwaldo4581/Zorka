import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DESIGN_HEIGHT,
    DESIGN_WIDTH,
    EXPERIMENTAL_ROOM_HEIGHT,
    EXPERIMENTAL_ROOM_WIDTH,
    WORLD_HEIGHT,
    WORLD_WIDTH,
    getSchoolDeskBackgroundPosition
} from '../game.js';
import {
    createExperimentalAreas,
    EXPERIMENTAL_AREA_TYPE,
    EXPERIMENTAL_HALLWAY_LENGTH,
    EXPERIMENTAL_HALLWAY_WIDTH,
    EXPERIMENTAL_ROOM_GRID_COLUMNS,
    EXPERIMENTAL_ROOM_GRID_ROWS,
    getSector9BBGImageRect
} from '../world/experimental_rooms.js';

test('Experimental ordinary rooms use a 2 x 2 grid without changing the standard arena', () => {
    assert.deepEqual(
        [EXPERIMENTAL_ROOM_GRID_COLUMNS, EXPERIMENTAL_ROOM_GRID_ROWS],
        [2, 2]
    );
    assert.deepEqual(
        [EXPERIMENTAL_ROOM_WIDTH, EXPERIMENTAL_ROOM_HEIGHT],
        [DESIGN_WIDTH * 2, DESIGN_HEIGHT * 2]
    );
    assert.deepEqual([WORLD_WIDTH, WORLD_HEIGHT], [DESIGN_WIDTH * 9, DESIGN_HEIGHT * 9]);

    const areas = createExperimentalAreas(EXPERIMENTAL_ROOM_WIDTH, EXPERIMENTAL_ROOM_HEIGHT);
    for (const room of areas.filter(area => area.areaType === EXPERIMENTAL_AREA_TYPE.ROOM)) {
        assert.deepEqual([room.width, room.height], [EXPERIMENTAL_ROOM_WIDTH, EXPERIMENTAL_ROOM_HEIGHT]);
    }
});

test('Experimental hallway dimensions remain independent of ordinary room dimensions', () => {
    const areas = createExperimentalAreas(EXPERIMENTAL_ROOM_WIDTH, EXPERIMENTAL_ROOM_HEIGHT);
    for (const hallway of areas.filter(area => area.areaType === EXPERIMENTAL_AREA_TYPE.HALLWAY)) {
        assert.deepEqual(
            [hallway.width, hallway.height].sort((a, b) => a - b),
            [EXPERIMENTAL_HALLWAY_WIDTH, EXPERIMENTAL_HALLWAY_LENGTH].sort((a, b) => a - b)
        );
        assert.equal(hallway.roomNumber, 0);
    }
});

test('Experimental room backgrounds preserve normalized room-local placement', () => {
    const oldRoom = { bounds: { left: 200, top: 300, right: 200 + DESIGN_WIDTH * 3, bottom: 300 + DESIGN_HEIGHT * 3 } };
    const newRoom = { bounds: { left: 200, top: 300, right: 200 + EXPERIMENTAL_ROOM_WIDTH, bottom: 300 + EXPERIMENTAL_ROOM_HEIGHT } };
    const normalize = (position, room) => ({
        x: (position.x - room.bounds.left) / (room.bounds.right - room.bounds.left),
        y: (position.y - room.bounds.top) / (room.bounds.bottom - room.bounds.top)
    });

    assert.deepEqual(
        normalize(getSchoolDeskBackgroundPosition(newRoom), newRoom),
        normalize(getSchoolDeskBackgroundPosition(oldRoom), oldRoom)
    );

    const sector9 = createExperimentalAreas(EXPERIMENTAL_ROOM_WIDTH, EXPERIMENTAL_ROOM_HEIGHT)
        .find(area => area.roomNumber === 9);
    const bbg = getSector9BBGImageRect(sector9);
    assert.deepEqual(
        normalize({ x: bbg.centerX, y: bbg.centerY }, sector9),
        { x: 0.5, y: 0.5 }
    );
});
