const DEFAULT_CELL_SIZE = 256;

function positiveModulo(value, modulus) {
    return ((value % modulus) + modulus) % modulus;
}

/**
 * Disposable broad-phase index. Source arrays remain authoritative; this class
 * stores only stable array indexes and is rebuilt at the collision seam.
 */
export class CircleSpatialHash {
    constructor(entities, {
        cellSize = DEFAULT_CELL_SIZE,
        wrap = false,
        width = 0,
        height = 0,
        getPartition = () => ''
    } = {}) {
        this.entities = Array.isArray(entities) ? entities : [];
        this.cellSize = Math.max(1, cellSize);
        this.wrap = wrap;
        this.columns = wrap ? Math.max(1, Math.ceil(width / this.cellSize)) : 0;
        this.rows = wrap ? Math.max(1, Math.ceil(height / this.cellSize)) : 0;
        this.getPartition = getPartition;
        this.partitions = new Map();
        this.maximumRadius = 0;
        this.nearbyIndexes = [];
        this.visitStamps = new Uint32Array(this.entities.length);
        this.visitGeneration = 0;

        for (let index = 0; index < this.entities.length; index++) {
            const entity = this.entities[index];
            if (!entity || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue;
            this.maximumRadius = Math.max(this.maximumRadius, Math.max(0, entity.radius || 0));
            const { column, row } = this.getCell(entity);
            const partition = this.getPartition(entity);
            let columns = this.partitions.get(partition);
            if (!columns) {
                columns = new Map();
                this.partitions.set(partition, columns);
            }
            let rows = columns.get(column);
            if (!rows) {
                rows = new Map();
                columns.set(column, rows);
            }
            const bucket = rows.get(row);
            if (bucket) bucket.push(index);
            else rows.set(row, [index]);
        }
    }

    getCell(entity) {
        const rawColumn = Math.floor(entity.x / this.cellSize);
        const rawRow = Math.floor(entity.y / this.cellSize);
        return {
            column: this.wrap ? positiveModulo(rawColumn, this.columns) : rawColumn,
            row: this.wrap ? positiveModulo(rawRow, this.rows) : rawRow
        };
    }

    getBucket(partition, column, row) {
        return this.partitions.get(partition)?.get(column)?.get(row);
    }

    collectNearbyIndexes(entity, minimumIndex = 0) {
        const nearbyIndexes = this.nearbyIndexes;
        nearbyIndexes.length = 0;
        if (!entity || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return nearbyIndexes;
        const partition = this.getPartition(entity);
        const { column, row } = this.getCell(entity);
        const searchRadius = Math.ceil(
            (Math.max(0, entity.radius || 0) + this.maximumRadius) / this.cellSize
        );
        this.visitGeneration = (this.visitGeneration + 1) >>> 0;
        if (this.visitGeneration === 0) {
            this.visitStamps.fill(0);
            this.visitGeneration = 1;
        }

        for (let offsetX = -searchRadius; offsetX <= searchRadius; offsetX++) {
            const candidateColumn = this.wrap
                ? positiveModulo(column + offsetX, this.columns) : column + offsetX;
            for (let offsetY = -searchRadius; offsetY <= searchRadius; offsetY++) {
                const candidateRow = this.wrap
                    ? positiveModulo(row + offsetY, this.rows) : row + offsetY;
                const bucket = this.getBucket(partition, candidateColumn, candidateRow);
                if (!bucket) continue;
                for (const index of bucket) {
                    if (index < minimumIndex || this.visitStamps[index] === this.visitGeneration) continue;
                    this.visitStamps[index] = this.visitGeneration;
                    nearbyIndexes.push(index);
                }
            }
        }
        nearbyIndexes.sort((a, b) => a - b);
        return nearbyIndexes;
    }

    queryNearbyIndexes(entity, minimumIndex = 0) {
        return [...this.collectNearbyIndexes(entity, minimumIndex)];
    }

    forEachNearby(entity, callback, minimumIndex = 0, reverse = false) {
        const nearbyIndexes = this.collectNearbyIndexes(entity, minimumIndex);
        let visitedCount = 0;
        if (reverse) {
            for (let index = nearbyIndexes.length - 1; index >= 0; index--) {
                visitedCount++;
                if (callback(this.entities[nearbyIndexes[index]], nearbyIndexes[index]) === false) return visitedCount;
            }
        } else {
            for (let index = 0; index < nearbyIndexes.length; index++) {
                visitedCount++;
                if (callback(this.entities[nearbyIndexes[index]], nearbyIndexes[index]) === false) return visitedCount;
            }
        }
        return visitedCount;
    }

    queryNearby(entity) {
        const nearby = [];
        this.forEachNearby(entity, candidate => nearby.push(candidate));
        return nearby;
    }
}

/** Visits broad-phase pairs in the same stable order as a nested array pass. */
export function forEachNearbyCirclePair(entities, callback, options = {}) {
    if (!Array.isArray(entities) || entities.length < 2) return 0;
    const index = new CircleSpatialHash(entities, options);
    let candidateCount = 0;
    for (let firstIndex = 0; firstIndex < entities.length; firstIndex++) {
        const first = entities[firstIndex];
        index.forEachNearby(first, (_second, secondIndex) => {
            candidateCount++;
            return callback(first, entities[secondIndex], firstIndex, secondIndex);
        }, firstIndex + 1);
    }
    return candidateCount;
}
