export class HUD {
    constructor() {
        this.maxSpeed = 800; // Updated max speed reference for meter
    }

    draw(ctx, players, asteroids, camera, isSplitScreen = false, swapUI = false) {
        if (!players || players.length === 0) return;

        // Check for Game Over / Win condition based on Event Horizon elimination
        const localPlayer = players[0];
        // Game Over logic removed for infinite loop
        
        const activePlayers = players.filter(p => !p.isDead);

        this.drawMinimap(ctx, players, asteroids, camera, swapUI);
        this.drawScoreboard(ctx, players, swapUI);
        
        if (isSplitScreen) {
            // Local PVP: Two meters, centered between boxes and center line
            // P1: Between Leaderboard (340) and Center (960) -> 650
            // P2: Between Center (960) and Minimap (1580) -> 1270
            this.drawPowerUpMeter(ctx, players[0], 650, 980, 3);
            this.drawPowerUpMeter(ctx, players[1], 1270, 980, 3);
            this.drawSpeedMeter(ctx, players[0], 650, 980, 3);
            this.drawSpeedMeter(ctx, players[1], 1270, 980, 3);
        } else {
            // Solo/Online: One meter, centered, laid out in a single row of 5
            this.drawPowerUpMeter(ctx, players[0], 1920 / 2, 980, 5);
            this.drawSpeedMeter(ctx, players[0], 1920 / 2, 980, 5);
        }
    }

    drawScoreboard(ctx, players, swapUI = false) {
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

    drawPowerUpMeter(ctx, player, centerX, startY, maxCols = 5) {
        if (!player || player.isEventHorizon) return; // Hide power-up meter for Event Horizon

        const slot3Name = player.isMartian ? 'Parallel' : 'Laser';
        const slots = [
            { name: player.slot1Type || 'Antigun', type: 'GUN' },
            { name: 'Missile', type: 'ADD-ON' },
            { name: slot3Name, type: player.isMartian ? 'UPGRADE' : 'GUN' },
            { name: 'Ghost', type: 'ADD-ON' },
            { name: 'Shield', type: 'MAX +1' }
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

            const isCurrent = (i + 1) === player.powerUpCapsules;

            // Box
            ctx.strokeStyle = isCurrent ? player.color : '#333';
            ctx.lineWidth = isCurrent ? 3 : 1;
            ctx.fillStyle = isCurrent ? (player.color + '33') : 'rgba(0,0,0,0.5)';
            ctx.strokeRect(x, y, slotWidth, slotHeight);
            ctx.fillRect(x, y, slotWidth, slotHeight);

            // Glow if current
            if (isCurrent) {
                ctx.shadowBlur = 15;
                ctx.shadowColor = player.color;
                ctx.strokeRect(x, y, slotWidth, slotHeight);
                ctx.shadowBlur = 0;
            }

            // Text
            ctx.font = '9px Orbitron';
            ctx.fillStyle = isCurrent ? '#fff' : '#666';
            ctx.textAlign = 'center';
            ctx.fillText(`${i+1} ${slot.name}`, x + slotWidth / 2, y + 22);
            
            ctx.font = '7px Orbitron';
            ctx.fillStyle = isCurrent ? player.color : '#444';
            ctx.fillText(slot.type, x + slotWidth / 2, y + 10);
        });

        // Contextual Text
        const capsules = player.powerUpCapsules;
        ctx.font = '14px Orbitron';
        ctx.fillStyle = player.color;
        ctx.textAlign = 'center';
        const msg = player.powerUpError || (capsules > 0 ? `Press (A) / (Spacebar) to Select ${slots[capsules-1].name} Power-Up!` : `${capsules} / 5 CAPSULES`);
        ctx.fillText(msg, centerX, startY - 15);
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

    drawMinimap(ctx, players, asteroids, camera, swapUI = false) {
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
        const scale = mapWidth / WORLD_WIDTH;

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
            ctx.beginPath();
            ctx.arc(x + a.x * scale, y + a.y * scale, Math.max(1, a.radius * scale), 0, Math.PI * 2);
            ctx.fill();
        });

        // Players
        players.forEach(p => {
            if (p.isDead || p.isEliminated) return;
            ctx.fillStyle = p.color || (p.id === 1 ? '#00ffff' : '#ff00ff');
            if (p.id > 2 && !p.isNPC && !p.color) ctx.fillStyle = '#ffffff'; // Fallback for remote
            
            ctx.beginPath();
            ctx.arc(x + p.x * scale, y + p.y * scale, 4, 0, Math.PI * 2);
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
