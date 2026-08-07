const DEFAULT_CELL_SIZE = 256;

function positiveModulo(value, modulus) {
    return ((value % modulus) + modulus) % modulus;
}

/**
 * Visits broad-phase circle pairs in the same stable order as a nested array pass.
 * The supplied entities remain authoritative; this hash is rebuilt as a derived
 * acceleration structure for the duration of the call.
 */
export function forEachNearbyCirclePair(entities, callback, {
    cellSize = DEFAULT_CELL_SIZE,
    wrap = false,
    width = 0,
    height = 0,
    getPartition = () => ''
} = {}) {
    if (!Array.isArray(entities) || entities.length < 2) return 0;

    const safeCellSize = Math.max(1, cellSize);
    const columns = wrap ? Math.max(1, Math.ceil(width / safeCellSize)) : 0;
    const rows = wrap ? Math.max(1, Math.ceil(height / safeCellSize)) : 0;
    const buckets = new Map();
    let maximumRadius = 0;

    const cellFor = entity => {
        const rawColumn = Math.floor(entity.x / safeCellSize);
        const rawRow = Math.floor(entity.y / safeCellSize);
        return {
            column: wrap ? positiveModulo(rawColumn, columns) : rawColumn,
            row: wrap ? positiveModulo(rawRow, rows) : rawRow
        };
    };
    const keyFor = (partition, column, row) => `${partition}\u0000${column},${row}`;

    for (let index = 0; index < entities.length; index++) {
        const entity = entities[index];
        if (!entity || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue;
        maximumRadius = Math.max(maximumRadius, Math.max(0, entity.radius || 0));
        const { column, row } = cellFor(entity);
        const key = keyFor(getPartition(entity), column, row);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(index);
        else buckets.set(key, [index]);
    }

    let candidateCount = 0;
    for (let firstIndex = 0; firstIndex < entities.length; firstIndex++) {
        const first = entities[firstIndex];
        if (!first || !Number.isFinite(first.x) || !Number.isFinite(first.y)) continue;
        const partition = getPartition(first);
        const { column, row } = cellFor(first);
        const searchRadius = Math.ceil((Math.max(0, first.radius || 0) + maximumRadius) / safeCellSize);
        const nearbyIndexes = new Set();

        for (let offsetX = -searchRadius; offsetX <= searchRadius; offsetX++) {
            const candidateColumn = wrap ? positiveModulo(column + offsetX, columns) : column + offsetX;
            for (let offsetY = -searchRadius; offsetY <= searchRadius; offsetY++) {
                const candidateRow = wrap ? positiveModulo(row + offsetY, rows) : row + offsetY;
                const bucket = buckets.get(keyFor(partition, candidateColumn, candidateRow));
                if (!bucket) continue;
                for (const secondIndex of bucket) {
                    if (secondIndex > firstIndex) nearbyIndexes.add(secondIndex);
                }
            }
        }

        for (const secondIndex of [...nearbyIndexes].sort((a, b) => a - b)) {
            candidateCount++;
            if (callback(first, entities[secondIndex], firstIndex, secondIndex) === false) break;
        }
    }
    return candidateCount;
}

