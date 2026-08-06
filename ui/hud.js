export class HUD {
    constructor() {
        this.maxSpeed = 800; // Updated max speed reference for meter
    }

    draw(ctx, players, asteroids, camera, isSplitScreen = false, swapUI = false, minimapContext = null) {
        if (!players || players.length === 0) return;

        // Check for Game Over / Win condition based on Event Horizon elimination
        const localPlayer = players[0];
        // Game Over logic removed for infinite loop
        
        const activePlayers = players.filter(p => !p.isDead);

        this.drawMinimap(ctx, players, asteroids, camera, swapUI, minimapContext);
        this.drawScoreboard(ctx, players, swapUI, minimapContext?.gameMode);
        
        if (isSplitScreen) {
            // Local PVP: Two meters, centered between boxes and center line
            // P1: Between Leaderboard (340) and Center (960) -> 650
            // P2: Between Center (960) and Minimap (1580) -> 1270
            this.drawPowerUpMeter(ctx, players[0], 650, 980, 3);
            this.drawPowerUpMeter(ctx, players[1], 1270, 980, 3);
            this.drawXPBar(ctx, players[0], 650, 980, 3);
            this.drawXPBar(ctx, players[1], 1270, 980, 3);
            this.drawLevelUpChoices(ctx, players[0], 650, 74);
            this.drawLevelUpChoices(ctx, players[1], 1270, 74);
            this.drawSpeedMeter(ctx, players[0], 650, 980, 3);
            this.drawSpeedMeter(ctx, players[1], 1270, 980, 3);
        } else {
            // Solo/Online: One meter, centered, laid out in a single row of 5
            this.drawPowerUpMeter(ctx, players[0], 1920 / 2, 980, 5);
            this.drawXPBar(ctx, players[0], 1920 / 2, 980, 5);
            this.drawLevelUpChoices(ctx, players[0], 1920 / 2, 74);
            this.drawSpeedMeter(ctx, players[0], 1920 / 2, 980, 5);
        }
    }

    drawLevelDisplay(ctx, player, x, y) {
        if (!player || player.isNPC || player.id > 2) return;
        const panelWidth = 100;
        const panelHeight = 46;
        ctx.save();
        ctx.font = 'bold 14px Orbitron';
        ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x, y, panelWidth, panelHeight);
        ctx.strokeStyle = player.color;
        ctx.strokeRect(x, y, panelWidth, panelHeight);
        ctx.fillStyle = player.color;
        ctx.fillText('LEVEL', x + 10, y + 22);
        ctx.fillStyle = '#fff';
        ctx.fillText(String(player.level), x + 67, y + 22);
        ctx.restore();
    }

    getLevelUpgradeBoxes(centerX, topY) {
        const width = 160;
        const height = 52;
        const gap = 16;
        const choices = ['projectile', 'speed', 'shield'];
        const rowWidth = choices.length * width + (choices.length - 1) * gap;
        return choices.map((choice, index) => ({
            choice,
            x: centerX - rowWidth / 2 + index * (width + gap),
            y: topY,
            width,
            height
        }));
    }

    drawLevelUpChoices(ctx, player, centerX, topY) {
        if (!player || player.isNPC || player.isDead || player.pendingLevelUps <= 0) return;
        ctx.save();
        ctx.textAlign = 'center';
        const boxes = this.getLevelUpgradeBoxes(centerX, topY);
        const prompts = ['1 / X', '2 / Y', '3 / B'];
        boxes.forEach((box, index) => {
            ctx.font = 'bold 12px Orbitron';
            ctx.fillStyle = '#fff';
            ctx.fillText(prompts[index], box.x + box.width / 2, box.y - 10);
            const selectable = player.canSelectLevelUpgrade(box.choice);
            ctx.fillStyle = selectable ? 'rgba(0, 0, 0, 0.82)' : 'rgba(70, 70, 70, 0.82)';
            ctx.strokeStyle = selectable ? player.color : '#777';
            ctx.lineWidth = 2;
            ctx.fillRect(box.x, box.y, box.width, box.height);
            ctx.strokeRect(box.x, box.y, box.width, box.height);
            ctx.font = 'bold 13px Orbitron';
            ctx.fillStyle = selectable ? '#fff' : '#999';
            const labels = ['PROJECTILE', 'SPEED', 'SHIELD RECHARGE'];
            ctx.fillText(labels[index], box.x + box.width / 2, box.y + 32);
        });
        ctx.font = 'bold 15px Orbitron';
        ctx.fillStyle = '#fff';
        ctx.fillText('Select a Level Up Bonus', centerX, boxes[0].y + boxes[0].height + 30);
        ctx.restore();
    }

    drawXPBar(ctx, player, centerX, startY, maxCols = 5) {
        if (!player || player.isDead || player.isNPC || player.id > 2 || player.isEventHorizon) return;
        const slotWidth = 90;
        const slotHeight = 35;
        const gap = 8;
        const rows = Math.ceil(5 / maxCols);
        const gridHeight = rows * slotHeight + (rows - 1) * gap;
        const width = maxCols * slotWidth + (maxCols - 1) * gap;
        const height = 8;
        const x = centerX - width / 2;
        const y = startY + gridHeight + 8;
        ctx.save();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#222';
        ctx.fillRect(x, y, width, height);
        ctx.fillStyle = player.color;
        ctx.fillRect(x, y, width * player.getXPProgressRatio(), height);
        ctx.restore();
    }

    getLevelUpgradeAt(x, y, players, isSplitScreen = false) {
        const player = players?.find(candidate => candidate.id === 1 && !candidate.isNPC && candidate.controlMode !== 'GAMEPAD');
        if (!player || player.isDead || player.pendingLevelUps <= 0) return null;
        const centerX = isSplitScreen ? 650 : 1920 / 2;
        const box = this.getLevelUpgradeBoxes(centerX, 74).find(candidate =>
            x >= candidate.x && x <= candidate.x + candidate.width
            && y >= candidate.y && y <= candidate.y + candidate.height
        );
        // A capped box still consumes the click so it cannot leak through as gun fire.
        return box ? { player, choice: box.choice } : null;
    }

    drawScoreboard(ctx, players, swapUI = false, gameMode = '') {
        const DESIGN_WIDTH = 1920;
        const DESIGN_HEIGHT = 1080;
        const WORLD_WIDTH = DESIGN_WIDTH * 9;
        const WORLD_HEIGHT = DESIGN_HEIGHT * 9;
        
        const mapWidth = 320;
        const mapHeight = mapWidth * (WORLD_HEIGHT / WORLD_WIDTH);
        const padding = 20;
        
        // Swapped Logic: Scoreboard at bottom-right if swapUI is true
        const x = swapUI ? (DESIGN_WIDTH - mapWidth - padding) : padding;
        const y = DESIGN_HEIGHT - mapHeight - padding;

        if (gameMode === 'EXPERIMENTAL' || gameMode === 'SOLO' || gameMode === 'ARENA') {
            this.drawPlayerStatsBox(ctx, players, x, y, mapWidth, mapHeight);
            return;
        }

        if (gameMode === 'ARCADE') {
            this.drawProgressionScoreboard(ctx, players, x, y, mapWidth, mapHeight);
            return;
        }

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x, y, mapWidth, mapHeight);
        
        // Border
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, mapWidth, mapHeight);

        // Header
        ctx.font = 'bold 12px Orbitron'; // Slightly smaller font to fit columns
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText('LEADERBOARD', x + 10, y + 25);
        ctx.textAlign = 'center';
        ctx.fillText('HIGH TIDE', x + mapWidth - 110, y + 25);
        ctx.textAlign = 'right';
        ctx.fillText('KILLS', x + mapWidth - 10, y + 25);
        
        // Separator
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 35);
        ctx.lineTo(x + mapWidth - 5, y + 35);
        ctx.stroke();

        // Sort players by Kills (score), highest first
        const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
        
        ctx.font = '12px Orbitron';
        sorted.forEach((p, i) => {
            if (i > 8) return; // Limit display to top 9
            const rowY = y + 55 + i * 20;
            ctx.fillStyle = p.color || '#fff';
            ctx.textAlign = 'left';
            
            const tier = (p.isDimensionX ? "DIMENSION X" : (p.isCyborg ? "CYBORG" : (p.isMartian ? "MARTIAN" : "EARTHLING")));
            const stars = "★".repeat(p.prestigeLevel || 0);
            const displayName = `${tier}${stars ? ' ' + stars : ''}`;
            
            ctx.fillText(displayName, x + 10, rowY);
            ctx.textAlign = 'center';
            ctx.fillText(p.highTide || 0, x + mapWidth - 110, rowY);
            ctx.textAlign = 'right';
            ctx.fillText(p.score || 0, x + mapWidth - 10, rowY);
        });
    }

    getPlayerFacingName(player, stats = null) {
        const rawName = String(stats?.name || player?.name || 'PLAYER');
        return rawName.replace(/\s+\d+$/, '');
    }

    drawPlayerStatsBox(ctx, players, x, y, width, height) {
        const player = players.find(candidate => !candidate.isNPC) || players[0];
        if (!player) return;

        const stats = player.getLeaderboardStats();
        const rows = [
            ['Level', stats.level],
            ['Hull Strength', stats.hullStrength],
            ['Shields', stats.shields],
            ['Projectile', stats.projectile],
            ['Shield Recharge', stats.shieldRecharge],
            ['Speed', stats.speed],
            ['Deaths', stats.deaths]
        ];

        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = player.color || '#00ffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);

        ctx.font = 'bold 14px Orbitron';
        ctx.fillStyle = player.color || '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(this.getPlayerFacingName(player, stats), x + width / 2, y + 24);

        ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.moveTo(x + 10, y + 34);
        ctx.lineTo(x + width - 10, y + 34);
        ctx.stroke();

        const labelX = x + 24;
        const valueX = x + width - 24;
        const firstRowY = y + 55;
        const rowGap = 17;
        ctx.font = '11px Orbitron';

        rows.forEach(([label, value], index) => {
            const rowY = firstRowY + index * rowGap;
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'left';
            ctx.fillText(label, labelX, rowY);
            ctx.fillStyle = player.color || '#fff';
            ctx.textAlign = 'right';
            ctx.fillText(String(value), valueX, rowY);
        });
        ctx.restore();
    }

    drawProgressionScoreboard(ctx, players, x, y, width, height) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x, y, width, height);
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, width, height);

        const columns = [
            { label: 'Name', key: 'name', width: 72, align: 'left' },
            { label: 'Level', key: 'level', width: 32 },
            { label: 'Hull Strength', key: 'hullStrength', width: 58 },
            { label: 'Shields', key: 'shields', width: 40 },
            { label: 'Projectile', key: 'projectile', width: 50 },
            { label: 'Speed', key: 'speed', width: 32 },
            { label: 'Deaths', key: 'deaths', width: 36 }
        ];
        let columnX = x;
        ctx.font = 'bold 7px Orbitron';
        ctx.fillStyle = '#fff';
        columns.forEach(column => {
            ctx.textAlign = column.align || 'center';
            ctx.fillText(column.label, columnX + (column.align === 'left' ? 5 : column.width / 2), y + 20);
            columnX += column.width;
        });

        ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 29);
        ctx.lineTo(x + width - 5, y + 29);
        ctx.stroke();

        ctx.font = '8px Orbitron';
        [...players].sort((a, b) => (b.level || 0) - (a.level || 0)).slice(0, 9).forEach((player, row) => {
            const stats = player.getLeaderboardStats();
            let valueX = x;
            ctx.fillStyle = player.color || '#fff';
            columns.forEach(column => {
                ctx.textAlign = column.align || 'center';
                let value = column.key === 'name'
                    ? this.getPlayerFacingName(player, stats)
                    : String(stats[column.key]);
                if (column.key === 'name' && value.length > 11) value = `${value.slice(0, 10)}…`;
                ctx.fillText(value, valueX + (column.align === 'left' ? 5 : column.width / 2), y + 45 + row * 14);
                valueX += column.width;
            });
        });
    }

    drawPowerUpMeter(ctx, player, centerX, startY, maxCols = 5) {
        if (!player || player.isEventHorizon) return; // Hide power-up meter for Event Horizon

        const slot3Name = 'Laser';
        const slots = [
            { name: player.slot1Type || 'Antigun', type: 'GUN' },
            { name: 'Missile', type: 'ADD-ON' },
            { name: slot3Name, type: player.isMartian ? 'UPGRADE' : 'GUN' },
            { name: 'Cyborg', type: 'WEAPON' },
            { name: 'Ghost', type: 'ADD-ON' }
        ];

        const slotWidth = 90;
        const slotHeight = 35;
        const gap = 8;
        
        // Calculate layout to center either a single row of 5 or two rows (3+2)
        const totalItems = slots.length;
        const rows = Math.ceil(totalItems / maxCols);
        
        slots.forEach((slot, i) => {
            const row = Math.floor(i / maxCols);
            const itemsInThisRow = (row === rows - 1) ? (totalItems - row * maxCols) : maxCols;
            
            const rowWidth = itemsInThisRow * slotWidth + (itemsInThisRow - 1) * gap;
            const startX = centerX - rowWidth / 2;
            
            const col = i % maxCols;
            const x = startX + col * (slotWidth + gap);
            const y = startY + row * (slotHeight + gap);

            const slotNumber = i + 1;
            const isCurrent = slotNumber === player.powerUpCapsules;
            const isSelectable = typeof player.canActivateCapsuleSlot !== 'function'
                || player.canActivateCapsuleSlot(slotNumber);

            // Box
            ctx.strokeStyle = isSelectable ? (isCurrent ? player.color : '#333') : '#555';
            ctx.lineWidth = isCurrent && isSelectable ? 3 : 1;
            ctx.fillStyle = !isSelectable
                ? 'rgba(55,55,55,0.72)'
                : (isCurrent ? (player.color + '33') : 'rgba(0,0,0,0.5)');
            ctx.strokeRect(x, y, slotWidth, slotHeight);
            ctx.fillRect(x, y, slotWidth, slotHeight);

            // Glow if current
            if (isCurrent && isSelectable) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = player.color;
                ctx.strokeRect(x, y, slotWidth, slotHeight);
                ctx.shadowBlur = 0;
            }

            // Text
            ctx.font = '9px Orbitron';
            ctx.fillStyle = !isSelectable ? '#777' : (isCurrent ? '#fff' : '#666');
            ctx.textAlign = 'center';
            ctx.fillText(`${i+1} ${slot.name}`, x + slotWidth / 2, y + 22);
            
            ctx.font = '7px Orbitron';
            ctx.fillStyle = !isSelectable ? '#555' : (isCurrent ? player.color : '#444');
            ctx.fillText(slot.type, x + slotWidth / 2, y + 10);
        });

        // Static capsule-selection helper appears only while a capsule bonus is available.
        const capsules = player.powerUpCapsules;
        const msg = player.powerUpError || (capsules > 0
            ? 'Press Spacebar / A to select a Capsule Bonus'
            : '');
        if (msg) {
            ctx.font = '14px Orbitron';
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.fillText(msg, centerX, startY - 15);
        }
    }

    // Draws a single player's speed meter directly beneath their power-up capsule grid.
    // "SPEED" label and the meter bands sit on the same line so the bands are never
    // cut off by the label wrapping above them (important for the narrower split-screen columns).
    drawSpeedMeter(ctx, player, centerX, startY, maxCols = 5) {
        if (!player || player.isDead || player.isNPC || player.id > 2 || player.isEventHorizon) return;

        const slotHeight = 35;
        const gap = 8;
        const slotCount = 5; // Matches the number of power-up capsule slots
        const rows = Math.ceil(slotCount / maxCols);
        const gridHeight = rows * slotHeight + (rows - 1) * gap;

        const speed = player.speed || 0;
        const speedPercent = Math.min(speed / this.maxSpeed, 1);
        const bandCount = 5;
        const activeBands = Math.ceil(speedPercent * bandCount);

        const height = 22;
        const bandGap = 4;
        const bandWidth = 20;
        const meterWidth = bandCount * bandWidth + (bandCount - 1) * bandGap;
        const labelGap = 12;

        ctx.font = '14px Orbitron';
        const labelText = 'SPEED';
        const labelWidth = ctx.measureText(labelText).width;

        // Lay out label + meter together, centered as one unit, on a single row
        const totalWidth = labelWidth + labelGap + meterWidth;
        const rowY = startY + gridHeight + 30;
        const labelX = centerX - totalWidth / 2;
        const meterX = labelX + labelWidth + labelGap;

        ctx.fillStyle = player.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, labelX, rowY + height / 2);
        ctx.textBaseline = 'alphabetic';

        for (let i = 0; i < bandCount; i++) {
            ctx.fillStyle = (i < activeBands) ? player.color : '#222';
            ctx.fillRect(meterX + i * (bandWidth + bandGap), rowY, bandWidth, height);
        }
    }

    showOverlay(ctx, title, sub) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fillRect(0, 0, 1920, 1080);
        
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.font = 'bold 80px Orbitron';
        ctx.fillText(title, 1920 / 2, 1080 / 2 - 20);
        
        ctx.font = '24px Orbitron';
        ctx.fillStyle = '#aaa';
        ctx.fillText(sub, 1920 / 2, 1080 / 2 + 40);
        
        ctx.font = '18px Orbitron';
        ctx.fillStyle = '#00ffff';
        ctx.fillText("Press ESC to Return to Menu", 1920 / 2, 1080 / 2 + 100);
        ctx.restore();
    }

    drawMinimap(ctx, players, asteroids, camera, swapUI = false, minimapContext = null) {
        const DESIGN_WIDTH = 1920;
        const DESIGN_HEIGHT = 1080;
        const WORLD_WIDTH = DESIGN_WIDTH * 9;
        const WORLD_HEIGHT = DESIGN_HEIGHT * 9;
        
        const mapWidth = 320;
        const mapHeight = mapWidth * (WORLD_HEIGHT / WORLD_WIDTH);
        const padding = 20;

        // Swapped Logic: Minimap at bottom-left if swapUI is true
        const x = swapUI ? padding : (DESIGN_WIDTH - mapWidth - padding);
        const y = DESIGN_HEIGHT - mapHeight - padding;
        const room = minimapContext?.usesRooms
            ? minimapContext.rooms?.find(candidate => candidate.id === minimapContext.owner?.roomId)
            : null;
        const usesRoom = Boolean(minimapContext?.usesRooms && room);
        const scale = mapWidth / WORLD_WIDTH;
        const positionOnMap = entity => usesRoom
            ? {
                x: x + ((entity.x - room.bounds.left) / room.width) * mapWidth,
                y: y + ((entity.y - room.bounds.top) / room.height) * mapHeight
            }
            : { x: x + entity.x * scale, y: y + entity.y * scale };
        const belongsOnMap = entity => !minimapContext?.usesRooms
            || (usesRoom && entity.roomId === minimapContext.owner.roomId);

        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x, y, mapWidth, mapHeight);
        
        // World Border
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, mapWidth, mapHeight);

        // 9x9 Grid lines
        ctx.strokeStyle = '#333';
        ctx.beginPath();
        for(let i = 1; i < 9; i++) {
            // Vertical
            ctx.moveTo(x + i * (mapWidth / 9), y);
            ctx.lineTo(x + i * (mapWidth / 9), y + mapHeight);
            // Horizontal
            ctx.moveTo(x, y + i * (mapHeight / 9));
            ctx.lineTo(x + mapWidth, y + i * (mapHeight / 9));
        }
        ctx.stroke();

        // Asteroids
        ctx.fillStyle = '#444';
        asteroids.forEach(a => {
            if (!belongsOnMap(a)) return;
            const point = positionOnMap(a);
            ctx.beginPath();
            ctx.arc(point.x, point.y, Math.max(1, a.radius * (usesRoom ? mapWidth / room.width : scale)), 0, Math.PI * 2);
            ctx.fill();
        });

        // Experimental hazards use their authoritative room assignment just like
        // other room-local minimap markers.
        if (usesRoom) {
            ctx.fillStyle = '#888';
            (minimapContext.hazards || []).forEach(hazard => {
                if (hazard.isDestroyed || !belongsOnMap(hazard)) return;
                const point = positionOnMap(hazard);
                ctx.beginPath();
                ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        // Players
        players.forEach(p => {
            if (p.isDead || p.isEliminated) return;
            if (!belongsOnMap(p)) return;
            const point = positionOnMap(p);
            ctx.fillStyle = p.color || (p.id === 1 ? '#00ffff' : '#ff00ff');
            if (p.id > 2 && !p.isNPC && !p.color) ctx.fillStyle = '#ffffff'; // Fallback for remote
            
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
            ctx.fill();
            
            // Highlight P1 dot slightly
            if (p.id === 1) {
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        });
    }
}
