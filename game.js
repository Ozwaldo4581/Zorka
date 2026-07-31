import { Player } from './entities/player.js';
import { Asteroid } from './entities/asteroid.js';
import { SpaceDebris, Satellite } from './entities/hazards.js';
import { Projectile } from './entities/projectile.js';
import { Camera, DEFAULT_GAMEPLAY_ZOOM } from './camera.js';
import { HUD } from './ui/hud.js';
import { AudioManager } from './audio_manager.js';
import {
    checkCollision,
    nearestWrappedDisplacement,
    circleThickSegmentContact,
    correctWallPenetration,
    slideVelocity,
    reflectVelocity,
    sweptCircleSegmentIntersection,
    isLineBlockedByWalls
} from './physics.js';
import {
    createExperimentalAreas,
    createExperimentalDoors,
    EXPERIMENTAL_COLLISION_CATEGORY
} from './world/experimental_rooms.js';

export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;
export const WORLD_WIDTH = DESIGN_WIDTH * 9;
export const WORLD_HEIGHT = DESIGN_HEIGHT * 9;
export const GAME_MODE = Object.freeze({
    SOLO: 'SOLO',
    PVP: 'PVP',
    ARCADE: 'ARCADE',
    EXPERIMENTAL: 'EXPERIMENTAL'
});
export const PLAYER_COLORS = Object.freeze([
    '#00ffff', '#ff00ff', '#ffff00', '#ff0000',
    '#00ff00', '#0000ff', '#ff8800', '#8800ff'
]);

export function chooseRandomPlayerColor(random = Math.random) {
    return PLAYER_COLORS[Math.floor(random() * PLAYER_COLORS.length)];
}

const TARGET_TIE_PRIORITY = Object.freeze({
    player: 0,
    missile: 1,
    hazard: 2,
    asteroid: 3
});
const CONTROLLER_LOCK_ACQUIRE_THRESHOLD = 0.65;
const CONTROLLER_LOCK_RELEASE_THRESHOLD = 0.25;
const CONTROLLER_LOCK_MAX_DISTANCE = DESIGN_WIDTH;
export const MOUSE_AIM_LOCK_PADDING = 18;
export const CONTROLLER_AIM_LOCK_PADDING = 24;
const CONTROLLER_AIM_DEADZONE = 0.15;
const RAY_DISTANCE_TIE_EPSILON = 0.001;
export const SHIELD_RECHARGE_DELAYS = Object.freeze({
    0: null,
    1: 10,
    2: 7,
    3: 4,
    4: 1.5,
    5: 0.5
});
const DEBRIS_DENSITY_COUNTS = Object.freeze([0, 3, 7, 10, 16, 21]);
const SATELLITE_DENSITY_COUNTS = Object.freeze([0, 3, 5, 6, 9, 14]);

export function getArenaPopulationTargets(asteroidLevel, debrisLevel, satelliteLevel) {
    return {
        asteroids: Math.max(0, Math.min(5, asteroidLevel || 0)) * 80,
        debris: DEBRIS_DENSITY_COUNTS[debrisLevel] || 0,
        satellites: SATELLITE_DENSITY_COUNTS[satelliteLevel] || 0
    };
}

export function getShieldRechargeDelay(optionValue) {
    return SHIELD_RECHARGE_DELAYS[optionValue] ?? SHIELD_RECHARGE_DELAYS[3];
}

export class Game {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);

        this.gameState = 'SPLASH'; // Start with Splash
        this.splashPhase = 'FADE_IN';
        this.splashTimer = 0;
        this.splashAlpha = 0;
        this.titleInputLockTimer = 0;

        // Hide menu overlay initially
        document.getElementById('menu-overlay').classList.add('hidden');

        this.players = [];
        this.asteroids = [];
        this.hazards = [];
        this.projectiles = [];
        this.vfx = [];
        this.clearExperimentalState();

        this.camera = new Camera();
        this.hud = new HUD();
        this.audio = new AudioManager();
        // Offline build: multiplayer is intentionally deferred.  Keeping this
        // null makes it clear that no Supabase/network code is required to
        // launch or play the local game.
        this.network = null;

        this.lastTime = 0;
        this.keys = {};
        this.mouse = { x: 0, y: 0, clicked: false, m2Held: false, m2Pressed: false, m2Released: false };
        this.domCursor = document.getElementById('custom-cursor');

        // Controller Menu Navigation
        this.menuIndex = 0;
        this.menuCooldown = 0;
        this.currentMenuId = 'main-menu';

        // In-game floating pause menu (does not stop simulation)
        this.isPauseMenuOpen = false;
        this.startBtnWasPressed = false;
        this.pauseMenuIndex = 0;
        this.pauseMenuCooldown = 0;
        this.activeModal = null;
        this.focusBeforeModal = null;
        
        // P1 Control Mode: 'KEYBOARD' or 'GAMEPAD' (defaults to GAMEPAD across all modes)
        this.p1ControlMode = 'GAMEPAD'; 
        this.swapUI = false;
        this.transformationKills = 20;
        this.cursorVisible = true;
        
        // New Arena Options
        this.asteroidDensityLevel = 1; // Default to 3 (scaled 0-5)
        this.debrisDensityLevel = 3; 
        this.satelliteDensityLevel = 3;
        this.startingShieldCharges = 3;
        this.shieldRechargeRate = 3;
        this.botAggressionLevel = 0; // 0 = Random, 1-5 = Fixed
        this.hardcoreMode = true;
        this.arcadeWaveSize = 0;
        this.arcadeSustainEight = false;
        this.nextArcadeReplacementLevel = 9;
        this.arcadeGameOver = false;
        this.arcadeResult = null;
        this.nextArcadeNpcId = 2;
        this.selectedCursorStyle = 0; // Default crosshair
        this.optionsOpenedFromPause = false;

        this.generateStars();
        this.init();
        this.bindEvents();
    }

    generateStars() {
        this.stars = [];
        const starCount = 400; // Minimal decoration
        for (let i = 0; i < starCount; i++) {
            this.stars.push({
                x: Math.random() * WORLD_WIDTH,
                y: Math.random() * WORLD_HEIGHT,
                size: Math.random() * 2,
                opacity: 0.2 + Math.random() * 0.5
            });
        }
    }

    configurePlayerShields(player) {
        player.configureShields(
            this.startingShieldCharges,
            getShieldRechargeDelay(this.shieldRechargeRate)
        );
    }

    async init() {
        this.resize();
        await this.loadAssets();
        this.updateCursorVisuals(); // Initialize cursor DOM
        // Start in splash, returnToMenu will be called later
        // this.returnToMenu(); 
    }

    async loadAssets() {
        this.assets = {
            ship: await this.loadImage('assets/ShipNeonWhite.png'),
            ufo: await this.loadImage('assets/1000008891.png'),
            cyborg: await this.loadImage('assets/cyborg_ship.webp'),
            dimensionX: await this.loadImage('assets/dimension_x_monster.webp'),
            eventHorizon: await this.loadImage('assets/event_horizon_horror.webp'),
            asteroid: await this.loadImage('assets/asteroid.webp'),
            spaceDebris: await this.loadImage('assets/space_debris.webp'),
            satellite: await this.loadImage('assets/broken_satellite.webp'),
            projectile: await this.loadImage('assets/projectile.webp'),
            background: await this.loadImage('assets/space_background.webp'),
            explosion: await this.loadImage('assets/explosion_vfx.webp')
        };
    }

    loadImage(src) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => {
                console.warn(`Failed to load asset: ${src}. Game will attempt to continue.`);
                resolve(null);
            };
            img.src = src;
        });
    }

    spawnPlayers(mode, customShipCount, onlineRoomConfig) {
        this.gameState = mode;
        this.arcadeWaveSize = 0;
        this.arcadeSustainEight = false;
        this.nextArcadeReplacementLevel = 9;
        this.resetMouseLockInput();
        // Keep space_ambient playing
        this.players = [];

        const isSolo = mode === 'SOLO';
        const isPvP = mode === 'PVP';
        const isOnline = mode === 'ONLINE';

        if (isOnline && onlineRoomConfig) {
            this.transformationKills = onlineRoomConfig.transKills || 20;
        } else {
            this.transformationKills = 20;
        }

        const colors = [...PLAYER_COLORS];
        
        // Shuffle colors
        for (let i = colors.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [colors[i], colors[j]] = [colors[j], colors[i]];
        }

        const botNames = ["SPIKE", "STARWOOD", "TIDRUNNER", "BIGJOE123", "ZORKA", "VECTOR", "BLAST", "NEON", "CYBER", "VOID"];
        // Shuffle bot names
        for (let i = botNames.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [botNames[i], botNames[j]] = [botNames[j], botNames[i]];
        }

        // Generate grid spawn positions (9x9 grid)
        const sectors = [];
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                sectors.push({
                    x: col * DESIGN_WIDTH + DESIGN_WIDTH / 2,
                    y: row * DESIGN_HEIGHT + DESIGN_HEIGHT / 2
                });
            }
        }
        // Shuffle sectors to randomize spawn order
        for (let i = sectors.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sectors[i], sectors[j]] = [sectors[j], sectors[i]];
        }

        if (isSolo) {
            const shipCount = customShipCount || 1;
            // Player 1
            const spawn1 = sectors.pop();
            const p1 = new Player(spawn1.x, spawn1.y, 1, colors[0]);
            this.configurePlayerShields(p1);
            // Name input removed from HTML, just use P1
            p1.name = "PLAYER 1";
            p1.controlMode = this.p1ControlMode;
            this.players.push(p1);

            // NPCs for Solo Battle
            if (shipCount > 1) {
                for (let i = 1; i < shipCount; i++) {
                    const spawn = sectors.pop() || { x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT };
                    const p = new Player(spawn.x, spawn.y, i + 1, colors[i % colors.length]);
                    this.configurePlayerShields(p);
                    p.isNPC = true;
                    p.name = botNames[i % botNames.length] || `BOT ${p.id}`;
                    
                    if (this.botAggressionLevel > 0) {
                        p.aggressionLevel = this.botAggressionLevel;
                        p.rollAccuracy();
                    } else {
                        p.rollAggression();
                    }
                    this.players.push(p);
                }
            } else {
                // Flight Practice: Spawn 7 non-moving dummies
                for (let i = 0; i < 7; i++) {
                    const spawn = sectors.pop() || { x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT };
                    const p = new Player(spawn.x, spawn.y, i + 2, colors[(i + 1) % colors.length]);
                    this.configurePlayerShields(p);
                    p.isNPC = true;
                    p.isDummy = true; // New property to prevent movement/attack
                    p.name = `DUMMY ${i + 1}`;
                    this.players.push(p);
                }
            }
        } else if (isPvP) {
            const shipCount = customShipCount || 2;
            const s1 = sectors.pop();
            const s2 = sectors.pop();
            const p1 = new Player(s1.x, s1.y, 1, colors[0]);
            const p2 = new Player(s2.x, s2.y, 2, colors[1]);
            this.configurePlayerShields(p1);
            this.configurePlayerShields(p2);
            p1.name = "PLAYER 1";
            p2.name = "PLAYER 2";
            p1.controlMode = this.p1ControlMode;
            p2.controlMode = 'GAMEPAD'; // P2 is always gamepad
            this.players.push(p1, p2);

            // Fill remainder with bots
            for (let i = 2; i < shipCount; i++) {
                const spawn = sectors.pop() || { x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT };
                const p = new Player(spawn.x, spawn.y, i + 1, colors[i % colors.length]);
                this.configurePlayerShields(p);
                p.isNPC = true;
                p.name = botNames[i % botNames.length] || `BOT ${p.id}`;
                
                if (this.botAggressionLevel > 0) {
                    p.aggressionLevel = this.botAggressionLevel;
                    p.rollAccuracy();
                } else {
                    p.rollAggression();
                }
                this.players.push(p);
            }
        } else if (isOnline) {
            const spawn = sectors[0]; // Just use one for online, others will be remote
            const p1 = new Player(spawn.x, spawn.y, 1, colors[0]);
            this.configurePlayerShields(p1);
            p1.name = "PILOT";
            p1.controlMode = this.p1ControlMode;
            this.players = [p1];
        }
    }

    isHardcoreActive() {
        return this.gameState === 'ARCADE' || this.hardcoreMode;
    }

    refreshControlOptionButtons() {
        const keyboardButton = document.getElementById('main-keyboard-btn');
        const gamepadButton = document.getElementById('main-gamepad-btn');
        const keyboardSelected = this.p1ControlMode === 'KEYBOARD';

        if (keyboardButton) {
            keyboardButton.classList.toggle('selected', keyboardSelected);
            keyboardButton.setAttribute('aria-pressed', String(keyboardSelected));
        }
        if (gamepadButton) {
            gamepadButton.classList.toggle('selected', !keyboardSelected);
            gamepadButton.setAttribute('aria-pressed', String(!keyboardSelected));
        }
    }

    areTransformationsEnabled() {
        return this.gameState !== 'ARCADE';
    }

    findSafePlayerSpawn() {
        let bestSpawn = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
        let bestDistance = -1;
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                const candidate = {
                    x: col * DESIGN_WIDTH + DESIGN_WIDTH / 2,
                    y: row * DESIGN_HEIGHT + DESIGN_HEIGHT / 2
                };
                const blockers = [...this.players.filter(player => !player.isDead && !player.isEliminated), ...this.asteroids, ...this.hazards];
                const minDistance = blockers.reduce((closest, blocker) =>
                    Math.min(closest, Math.hypot(blocker.x - candidate.x, blocker.y - candidate.y)), Infinity);
                if (minDistance > bestDistance) {
                    bestDistance = minDistance;
                    bestSpawn = candidate;
                }
            }
        }
        return bestSpawn;
    }

    spawnArcadeNPC(targetLevel = 0) {
        const spawn = this.findSafePlayerSpawn();
        const id = this.nextArcadeNpcId++;
        const colors = ['#ff00ff', '#ffff00', '#ff0000', '#00ff00', '#0000ff', '#ff8800', '#8800ff', '#ffffff'];
        const player = new Player(spawn.x, spawn.y, id, colors[(id - 2) % colors.length]);
        this.configurePlayerShields(player);
        player.isNPC = true;
        player.name = `ARCADE BOT ${id - 1}`;
        if (this.botAggressionLevel > 0) {
            player.aggressionLevel = this.botAggressionLevel;
            player.rollAccuracy();
        } else {
            player.rollAggression();
        }
        player.initializeNPCLevel(targetLevel);
        this.players.push(player);
        return player;
    }

    spawnArcadeWave(count, targetLevel) {
        const spawned = [];
        for (let index = 0; index < count; index++) {
            const player = this.spawnArcadeNPC(targetLevel);
            if (player) spawned.push(player);
        }
        return spawned;
    }

    startArcadeMode() {
        this.clearExperimentalState();
        this.closePauseMenu();
        this.hideArcadeGameOver();
        document.getElementById('menu-overlay').classList.add('hidden');
        document.getElementById('main-options-popup').classList.add('hidden');
        this.gameState = 'ARCADE';
        this.arcadeWaveSize = 1;
        this.arcadeSustainEight = false;
        this.nextArcadeReplacementLevel = 9;
        this.arcadeGameOver = false;
        this.arcadeResult = null;
        this.nextArcadeNpcId = 2;
        this.players = [];
        this.projectiles = [];
        this.vfx = [];
        const spawn = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
        const player = new Player(spawn.x, spawn.y, 1, chooseRandomPlayerColor());
        this.configurePlayerShields(player);
        player.name = 'PLAYER 1';
        player.controlMode = this.p1ControlMode;
        this.players.push(player);
        this.spawnInitialAsteroids();
        this.spawnArcadeWave(1, 1);
        this.camera.zoom = DEFAULT_GAMEPLAY_ZOOM;
        this.camera.follow(player);
        this.audio.stopBGM();
        this.resetMouseLockInput();
    }

    reconcileArcadeNPCs() {
        if (this.gameState !== 'ARCADE' || this.arcadeGameOver) return;
        const livingCount = this.players.filter(player => player.isNPC && !player.isDead && !player.isEliminated).length;
        if (this.arcadeSustainEight) {
            const deficit = Math.max(0, 8 - livingCount);
            for (let index = 0; index < deficit; index++) {
                const replacement = this.spawnArcadeNPC(this.nextArcadeReplacementLevel);
                if (replacement && this.players.includes(replacement)) this.nextArcadeReplacementLevel++;
            }
        } else if (livingCount === 0) {
            this.arcadeWaveSize = Math.min(8, this.arcadeWaveSize + 1);
            this.arcadeSustainEight = this.arcadeWaveSize === 8;
            this.spawnArcadeWave(this.arcadeWaveSize, this.arcadeWaveSize);
        }
    }

    showArcadeGameOver(result) {
        this.arcadeResult = result;
        this.arcadeGameOver = true;
        this.closePauseMenu();
        document.getElementById('arcade-final-level').textContent = String(result.finalLevel);
        document.getElementById('arcade-final-xp').textContent = String(result.totalXP);
        document.getElementById('arcade-final-capsules').textContent = String(result.totalCapsulesGained);
        const overlay = document.getElementById('arcade-game-over');
        overlay.classList.remove('hidden');
        this.setInitialMenuFocus(overlay);
        this.menuCooldown = 0.3;
        this.lastActiveMenuId = overlay.id;
    }

    hideArcadeGameOver() {
        document.getElementById('arcade-game-over').classList.add('hidden');
    }

    spawnRemotePlayer(x, y, networkId, color = '#00ffff') {
        const p = new Player(x, y, 3, color);
        p.networkId = networkId;
        
        // Apply the Arena shield capacity and reset recharge progress.
        this.configurePlayerShields(p);

        this.players.push(p);
        return p;
    }

    spawnRemoteProjectiles(data) {
        if (!data?.ownerId || !Array.isArray(data.shots)) return;

        let owner = this.players.find(
            (player) => player.networkId === data.ownerId,
        );

        // A fire Broadcast can arrive before the first movement Broadcast.
        // Create the remote ship instead of dropping the projectile.
        if (!owner) {
            const firstShot = data.shots[0];
            owner = this.spawnRemotePlayer(
                firstShot?.x || WORLD_WIDTH / 2,
                firstShot?.y || WORLD_HEIGHT / 2,
                data.ownerId,
                data.ownerColor,
            );
        }

        const elapsedSeconds = Math.max(
            0,
            Math.min(0.25, (Date.now() - data.firedAt) / 1000),
        );

        for (const shot of data.shots) {
            const projectile = new Projectile(
                shot.x,
                shot.y,
                shot.vx,
                shot.vy,
                shot.color || owner.color,
            );

            Object.assign(projectile, {
                radius: shot.radius,
                lifeSpan: shot.lifeSpan,
                canWrap: shot.canWrap,
                isLaser: shot.isLaser,
                isGhost: shot.isGhost,
                isMissile: shot.isMissile,
                isDecoy: shot.isDecoy,
                isTentacle: shot.isTentacle,
                isSkinnyMissile: shot.isSkinnyMissile,
                isOrbital: shot.isOrbital,
                orbitalAngle: shot.orbitalAngle,
                orbitalDistance: shot.orbitalDistance,
                aoeRadius: shot.aoeRadius,
                tentacleLength: shot.tentacleLength,
                maxTentacleLength: shot.maxTentacleLength,
                tentaclePhase: shot.tentaclePhase,
                rotation: shot.rotation,
                owner,
            });

            if (!projectile.isMissile && !projectile.isTentacle && !projectile.isOrbital) {
                projectile.x += projectile.vx * elapsedSeconds;
                projectile.y += projectile.vy * elapsedSeconds;
                projectile.lifeSpan -= elapsedSeconds;
            }

            if (projectile.lifeSpan > 0 || projectile.isMissile || projectile.isTentacle) {
                this.projectiles.push(projectile);
            }
        }

        const firstShot = data.shots[0];
        if (firstShot) {
            this.audio.playSpatial(
                'laser_fire',
                firstShot.x,
                firstShot.y,
                this.getActiveCameras(),
                WORLD_WIDTH,
                WORLD_HEIGHT,
            );
        }
    }

    spawnInitialAsteroids() {
        this.asteroids = [];
        this.hazards = [];
        const targets = getArenaPopulationTargets(
            this.asteroidDensityLevel,
            this.debrisDensityLevel,
            this.satelliteDensityLevel
        );
        for (let i = 0; i < targets.asteroids; i++) {
            this.spawnAsteroid('large');
        }

        for (let i = 0; i < targets.debris; i++) {
            this.spawnSpaceDebris();
        }

        for (let i = 0; i < targets.satellites; i++) {
            this.spawnSatellite();
        }
    }

    spawnSpaceDebris(roomId = null) {
        const experimentalRoomId = roomId || this.experimentalRooms?.[0]?.id;
        const spawn = this.gameState === GAME_MODE.EXPERIMENTAL
            ? this.findExperimentalSpawn(45, this.players, experimentalRoomId)
            : { x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT };
        const debris = new SpaceDebris(spawn.x, spawn.y);
        if (this.gameState === GAME_MODE.EXPERIMENTAL) debris.roomId = experimentalRoomId;
        this.hazards.push(debris);
    }

    spawnSatellite(roomId = null) {
        const experimentalRoomId = roomId || this.experimentalRooms?.[0]?.id;
        const spawn = this.gameState === GAME_MODE.EXPERIMENTAL
            ? this.findExperimentalSpawn(32, this.players, experimentalRoomId)
            : { x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT };
        const satellite = new Satellite(spawn.x, spawn.y);
        if (this.gameState === GAME_MODE.EXPERIMENTAL) satellite.roomId = experimentalRoomId;
        this.hazards.push(satellite);
    }

    spawnAsteroid(size, x, y, roomId = null) {
        let attempts = 0;
        const maxAttempts = 50;
        const experimentalRoomId = roomId || this.experimentalRooms?.[0]?.id;
        
        if (x === undefined || y === undefined) {
            if (this.gameState === GAME_MODE.EXPERIMENTAL) {
                const spawn = this.findExperimentalSpawn(size === 'large' ? 80 : size === 'medium' ? 45 : 20, this.players, experimentalRoomId);
                x = spawn.x;
                y = spawn.y;
            } else {
                while (attempts < maxAttempts) {
                    x = Math.random() * WORLD_WIDTH;
                    y = Math.random() * WORLD_HEIGHT;
                    let tooClose = false;
                    // Don't spawn too close to players
                    for (let p of this.players) {
                        const dist = Math.hypot(x - p.x, y - p.y);
                        if (dist < 400) {
                            tooClose = true;
                            break;
                        }
                    }
                    if (!tooClose) break;
                    attempts++;
                }
            }
        }
        
        const asteroid = new Asteroid(x, y, size);
        if (this.gameState === GAME_MODE.EXPERIMENTAL) asteroid.roomId = experimentalRoomId;
        this.asteroids.push(asteroid);
    }

    bindEvents() {
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('keydown', (e) => {
            this.audio.unlock();
            if (this.gameState === 'SPLASH') {
                this.advanceFromSplash();
                return;
            }
            this.keys[e.code] = true;
            if (e.code === 'Escape' && this.activeModal === 'quit') {
                this.closeQuitConfirmation();
                return;
            }
            if (e.code === 'Escape' && this.isInGameplayState()) {
                this.togglePauseMenu();
            }
        });
        window.addEventListener('keyup', (e) => this.keys[e.code] = false);
        window.addEventListener('mousemove', (e) => {
            this.cursorVisible = true;
            const rect = this.canvas.getBoundingClientRect();
            this.mouse.x = (e.clientX - rect.left) / this.scale;
            this.mouse.y = (e.clientY - rect.top) / this.scale;

            if (this.domCursor) {
                this.domCursor.style.left = `${e.clientX}px`;
                this.domCursor.style.top = `${e.clientY}px`;
                this.domCursor.style.display = this.shouldHideMouseCursor() ? 'none' : 'block';
            }
        });
        window.addEventListener('mousedown', (e) => {
            if (this.gameState === 'SPLASH') {
                this.advanceFromSplash();
                return;
            }
            if (e.button === 0) {
                const rect = this.canvas.getBoundingClientRect();
                this.mouse.x = (e.clientX - rect.left) / this.scale;
                this.mouse.y = (e.clientY - rect.top) / this.scale;
                const selection = this.isInGameplayState() && !this.isPauseMenuOpen
                    ? this.hud.getLevelUpgradeAt(this.mouse.x, this.mouse.y, this.players, this.gameState === 'PVP')
                    : null;
                if (selection) selection.player.applyLevelUpgrade(selection.choice);
                else this.mouse.clicked = true;
            }
            if (e.button === 2 && !this.mouse.m2Held && e.target === this.canvas && this.isInGameplayState()
                && !this.isPauseMenuOpen && this.players[0]?.controlMode === 'KEYBOARD') {
                this.mouse.m2Held = true;
                this.mouse.m2Pressed = true;
            }
            this.audio.unlock();
        });
        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) this.mouse.clicked = false;
            if (e.button === 2) {
                const wasHeld = this.mouse.m2Held;
                this.mouse.m2Held = false;
                this.mouse.m2Released = wasHeld;
            }
        });
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        window.addEventListener('blur', () => this.resetLockInputs());
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.resetLockInputs();
        });

        // Menu buttons
        document.getElementById('btn-arcade').addEventListener('click', () => {
            this.startArcadeMode();
        });

        document.getElementById('btn-solo-open').addEventListener('click', () => {
            this.pendingMode = 'SOLO';
            document.getElementById('main-menu').classList.add('hidden');
            document.getElementById('solo-menu').classList.remove('hidden');
            document.getElementById('controls-selection').classList.remove('hidden');
            document.getElementById('p2-control-line').classList.add('hidden');
            document.getElementById('transformation-setting').classList.add('hidden');
            
            // Show all bot buttons for Solo
            document.querySelectorAll('.bot-count-btn').forEach(btn => btn.classList.remove('hidden'));
            
            this.updateGamepadStatus();
            
            // Default Solo Arena to 4 enemy bots.
            this.selectedBotCount = 4;

            document.querySelectorAll('.bot-count-btn').forEach(btn => {
                btn.classList.remove('selected');
            });

            const defaultBotButton = document.querySelector(
                '.bot-count-btn[data-bot-count="4"]'
            );

            if (defaultBotButton) {
            defaultBotButton.classList.add('selected');
            }

            this.updateSoloMockLobby(this.selectedBotCount);
        });

        document.getElementById('btn-pvp').addEventListener('click', () => {
            this.pendingMode = 'PVP';
            document.getElementById('main-menu').classList.add('hidden');
            document.getElementById('solo-menu').classList.remove('hidden');
            document.getElementById('controls-selection').classList.remove('hidden');
            document.getElementById('p2-control-line').classList.remove('hidden');
            document.getElementById('transformation-setting').classList.add('hidden');
            
            // Re-purpose the Solo menu for PVP
            document.getElementById('arena-bot-label').innerText = 'SELECT NUMBER OF ENEMY BOTS IN THE ARENA';
            
            // Hide buttons 7 and 8 for PVP (max 6 bots)
            document.querySelectorAll('.bot-count-btn').forEach(btn => {
                const count = parseInt(btn.getAttribute('data-bot-count'));
                if (count > 6) btn.classList.add('hidden');
                else btn.classList.remove('hidden');
            });

            this.updateGamepadStatus();
            
            this.selectedBotCount = 0;
            document.querySelectorAll('.bot-count-btn').forEach(b => b.classList.remove('selected'));
            this.updateSoloMockLobby(0);
        });

        document.getElementById('btn-experimental-open').addEventListener('click', () => {
            document.getElementById('main-menu').classList.add('hidden');
            document.getElementById('experimental-menu').classList.remove('hidden');
        });

        document.getElementById('btn-experimental-start').addEventListener('click', () => {
            this.startExperimentalMode();
        });

        document.getElementById('btn-experimental-back').addEventListener('click', () => {
            document.getElementById('experimental-menu').classList.add('hidden');
            document.getElementById('main-menu').classList.remove('hidden');
        });

        document.getElementById('btn-solo-back').addEventListener('click', () => {
            document.getElementById('solo-menu').classList.add('hidden');
            document.getElementById('controls-selection').classList.add('hidden');
            document.getElementById('main-menu').classList.remove('hidden');
            
            // The shared setup screen intentionally has no title; its selected
            // arena card identifies the current mode instead.
        });

        // General Options handlers
        const refreshAudioOptionButtons = () => {
            const musicLevel = this.audio.getMusicVolumeLevel();
            const sfxLevel = this.audio.getSfxVolumeLevel();
            document.querySelectorAll('.music-volume-btn').forEach(btn => {
                btn.classList.toggle('selected', parseInt(btn.dataset.musicLevel) === musicLevel);
            });
            document.querySelectorAll('.sfx-volume-btn').forEach(btn => {
                btn.classList.toggle('selected', parseInt(btn.dataset.sfxLevel) === sfxLevel);
            });
        };

        const refreshHardcoreOptionButtons = () => {
            document.querySelectorAll('.hardcore-btn').forEach(btn => {
                const enabled = btn.dataset.hardcore === 'true';
                btn.classList.toggle('selected', enabled === this.hardcoreMode);
                btn.setAttribute('aria-pressed', String(enabled === this.hardcoreMode));
            });
        };

        document.getElementById('btn-main-options-open').addEventListener('click', () => {
            this.optionsOpenedFromPause = false;

            const popup = document.getElementById('main-options-popup');
            popup.classList.remove('hidden');
            popup.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
            refreshAudioOptionButtons();
            this.refreshControlOptionButtons();

            document.querySelectorAll('.cursor-option-btn').forEach(btn => {
                btn.classList.toggle(
                    'selected',
                    parseInt(btn.dataset.cursor, 10) === this.selectedCursorStyle
                );
            });

            this.menuIndex = 0;
            this.lastActiveMenuId = null;
        });

        document.getElementById('btn-main-options-back').addEventListener('click', () => {
            const popup = document.getElementById('main-options-popup');
            popup.classList.add('hidden');
            popup.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));

            if (this.optionsOpenedFromPause) {
                // The main options popup lives inside menu-overlay, so hide the
                // overlay again before restoring the separate pause-menu layer.
                document.getElementById('menu-overlay').classList.add('hidden');
                document.getElementById('pause-menu').classList.remove('hidden');
                this.isPauseMenuOpen = true;
                this.optionsOpenedFromPause = false;
                this.pauseMenuCooldown = 0.3;
            }

            this.menuIndex = 0;
            this.lastActiveMenuId = null;
        });

        document.querySelectorAll('.music-volume-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.audio.setMusicVolumeLevel(parseInt(btn.dataset.musicLevel));
                refreshAudioOptionButtons();
            });
        });

        document.querySelectorAll('.sfx-volume-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.audio.setSfxVolumeLevel(parseInt(btn.dataset.sfxLevel));
                refreshAudioOptionButtons();
            });
        });

        const mainKeyboardButton = document.getElementById('main-keyboard-btn');
        const mainGamepadButton = document.getElementById('main-gamepad-btn');

        mainKeyboardButton?.addEventListener('click', (event) => {
            this.p1ControlMode = 'KEYBOARD';
            this.refreshControlOptionButtons();
            event.stopPropagation();
        });

        mainGamepadButton?.addEventListener('click', (event) => {
            this.p1ControlMode = 'GAMEPAD';
            this.refreshControlOptionButtons();
            event.stopPropagation();
        });

        document.querySelectorAll('.hardcore-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.hardcoreMode = btn.dataset.hardcore === 'true';
                refreshHardcoreOptionButtons();
            });
        });

        // Arena Options Handlers
        document.getElementById('btn-options-open').addEventListener('click', () => {
            document.getElementById('options-popup').classList.remove('hidden');
            // Refresh button states in popup
            document.querySelectorAll('.density-btn').forEach(btn => {
                const val = parseInt(btn.getAttribute('data-density'));
                if (val === this.asteroidDensityLevel) btn.classList.add('selected');
                else btn.classList.remove('selected');
            });
            document.querySelectorAll('.debris-btn').forEach(btn => {
                const val = parseInt(btn.getAttribute('data-debris'));
                if (val === this.debrisDensityLevel) btn.classList.add('selected');
                else btn.classList.remove('selected');
            });
            document.querySelectorAll('.satellite-btn').forEach(btn => {
                const val = parseInt(btn.getAttribute('data-satellite'));
                if (val === this.satelliteDensityLevel) btn.classList.add('selected');
                else btn.classList.remove('selected');
            });
            document.querySelectorAll('.aggression-btn').forEach(btn => {
                const val = parseInt(btn.getAttribute('data-aggression'));
                if (val === this.botAggressionLevel) btn.classList.add('selected');
                else btn.classList.remove('selected');
            });
            document.querySelectorAll('.shield-btn').forEach(btn => {
                const val = parseInt(btn.getAttribute('data-shield'));
                if (val === this.startingShieldCharges) btn.classList.add('selected');
                else btn.classList.remove('selected');
            });
            document.querySelectorAll('.recharge-btn').forEach(btn => {
                const val = parseInt(btn.getAttribute('data-recharge'));
                if (val === this.shieldRechargeRate) btn.classList.add('selected');
                else btn.classList.remove('selected');
            });
            refreshHardcoreOptionButtons();
            document.querySelectorAll('.cursor-option-btn').forEach(btn => {
                const val = parseInt(btn.getAttribute('data-cursor'));
                if (val === this.selectedCursorStyle) btn.classList.add('selected');
                else btn.classList.remove('selected');
            });
            this.updateAggressionLabel(this.botAggressionLevel);
        });

        document.getElementById('btn-options-back').addEventListener('click', () => {
            document.getElementById('options-popup').classList.add('hidden');
        });

        document.querySelectorAll('.cursor-option-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.selectedCursorStyle = parseInt(btn.getAttribute('data-cursor'));
                document.querySelectorAll('.cursor-option-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.updateCursorVisuals();
            });
        });

        document.querySelectorAll('.density-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.asteroidDensityLevel = parseInt(btn.getAttribute('data-density'));
                document.querySelectorAll('.density-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });

        document.querySelectorAll('.debris-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.debrisDensityLevel = parseInt(btn.getAttribute('data-debris'));
                document.querySelectorAll('.debris-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });

        document.querySelectorAll('.satellite-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.satelliteDensityLevel = parseInt(btn.getAttribute('data-satellite'));
                document.querySelectorAll('.satellite-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });

        document.querySelectorAll('.aggression-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.botAggressionLevel = parseInt(btn.getAttribute('data-aggression'));
                document.querySelectorAll('.aggression-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.updateAggressionLabel(this.botAggressionLevel);
            });
        });

        document.querySelectorAll('.shield-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.startingShieldCharges = parseInt(btn.getAttribute('data-shield'));
                document.querySelectorAll('.shield-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });

        document.querySelectorAll('.recharge-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.shieldRechargeRate = parseInt(btn.getAttribute('data-recharge'));
                document.querySelectorAll('.recharge-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });

        document.getElementById('btn-solo-join').addEventListener('click', () => {
            const botCount = this.selectedBotCount ?? 0;
            if (this.pendingMode === 'SOLO' && botCount === 0) {
                document.getElementById('botless-popup').classList.remove('hidden');
            } else {
                const totalShips = this.pendingMode === 'PVP' ? botCount + 2 : botCount + 1;
                this.startGame(this.pendingMode, totalShips);
            }
        });

        document.getElementById('btn-botless-continue').addEventListener('click', () => {
            document.getElementById('botless-popup').classList.add('hidden');
            this.startGame('SOLO', 1);
        });

        document.getElementById('btn-botless-back').addEventListener('click', () => {
            document.getElementById('botless-popup').classList.add('hidden');
        });

        // Bot count selection for Solo/PVP Arena
        document.querySelectorAll('.bot-count-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const count = parseInt(btn.getAttribute('data-bot-count'));
                
                if (this.selectedBotCount === count) {
                    this.selectedBotCount = 0;
                    btn.classList.remove('selected');
                } else {
                    this.selectedBotCount = count;
                    document.querySelectorAll('.bot-count-btn').forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                }
                
                this.updateSoloMockLobby(this.selectedBotCount);
                e.stopPropagation();
            });
        });

        // UI Swap Checkbox logic removed for PVP/Solo per request
        const swapCheckbox = document.getElementById('swap-ui-checkbox');
        if (swapCheckbox) {
            swapCheckbox.addEventListener('change', (e) => {
                this.swapUI = e.target.checked;
            });
        }

        // P1 Control Toggle
        const kbBtn = document.getElementById('p1-keyboard-btn');
        const gpBtn = document.getElementById('p1-gamepad-btn');
        
        kbBtn.addEventListener('click', (e) => {
            if (kbBtn.disabled) return;
            this.p1ControlMode = 'KEYBOARD';
            kbBtn.classList.add('selected');
            gpBtn.classList.remove('selected');
            this.refreshControlOptionButtons();
            e.stopPropagation();
        });

        gpBtn.addEventListener('click', (e) => {
            if (gpBtn.disabled) return;
            this.p1ControlMode = 'GAMEPAD';
            gpBtn.classList.add('selected');
            kbBtn.classList.remove('selected');
            this.refreshControlOptionButtons();
            e.stopPropagation();
        });

        document.getElementById('btn-online-back').addEventListener('click', () => {
            document.getElementById('online-menu').classList.add('hidden');
            document.getElementById('controls-selection').classList.add('hidden');
            document.getElementById('main-menu').classList.remove('hidden');
        });

        document.getElementById('btn-online-quick-join').addEventListener('click', () => {
            this.quickJoinOnlineGame();
        });

        document.getElementById('btn-online-join').addEventListener('click', () => {
            if (this.selectedLobbyId && this.network.activeLobbies[this.selectedLobbyId]) {
                const lobby = this.network.activeLobbies[this.selectedLobbyId];
                this.startOnlineGame('JOIN', lobby.roomId, lobby);
            }
        });

        // Online Control Toggle
        const onlineKbBtn = document.getElementById('online-keyboard-btn');
        const onlineGpBtn = document.getElementById('online-gamepad-btn');

        onlineKbBtn.addEventListener('click', (e) => {
            if (onlineKbBtn.disabled) return;
            this.p1ControlMode = 'KEYBOARD';
            onlineKbBtn.classList.add('selected');
            onlineGpBtn.classList.remove('selected');
            e.stopPropagation();
        });

        onlineGpBtn.addEventListener('click', (e) => {
            if (onlineGpBtn.disabled) return;
            this.p1ControlMode = 'GAMEPAD';
            onlineGpBtn.classList.add('selected');
            onlineKbBtn.classList.remove('selected');
            e.stopPropagation();
        });

        // Floating pause menu buttons
        document.getElementById('btn-pause-continue').addEventListener('click', () => {
            this.closePauseMenu();
        });

        document.getElementById('btn-pause-options').addEventListener('click', () => {
            this.optionsOpenedFromPause = true;

            const pauseMenu = document.getElementById('pause-menu');
            pauseMenu.classList.add('hidden');
            pauseMenu.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));

            // main-options-popup is a child of menu-overlay. Gameplay keeps
            // menu-overlay hidden, so reveal that layer before showing the popup.
            document.getElementById('menu-overlay').classList.remove('hidden');

            const popup = document.getElementById('main-options-popup');
            popup.classList.remove('hidden');
            popup.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));

            refreshAudioOptionButtons();
            this.refreshControlOptionButtons();

            document.querySelectorAll('.cursor-option-btn').forEach(btn => {
                btn.classList.toggle(
                    'selected',
                    parseInt(btn.dataset.cursor, 10) === this.selectedCursorStyle
                );
            });

            this.menuIndex = 0;
            this.lastActiveMenuId = null;
        });

        document.getElementById('btn-pause-quit').addEventListener('click', () => {
            this.openQuitConfirmation(document.getElementById('btn-pause-quit'));
        });

        document.getElementById('btn-arcade-replay').addEventListener('click', () => {
            this.startArcadeMode();
        });

        document.getElementById('btn-arcade-menu').addEventListener('click', () => {
            this.openQuitConfirmation(document.getElementById('btn-arcade-menu'));
        });

        document.getElementById('btn-quit-yes').addEventListener('click', () => this.confirmQuit());
        document.getElementById('btn-quit-no').addEventListener('click', () => this.closeQuitConfirmation());

        // Transformation Kills Logic
        const transValueEl = document.getElementById('trans-value');
        const transIncBtn = document.getElementById('trans-inc');
        const transDecBtn = document.getElementById('trans-dec');

        if (transValueEl && transIncBtn && transDecBtn) {
            const updateTrans = () => {
                transValueEl.innerText = this.transformationKills;
            };

            transIncBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.transformationKills < 100) {
                    this.transformationKills++;
                    updateTrans();
                }
            });

            transDecBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.transformationKills > 1) {
                    this.transformationKills--;
                    updateTrans();
                }
            });
        }
    }

    updateAggressionLabel(val) {
        const labels = {
            0: 'Random<br><span style="font-size: 0.8rem; font-weight: normal; color: #888;">(random bot aggression every spawn)</span>',
            1: "Timmy",
            2: "Gus",
            3: "Norman",
            4: "Viper",
            5: "Zorka"
        };
        const el = document.getElementById('aggression-label');
        if (el) el.innerHTML = labels[val] || labels[0];
    }

    isInGameplayState() {
        return this.gameState !== 'MENU' && this.gameState !== 'SPLASH' && !this.arcadeGameOver;
    }

    resetMouseLockInput() {
        this.mouse.m2Held = false;
        this.mouse.m2Pressed = false;
        this.mouse.m2Released = false;
        this.players[0]?.clearAimLock();
    }

    resetLockInputs() {
        this.resetMouseLockInput();
        this.players.forEach(player => player.resetControllerAimLock(true));
    }

    togglePauseMenu() {
        if (this.isPauseMenuOpen) {
            this.closePauseMenu();
        } else {
            this.openPauseMenu();
        }
    }

    openPauseMenu() {
        this.resetLockInputs();
        this.isPauseMenuOpen = true;
        document.getElementById('pause-menu').classList.remove('hidden');

        // Reset gamepad navigation state and highlight the first button
        this.pauseMenuIndex = 0;
        this.pauseMenuCooldown = 0.3; // Small delay so the Start press that opened this doesn't also select
        this.setInitialMenuFocus(document.getElementById('pause-menu'));
    }

    closePauseMenu() {
        this.isPauseMenuOpen = false;
        document.getElementById('pause-menu').classList.add('hidden');
        // Clear focus
        document.getElementById('pause-menu').querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
    }

    getInteractiveElements(container) {
        if (!container) return [];
        return Array.from(container.querySelectorAll('button:not([disabled]), .lobby-item')).filter(element => (
            element.offsetParent !== null && !element.closest('.hidden')
        ));
    }

    setInitialMenuFocus(container, preferredElement = null) {
        document.querySelectorAll('.focused').forEach(element => element.classList.remove('focused'));
        const elements = this.getInteractiveElements(container);
        const target = preferredElement && elements.includes(preferredElement) ? preferredElement : elements[0];
        target?.classList.add('focused');
        this.menuIndex = Math.max(0, elements.indexOf(target));
        return target;
    }

    findSpatialMenuTarget(current, elements, direction) {
        if (!current) return elements[0] || null;
        const tolerance = 6;
        const currentRect = current.getBoundingClientRect();
        const origin = { x: currentRect.left + currentRect.width / 2, y: currentRect.top + currentRect.height / 2 };
        const vertical = direction === 'up' || direction === 'down';
        const sign = direction === 'up' || direction === 'left' ? -1 : 1;

        return elements
            .filter(element => element !== current)
            .map(element => {
                const rect = element.getBoundingClientRect();
                const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                const primary = sign * (vertical ? point.y - origin.y : point.x - origin.x);
                const perpendicular = Math.abs(vertical ? point.x - origin.x : point.y - origin.y);
                return { element, primary, score: perpendicular * 4 + primary };
            })
            .filter(candidate => candidate.primary > tolerance)
            .sort((a, b) => a.score - b.score || a.primary - b.primary)[0]?.element || current;
    }

    openQuitConfirmation(returnFocusElement) {
        if (this.activeModal) return;
        this.activeModal = 'quit';
        this.focusBeforeModal = returnFocusElement || document.querySelector('.focused');
        const modal = document.getElementById('quit-confirmation');
        modal.classList.remove('hidden');
        this.setInitialMenuFocus(modal, document.getElementById('btn-quit-no'));
        this.menuCooldown = 0.3;
        this.lastActiveMenuId = modal.id;
        this.resetLockInputs();
    }

    closeQuitConfirmation() {
        if (this.activeModal !== 'quit') return;
        document.getElementById('quit-confirmation').classList.add('hidden');
        document.getElementById('quit-confirmation').querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
        this.activeModal = null;
        const restoreTarget = this.focusBeforeModal;
        this.focusBeforeModal = null;
        if (restoreTarget?.offsetParent !== null) restoreTarget.classList.add('focused');
        this.menuCooldown = 0.3;
        this.pauseMenuCooldown = 0.3;
        this.lastActiveMenuId = null;
    }

    confirmQuit() {
        if (this.activeModal !== 'quit') return;
        this.closeQuitConfirmation();
        this.returnToMenu();
    }

    // Gamepad D-pad/stick navigation for the floating in-game pause menu (Escape/Start menu)
    updatePauseMenuNavigation(dt) {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = Array.from(gamepads).find(gamepad => gamepad !== null) || null;
        if (!gp) return;

        if (this.pauseMenuCooldown > 0) {
            this.pauseMenuCooldown -= dt;
            return;
        }

        const menuEl = document.getElementById('pause-menu');
        if (!menuEl || menuEl.classList.contains('hidden')) return;

        const buttons = this.getInteractiveElements(menuEl);
        if (buttons.length === 0) return;

        const iy = gp.axes[1];
        const ix = gp.axes[0];
        const up = gp.buttons[12].pressed || iy < -0.5;
        const down = gp.buttons[13].pressed || iy > 0.5;
        const left = gp.buttons[14].pressed || ix < -0.5;
        const right = gp.buttons[15].pressed || ix > 0.5;

        const direction = up ? 'up' : down ? 'down' : left ? 'left' : right ? 'right' : null;
        const current = menuEl.querySelector('.focused') || buttons[this.pauseMenuIndex] || buttons[0];
        const target = direction ? this.findSpatialMenuTarget(current, buttons, direction) : current;
        const changed = target !== current;
        this.pauseMenuIndex = Math.max(0, buttons.indexOf(target));

        if (changed) {
            this.pauseMenuCooldown = 0.2;
            buttons.forEach((btn, i) => {
                if (i === this.pauseMenuIndex) btn.classList.add('focused');
                else btn.classList.remove('focused');
            });
        }

        // Selection (A / Button 0)
        if (gp.buttons[0].pressed) {
            const selectedBtn = buttons[this.pauseMenuIndex];
            if (selectedBtn) {
                selectedBtn.click();
                this.pauseMenuCooldown = 0.3;
            }
        }
    }

    startGame(mode, customShipCount) {
        if (mode !== GAME_MODE.EXPERIMENTAL) this.clearExperimentalState();
        this.gameState = mode;
        document.getElementById('menu-overlay').classList.add('hidden');
        this.closePauseMenu();
        // Clear selected buttons
        document.querySelectorAll('button.selected').forEach(btn => btn.classList.remove('selected'));
        this.spawnPlayers(mode, customShipCount);
        this.spawnInitialAsteroids();

        // Stop BGM when entering gameplay
        this.audio.stopBGM();
    }

    clearExperimentalState() {
        if (this.camera && this.experimentalCameraState?.previousZoom) {
            this.camera.zoom = this.experimentalCameraState.previousZoom;
            this.camera.useWrappedWorld();
        }
        for (const entity of [...(this.players || []), ...(this.asteroids || []), ...(this.hazards || []), ...(this.projectiles || [])]) {
            delete entity.roomId;
            if (entity instanceof Player && entity.isNPC) {
                entity.npcTarget = null;
                entity.shouldFire = false;
            }
        }
        this.experimentalRooms = [];
        this.experimentalDoors = [];
        this.experimentalRoomPopulations = new Map();
        this.experimentalSessionId = (this.experimentalSessionId || 0) + 1;
        this.experimentalRoomAssignments = new Map();
        this.experimentalCameraState = null;
    }

    initializeExperimentalRooms() {
        this.experimentalRooms = createExperimentalAreas(WORLD_WIDTH, WORLD_HEIGHT);
        this.experimentalDoors = createExperimentalDoors(this.experimentalRooms);
        const desired = getArenaPopulationTargets(
            this.asteroidDensityLevel,
            this.debrisDensityLevel,
            this.satelliteDensityLevel
        );
        this.experimentalRoomPopulations = new Map(this.experimentalRooms.filter(room => room.isPopulationEligible).map(room => [room.id, {
            density: Object.freeze({
                asteroidLevel: this.asteroidDensityLevel,
                debrisLevel: this.debrisDensityLevel,
                satelliteLevel: this.satelliteDensityLevel
            }),
            desired: Object.freeze({ ...desired })
        }]));
    }

    getWorldRules() {
        if (this.gameState === GAME_MODE.EXPERIMENTAL) {
            const room = this.experimentalRooms[0] || null;
            return {
                wrap: false,
                usesRooms: true,
                camera: 'ROOM',
                spawn: 'ROOM',
                room,
                getWallsFor: entity => Game.prototype.getExperimentalCollisionWalls.call(this, entity)
            };
        }
        return { wrap: true, usesRooms: false, camera: 'WRAP', spawn: 'GLOBAL', room: null };
    }

    getExperimentalRoom(roomId) {
        return this.experimentalRooms.find(room => room.id === roomId) || null;
    }

    findExperimentalSpawn(radius = 40, occupants = this.players, roomId = null) {
        const room = Game.prototype.getExperimentalRoom.call(this, roomId) || this.experimentalRooms[0];
        if (!room) return { x: DESIGN_WIDTH / 2, y: DESIGN_HEIGHT / 2 };
        const region = room.spawnRegion;
        for (let attempt = 0; attempt < 40; attempt++) {
            const point = {
                x: region.left + radius + Math.random() * Math.max(0, region.right - region.left - radius * 2),
                y: region.top + radius + Math.random() * Math.max(0, region.bottom - region.top - radius * 2)
            };
            if (occupants.every(player => player.isDead || Math.hypot(player.x - point.x, player.y - point.y) > player.radius + radius + 120)) return point;
        }
        return { x: (room.bounds.left + room.bounds.right) / 2, y: (room.bounds.top + room.bounds.bottom) / 2 };
    }

    setupExperimentalPopulations() {
        const room = this.experimentalRooms[0];
        const placedPlayers = [];
        this.players = this.players.filter(player => !player.isNPC);
        this.players.forEach(player => {
            const spawn = this.findExperimentalSpawn(player.radius, placedPlayers);
            player.x = spawn.x;
            player.y = spawn.y;
            player.roomId = room.id;
            placedPlayers.push(player);
        });
        let nextNpcId = Math.max(1, ...this.players.map(player => player.id || 0)) + 1;
        for (const npcRoom of this.experimentalRooms.filter(area => area.isPopulationEligible)) {
            for (let index = 0; index < npcRoom.npcCount; index++) {
                const spawn = Game.prototype.findExperimentalSpawn.call(this, 25, placedPlayers, npcRoom.id);
                const npc = new Player(spawn.x, spawn.y, nextNpcId++);
                if (typeof this.configurePlayerShields === 'function') this.configurePlayerShields(npc);
                npc.isNPC = true;
                npc.name = `ROOM ${npcRoom.roomNumber} BOT ${index + 1}`;
                npc.roomId = npcRoom.id;
                if (this.botAggressionLevel > 0) {
                    npc.aggressionLevel = this.botAggressionLevel;
                    npc.rollAccuracy();
                } else {
                    npc.rollAggression();
                }
                npc.initializeNPCLevel(npcRoom.npcLevel);
                this.players.push(npc);
                placedPlayers.push(npc);
            }
        }
        this.asteroids = [];
        this.hazards = [];
        for (const populationRoom of this.experimentalRooms.filter(area => area.isPopulationEligible)) {
            const targets = this.experimentalRoomPopulations?.get(populationRoom.id)?.desired
                || getArenaPopulationTargets(this.asteroidDensityLevel, this.debrisDensityLevel, this.satelliteDensityLevel);
            for (let index = 0; index < targets.asteroids; index++) this.spawnAsteroid('large', undefined, undefined, populationRoom.id);
            for (let index = 0; index < targets.debris; index++) this.spawnSpaceDebris(populationRoom.id);
            for (let index = 0; index < targets.satellites; index++) this.spawnSatellite(populationRoom.id);
        }
    }

    getExperimentalRoomPopulation(roomId) {
        const desired = this.experimentalRoomPopulations?.get(roomId)?.desired || { asteroids: 0, debris: 0, satellites: 0 };
        return {
            desired,
            live: {
                asteroids: this.asteroids.filter(asteroid => !asteroid.isDestroyed && asteroid.roomId === roomId).length,
                largeAsteroids: this.asteroids.filter(asteroid => !asteroid.isDestroyed && asteroid.size === 'large' && asteroid.roomId === roomId).length,
                debris: this.hazards.filter(hazard => !hazard.isDestroyed && hazard.isDebris && hazard.roomId === roomId).length,
                satellites: this.hazards.filter(hazard => !hazard.isDestroyed && hazard.isSatellite && hazard.roomId === roomId).length
            }
        };
    }

    shouldSpawnExperimentalReplacement(roomId, type) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return true;
        const population = Game.prototype.getExperimentalRoomPopulation.call(this, roomId);
        if (type === 'asteroids') return population.live.largeAsteroids < population.desired.asteroids;
        return population.live[type] < population.desired[type];
    }

    scheduleEnvironmentReplacement(delaySeconds, roomId, type, spawn) {
        const experimentalSessionId = this.gameState === GAME_MODE.EXPERIMENTAL ? this.experimentalSessionId : null;
        setTimeout(() => {
            if (this.gameState === 'MENU') return;
            if (experimentalSessionId !== null) {
                if (this.gameState !== GAME_MODE.EXPERIMENTAL || this.experimentalSessionId !== experimentalSessionId) return;
                if (!Game.prototype.getExperimentalRoom.call(this, roomId)) return;
                if (!Game.prototype.shouldSpawnExperimentalReplacement.call(this, roomId, type)) return;
            }
            spawn();
        }, delaySeconds * 1000);
    }

    setupExperimentalMatch() {
        this.clearExperimentalState();
        this.initializeExperimentalRooms();
        // Reuse the shared Solo human contract; room-configured NPCs are added below.
        this.spawnPlayers(GAME_MODE.SOLO, 2);
        this.gameState = GAME_MODE.EXPERIMENTAL;
        this.setupExperimentalPopulations();
    }

    startExperimentalMode() {
        this.closePauseMenu();
        this.hideArcadeGameOver();
        this.clearExperimentalState();
        this.players = [];
        this.asteroids = [];
        this.hazards = [];
        this.projectiles = [];
        this.vfx = [];
        this.setupExperimentalMatch();
        document.getElementById('menu-overlay').classList.add('hidden');
        this.experimentalCameraState = { previousZoom: this.camera.zoom };
        this.camera.zoom = DEFAULT_GAMEPLAY_ZOOM;
        this.camera.follow(this.players[0]);
        this.camera.useDirectWorld();
        this.audio.stopBGM();
        this.resetMouseLockInput();
    }

    async quickJoinOnlineGame() {
        // Look for an available lobby in this.network.activeLobbies
        const lobbies = Object.values(this.network.activeLobbies || {});
        // Find lobbies with < 8 players that have been seen recently
        const now = Date.now();
        const availableLobby = lobbies.find(l => (l.playerCount || 0) < 8 && (now - (l.lastSeen || 0)) < 15000);

        if (availableLobby) {
            console.log('Joining existing lobby:', availableLobby.roomId);
            await this.startOnlineGame('JOIN', availableLobby.roomId, availableLobby);
        } else {
            // Create a new lobby with a unique name
            const newRoomName = `ARENA-${Math.floor(1000 + Math.random() * 9000)}`;
            console.log('Creating new lobby:', newRoomName);
            await this.startOnlineGame('HOST', newRoomName);
        }
    }

    async startOnlineGame(type, roomName, config) {
        const p1 = new Player(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, 1, '#00ffff');
        p1.name = document.getElementById('p1-name-input').value.toUpperCase() || 'PILOT';
        p1.controlMode = this.p1ControlMode;
        this.players = [p1];

        try {
            if (type === 'HOST') {
                await this.network.host(roomName, this.transformationKills);
            } else {
                this.transformationKills = config?.transKills || 12;
                await this.network.joinRoom(roomName);
            }
        } catch (error) {
            console.error('Could not join online room:', error);
            return; // Keep the menu open when Realtime fails.
        }

        this.gameState = 'ONLINE';
        document.getElementById('menu-overlay').classList.add('hidden');
        this.closePauseMenu();
        this.spawnInitialAsteroids();
        
        // Stop BGM when entering online gameplay
        this.audio.stopBGM();
    }

    updateLobbyListUI(lobbies) {
        const listEl = document.getElementById('lobby-list');
        if (!listEl) return;
        
        listEl.innerHTML = '';
        const lobbyIds = Object.keys(lobbies);
        
        if (lobbyIds.length === 0) {
            listEl.innerHTML = '<div style="color: #666; text-align: center; margin-top: 80px;">NO LOBBIES FOUND</div>';
            document.getElementById('btn-online-join').disabled = true;
            return;
        }
        
        lobbyIds.forEach(id => {
            const lobby = lobbies[id];
            // Only show lobbies that were seen in the last 15 seconds
            if (Date.now() - lobby.lastSeen > 15000) return;

            const div = document.createElement('div');
            div.className = 'lobby-item';
            if (this.selectedLobbyId === id) div.classList.add('selected');
            
            div.innerHTML = `
                <div>
                    <div style="font-weight: bold; color: #00ffff;">${lobby.roomId}</div>
                    <div style="font-size: 0.7rem; color: #888;">HOST: ${lobby.hostName} | TRANS: ${lobby.transKills}</div>
                </div>
                <div style="color: #00ffff;">${lobby.playerCount}/8</div>
            `;
            
            div.onclick = () => {
                this.selectedLobbyId = id;
                this.updateLobbyListUI(lobbies);
                document.getElementById('btn-online-join').disabled = false;
            };
            
            listEl.appendChild(div);
        });
    }

    updateSoloMockLobby(botCount) {
        const mockBox = document.getElementById('mock-lobby-box');
        if (!mockBox) return;

        mockBox.innerHTML = '';
        
        // Mock Player entry - simplified and widened for clarity
        const playerDiv = document.createElement('div');
        playerDiv.className = 'lobby-item selected';
        playerDiv.style.cursor = 'default';
        playerDiv.style.width = '100%';
        playerDiv.style.boxSizing = 'border-box';
        playerDiv.style.padding = '15px 20px';
        
        let lobbyName = 'ARENA - 001';
        const playerCount = this.pendingMode === 'PVP' ? (botCount + 2) : (botCount + 1);

        if (this.pendingMode === 'SOLO') {
            const names = {
                1: 'FLIGHT PRACTICE - 001',
                2: 'DOGFIGHT - 002',
                3: 'SCUFFLE - 003',
                4: 'SKIRMISH - 004',
                5: 'FRAY - 005',
                6: 'BROUHAHA - 006',
                7: 'BRAWL - 007',
                8: 'BATTLE ROYAL - 008',
                9: 'BATTLE ROYAL - 009'
            };
            lobbyName = names[playerCount] || `ARENA - ${String(playerCount).padStart(3, '0')}`;
        } else if (this.pendingMode === 'PVP') {
            if (botCount === 0) {
                lobbyName = 'DOGFIGHT - 002';
            } else {
                const names = {
                    3: 'SCUFFLE - 003',
                    4: 'SKIRMISH - 004',
                    5: 'FRAY - 005',
                    6: 'BROUHAHA - 006',
                    7: 'BRAWL - 007',
                    8: 'BATTLE ROYAL - 008' 
                };
                lobbyName = names[playerCount] || `ARENA - ${String(playerCount).padStart(3, '0')}`;
            }
        }
        
        playerDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <div style="text-align: left;">
                    <div style="font-weight: bold; color: #00ffff; font-size: 1.2rem; letter-spacing: 0.1rem;">${lobbyName}</div>
                    <div style="font-size: 0.8rem; color: #888; margin-top: 4px;">HOST: YOU | NEXT TRANSFORMATION: 20 KILLS</div>
                </div>
                <div style="color: #00ffff; font-size: 1.4rem; font-weight: bold;">${playerCount} / 8</div>
            </div>
        `;
        mockBox.appendChild(playerDiv);
    }

    returnToMenu() {
        this.resetLockInputs();
        this.activeModal = null;
        this.focusBeforeModal = null;
        document.getElementById('quit-confirmation').classList.add('hidden');
        if (this.network) {
            this.network.leave();
        }
        this.closePauseMenu();
        this.hideArcadeGameOver();
        this.arcadeWaveSize = 0;
        this.arcadeSustainEight = false;
        this.nextArcadeReplacementLevel = 9;
        this.arcadeGameOver = false;
        this.arcadeResult = null;
        this.optionsOpenedFromPause = false;
        this.gameState = 'MENU';
        document.getElementById('menu-overlay').classList.remove('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
        document.getElementById('solo-menu').classList.add('hidden');
        document.getElementById('online-menu').classList.add('hidden');
        document.getElementById('experimental-menu').classList.add('hidden');
        document.getElementById('main-options-popup').classList.add('hidden');
        document.getElementById('main-options-popup').querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
        document.getElementById('controls-selection').classList.add('hidden');
        this.menuIndex = 0;
        this.lastActiveMenuId = 'main-menu';
        
        // Ensure menu music starts playing (space_ambient)
        this.audio.startBGM('space_ambient');

        // Visual selection focus
        const buttons = Array.from(document.getElementById('main-menu').querySelectorAll('button:not([disabled])'));
        buttons.forEach((btn, i) => {
            if (i === 0) btn.classList.add('focused');
            else btn.classList.remove('focused');
        });

        this.clearExperimentalState();
        this.players = [];
        this.asteroids = [];
        this.hazards = [];
        this.projectiles = [];
        this.vfx = [];
        this.clearExperimentalState();
    }

    handleFire(playerId, isBurstShot = false) {
        const player = this.players.find(p => p.id === playerId);
        if (!player || player.isDead) return;
        
        const projs = player.fire(isBurstShot);
        if (projs && projs.length > 0) {
            if (this.gameState === GAME_MODE.EXPERIMENTAL) {
                projs.forEach(projectile => { projectile.roomId = player.roomId; });
            }
            this.projectiles.push(...projs);
            
            // Spatial audio
            const cameras = this.getActiveCameras();
            this.audio.playSpatial('laser_fire', player.x, player.y, cameras, WORLD_WIDTH, WORLD_HEIGHT);
            
            if (this.gameState === 'ONLINE' && player.id === 1) {
                this.network.broadcastFire(projs);
            }
        }
    }

    getActiveCameras() {
        if (this.gameState === 'PVP') {
            const p1 = this.players[0];
            const p2 = this.players[1];
            const p1Cam = new Camera();
            p1Cam.zoom = this.camera.zoom * 0.8;
            p1Cam.follow(p1);
            const p2Cam = new Camera();
            p2Cam.zoom = this.camera.zoom * 0.8;
            p2Cam.follow(p2);
            return [p1Cam, p2Cam];
        }
        return [this.camera];
    }

    getPlayerOneCamera() {
        if (this.gameState !== 'PVP') return this.camera;
        const camera = new Camera();
        camera.zoom = this.camera.zoom * 0.8;
        camera.follow(this.players[0]);
        return camera;
    }

    getAimLockCandidates(lockingPlayer) {
        const candidates = [];
        let stableIndex = 0;
        const add = (entity, type) => candidates.push({
            entity,
            tiePriority: TARGET_TIE_PRIORITY[type],
            stableIndex: stableIndex++
        });

        this.players.forEach(player => {
            if (player !== lockingPlayer && !player.isDead && !player.isEliminated) add(player, 'player');
        });
        this.projectiles.forEach(projectile => {
            if ((projectile.isMissile || projectile.isSkinnyMissile)
                && !projectile.hasDetonated && !projectile.isRemoved && projectile.lifeSpan > 0) {
                add(projectile, 'missile');
            }
        });
        this.hazards.forEach(hazard => {
            if ((hazard instanceof SpaceDebris || hazard instanceof Satellite) && !hazard.isDestroyed) add(hazard, 'hazard');
        });
        this.asteroids.forEach(asteroid => {
            if (asteroid instanceof Asteroid && !asteroid.isDestroyed) add(asteroid, 'asteroid');
        });

        return candidates;
    }

    isValidAimLockTarget(lockingPlayer, target) {
        if (!target || target === lockingPlayer) return false;
        if (this.gameState === GAME_MODE.EXPERIMENTAL && target.roomId !== lockingPlayer.roomId) return false;
        if (target instanceof Player) {
            return this.players.includes(target) && !target.isDead && !target.isEliminated;
        }
        if (target instanceof Asteroid) {
            return this.asteroids.includes(target) && !target.isDestroyed;
        }
        if (target instanceof SpaceDebris || target instanceof Satellite) {
            return this.hazards.includes(target) && !target.isDestroyed;
        }
        if (target instanceof Projectile) {
            return this.projectiles.includes(target)
                && (target.isMissile || target.isSkinnyMissile)
                && !target.hasDetonated
                && !target.isRemoved
                && target.lifeSpan > 0;
        }
        return false;
    }

    findAimLockTargetAt(lockingPlayer, worldX, worldY) {
        let bestTarget = null;
        let bestIsBufferedOnly = true;
        let bestEdgeDistance = Infinity;
        let bestDistanceSquared = Infinity;
        let bestTiePriority = Infinity;
        let bestIndex = Infinity;

        this.getAimLockCandidates(lockingPlayer).forEach(({ entity, tiePriority, stableIndex }) => {
            if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y) || !Number.isFinite(entity.radius)) return;

            const delta = this.gameState === GAME_MODE.EXPERIMENTAL
                ? { x: entity.x - worldX, y: entity.y - worldY }
                : nearestWrappedDisplacement(worldX, worldY, entity.x, entity.y);
            const distanceSquared = delta.x * delta.x + delta.y * delta.y;
            const acquisitionRadius = entity.radius + MOUSE_AIM_LOCK_PADDING;
            if (distanceSquared > acquisitionRadius * acquisitionRadius) return;

            const distance = Math.sqrt(distanceSquared);
            const isBufferedOnly = distance > entity.radius;
            const edgeDistance = isBufferedOnly ? distance - entity.radius : 0;
            const rank = [Number(isBufferedOnly), edgeDistance, distanceSquared, tiePriority, stableIndex];
            const bestRank = [Number(bestIsBufferedOnly), bestEdgeDistance, bestDistanceSquared, bestTiePriority, bestIndex];
            const winsRanking = rank.some((value, index) =>
                value < bestRank[index] && rank.slice(0, index).every((prior, priorIndex) => prior === bestRank[priorIndex])
            );
            if (winsRanking) {
                bestTarget = entity;
                bestIsBufferedOnly = isBufferedOnly;
                bestEdgeDistance = edgeDistance;
                bestDistanceSquared = distanceSquared;
                bestTiePriority = tiePriority;
                bestIndex = stableIndex;
            }
        });

        return bestTarget;
    }

    findControllerAimLockTarget(lockingPlayer, direction) {
        let bestTarget = null;
        let bestAlongRay = Infinity;
        let bestPerpendicular = Infinity;
        let bestIndex = Infinity;

        this.getAimLockCandidates(lockingPlayer).forEach(({ entity, stableIndex }) => {
            if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y) || !Number.isFinite(entity.radius)) return;
            const delta = nearestWrappedDisplacement(lockingPlayer.x, lockingPlayer.y, entity.x, entity.y);
            const alongRay = delta.x * direction.x + delta.y * direction.y;
            if (alongRay <= 0 || alongRay > CONTROLLER_LOCK_MAX_DISTANCE) return;
            const perpendicular = Math.abs(delta.x * direction.y - delta.y * direction.x);
            if (perpendicular > entity.radius + CONTROLLER_AIM_LOCK_PADDING) return;

            const distanceTie = Math.abs(alongRay - bestAlongRay) <= RAY_DISTANCE_TIE_EPSILON;
            const winsTie = distanceTie
                && (perpendicular < bestPerpendicular
                    || (perpendicular === bestPerpendicular && stableIndex < bestIndex));
            if (alongRay < bestAlongRay - RAY_DISTANCE_TIE_EPSILON || winsTie) {
                bestTarget = entity;
                bestAlongRay = alongRay;
                bestPerpendicular = perpendicular;
                bestIndex = stableIndex;
            }
        });

        return bestTarget;
    }

    getAssignedGamepad(player, gamepads) {
        const connected = Array.from(gamepads).filter(gamepad => gamepad !== null);
        if (player.id === 1 && player.controlMode === 'GAMEPAD') return connected[0] || null;
        if (player.id !== 2) return null;
        const p1OnGamepad = this.players[0]?.controlMode === 'GAMEPAD';
        return (p1OnGamepad ? connected[1] : connected[0]) || null;
    }

    updateControllerAimLock(player, gamepad) {
        if (!gamepad) {
            player.resetControllerAimLock(true);
            return;
        }
        const button = gamepad.buttons?.[6];
        const hasAnalogValue = Number.isFinite(button?.value) && (button.value > 0 || !button.pressed);
        const value = hasAnalogValue ? button.value : (button?.pressed ? 1 : 0);
        const shouldAcquire = player.updateControllerAimLockTrigger(
            value,
            CONTROLLER_LOCK_ACQUIRE_THRESHOLD,
            CONTROLLER_LOCK_RELEASE_THRESHOLD
        );
        if (!shouldAcquire) return;
        const direction = player.getControllerAimDirection(gamepad, CONTROLLER_AIM_DEADZONE);
        const target = this.findControllerAimLockTarget(player, direction);
        if (target) player.beginAimLock(target);
    }

    beginPlayerOneAimLock(player, camera) {
        const viewport = {
            x: 0,
            y: 0,
            width: this.gameState === 'PVP' ? DESIGN_WIDTH / 2 : DESIGN_WIDTH,
            height: DESIGN_HEIGHT
        };
        const worldPoint = camera.screenToWorld(this.mouse.x, this.mouse.y, viewport);
        const target = this.findAimLockTargetAt(player, worldPoint.x, worldPoint.y);
        if (!target) return false;
        return player.beginAimLock(target);
    }

    resize() {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        this.scale = Math.min(screenWidth / DESIGN_WIDTH, screenHeight / DESIGN_HEIGHT);
        
        this.canvas.width = DESIGN_WIDTH * this.scale;
        this.canvas.height = DESIGN_HEIGHT * this.scale;
        
        this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);

        // Scale the menu overlay content
        const menuOverlay = document.getElementById('menu-overlay');
        if (menuOverlay) {
            // Apply scale to the menu overlay content for standard resolution range scaling
            // We use a CSS transform to scale the entire UI while keeping it centered
            const scaleStr = `scale(${this.scale})`;
            menuOverlay.style.transform = scaleStr;
            menuOverlay.style.transformOrigin = 'center center';
            // Ensure it covers full screen effectively
            menuOverlay.style.width = `${100 / this.scale}%`;
            menuOverlay.style.height = `${100 / this.scale}%`;
            menuOverlay.style.left = `${(1 - 1/this.scale) * 50}%`;
            menuOverlay.style.top = `${(1 - 1/this.scale) * 50}%`;
        }
    }

    start() {
        requestAnimationFrame((time) => this.loop(time));
    }

    loop(time) {
        const dt = Math.min((time - this.lastTime) / 1000, 0.1);
        this.lastTime = time;

        this.updateGamepadVisibilityDetection();
        this.updateStartButton();

        if (this.gameState === 'SPLASH') {
            this.updateSplash(dt);
        } else if (this.activeModal === 'quit') {
            this.updateMenuNavigation(dt);
        } else if (this.arcadeGameOver) {
            this.updateMenuNavigation(dt);
        } else if (this.gameState !== 'MENU' && !this.arcadeGameOver) {
            // Only update game if local player is not eliminated, or show results
            this.update(dt);
            if (this.isPauseMenuOpen) {
                this.updatePauseMenuNavigation(dt);
            } else if (this.optionsOpenedFromPause) {
                this.updateMenuNavigation(dt);
            }
        } else {
            this.updateMenuNavigation(dt);
        }
        this.draw();

        requestAnimationFrame((t) => this.loop(t));
    }

    // Hide the cursor for gamepad-driven play, without letting P2 input hide P1's mouse cursor.
    updateGamepadVisibilityDetection() {
        if (this.isInGameplayState() && this.getMouseControlledPlayer()) return;

        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const gp of gamepads) {
            if (!gp) continue;
            
            // Check buttons
            for (const btn of gp.buttons) {
                if (btn.pressed) {
                    this.cursorVisible = false;
                    if (this.domCursor) this.domCursor.style.display = 'none';
                    return;
                }
            }
            
            // Check axes with a small deadzone to ignore stick drift
            for (const axis of gp.axes) {
                if (Math.abs(axis) > 0.1) {
                    this.cursorVisible = false;
                    if (this.domCursor) this.domCursor.style.display = 'none';
                    return;
                }
            }
        }
    }

    // Gamepad Start button (button index 9) acts like Escape: toggles the floating pause menu
    updateStartButton() {
        if (this.activeModal || !this.isInGameplayState()) {
            this.startBtnWasPressed = false;
            return;
        }
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        let anyStartPressed = false;
        for (const gp of gamepads) {
            if (gp && gp.buttons[9] && gp.buttons[9].pressed) {
                anyStartPressed = true;
                break;
            }
        }
        if (anyStartPressed && !this.startBtnWasPressed) {
            this.togglePauseMenu();
        }
        this.startBtnWasPressed = anyStartPressed;
    }

    updateSplash(dt) {
        this.splashTimer += dt;
        
        // Handle Gamepad Advance
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const gp of gamepads) {
            if (gp) {
                for (const btn of gp.buttons) {
                    if (btn.pressed) {
                        this.advanceFromSplash();
                        return;
                    }
                }
            }
        }

        if (this.splashPhase === 'FADE_IN') {
            this.splashAlpha = Math.min(1, this.splashTimer / 2);
            if (this.splashTimer > 3) {
                this.splashPhase = 'FADE_OUT';
                this.splashTimer = 0;
            }
        } else if (this.splashPhase === 'FADE_OUT') {
            this.splashAlpha = Math.max(0, 1 - this.splashTimer / 2);
            if (this.splashTimer > 3) {
                this.audio.unlock(); 
                this.returnToMenu();
            }
        }
    }

    advanceFromSplash() {
        this.audio.unlock();
        this.returnToMenu();
    }

    updateMenuNavigation(dt) {
        if (this.titleInputLockTimer > 0) return; 

        // Update gamepad connection statuses in visible menus
        if (!document.getElementById('solo-menu').classList.contains('hidden')) {
            this.updateGamepadStatus();
        }
        if (!document.getElementById('online-menu').classList.contains('hidden')) {
            this.updateOnlineGamepadStatus();
        }
        
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = Array.from(gamepads).find(gamepad => gamepad !== null) || null;
        if (!gp) return;

        if (this.menuCooldown > 0) {
            this.menuCooldown -= dt;
            return;
        }

        // Determine the topmost active menu container. Modal and Game Over
        // layers live outside the normal menu overlay but share this contract.
        let activeMenu = null;
        const potentialContainers = this.activeModal === 'quit'
            ? ['quit-confirmation']
            : this.arcadeGameOver
                ? ['arcade-game-over']
                : ['main-options-popup', 'botless-popup', 'options-popup', 'solo-menu', 'online-menu', 'experimental-menu', 'main-menu'];
        for (const id of potentialContainers) {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden')) {
                activeMenu = el;
                // If it's a menu-level container, only count it if it's the specific active one
                if (id === 'solo-menu' || id === 'online-menu' || id === 'experimental-menu' || id === 'main-menu') {
                    // These are siblings in menu-overlay
                }
                break;
            }
        }

        if (!activeMenu) return;

        // Reset index if we switched menus
        if (this.lastActiveMenuId !== activeMenu.id) {
            // Clear focused class from previous menu
            if (this.lastActiveMenuId) {
                const prev = document.getElementById(this.lastActiveMenuId);
                if (prev) prev.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
            }
            this.menuIndex = 0;
            this.lastActiveMenuId = activeMenu.id;
        }

        // Find all interactive elements in the visible menu
        // We include .lobby-item for the online lobby list
        const buttons = this.getInteractiveElements(activeMenu);

        if (buttons.length === 0) return;

        const focusedIndex = buttons.indexOf(activeMenu.querySelector('.focused'));
        if (focusedIndex >= 0) this.menuIndex = focusedIndex;

        // Boundary check for menuIndex
        if (this.menuIndex >= buttons.length) this.menuIndex = 0;

        // Navigation (Stick or D-pad)
        const iy = gp.axes[1];
        const ix = gp.axes[0];
        const up = gp.buttons[12].pressed || iy < -0.5;
        const down = gp.buttons[13].pressed || iy > 0.5;
        const left = gp.buttons[14].pressed || ix < -0.5;
        const right = gp.buttons[15].pressed || ix > 0.5;

        const direction = up ? 'up' : down ? 'down' : left ? 'left' : right ? 'right' : null;
        const current = activeMenu.querySelector('.focused') || buttons[this.menuIndex] || buttons[0];
        const target = direction ? this.findSpatialMenuTarget(current, buttons, direction) : current;
        const changed = target !== current;
        this.menuIndex = Math.max(0, buttons.indexOf(target));

        if (changed || !activeMenu.querySelector('.focused')) {
            this.menuCooldown = 0.2;
            // Visual feedback
            buttons.forEach((btn, i) => {
                if (i === this.menuIndex) btn.classList.add('focused');
                else btn.classList.remove('focused');
            });
        }

        // Selection (A / Button 0)
        if (gp.buttons[0].pressed) {
            const selectedBtn = buttons[this.menuIndex];
            if (selectedBtn) {
                selectedBtn.click();
                this.menuCooldown = 0.3;
            }
        }
    }

    updateGamepadStatus() {
        const gamepads = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(g => g !== null);
        const count = gamepads.length;
        const statusEl = document.getElementById('gamepad-status');
        const kbBtn = document.getElementById('p1-keyboard-btn');
        const gpBtn = document.getElementById('p1-gamepad-btn');
        const isPvP = this.pendingMode === 'PVP';

        if (statusEl) statusEl.innerText = `${count} GAMEPAD(S) DETECTED`;

        if (count === 0) {
            // Chrome can briefly hide gamepads from an embedded itch.io frame until
            // the frame receives controller interaction. Preserve the player's
            // selected/default control mode instead of silently switching to keyboard.
            kbBtn.disabled = false;
            gpBtn.disabled = true;
            if (this.p1ControlMode === 'GAMEPAD') {
                gpBtn.classList.add('selected');
                kbBtn.classList.remove('selected');
            } else {
                kbBtn.classList.add('selected');
                gpBtn.classList.remove('selected');
            }
        } else if (count === 1) {
            if (isPvP) {
                // Only 1 controller in PVP: force it onto P1, P2 needs a controller of their own
                gpBtn.classList.add('selected');
                gpBtn.disabled = true;
                kbBtn.classList.remove('selected');
                kbBtn.disabled = true;
                this.p1ControlMode = 'GAMEPAD';
                if (statusEl) statusEl.innerText += " - PLAYER 2, PLEASE CONNECT A CONTROLLER";
            } else {
                // Solo mode: 1 gamepad can be used by P1
                kbBtn.disabled = false;
                gpBtn.disabled = false;
                if (this.p1ControlMode === 'GAMEPAD') {
                    gpBtn.classList.add('selected');
                    kbBtn.classList.remove('selected');
                } else {
                    kbBtn.classList.add('selected');
                    gpBtn.classList.remove('selected');
                }
            }
        } else if (count >= 2) {
            // User can choose
            kbBtn.disabled = false;
            gpBtn.disabled = false;
            if (this.p1ControlMode === 'KEYBOARD') {
                kbBtn.classList.add('selected');
                gpBtn.classList.remove('selected');
            } else {
                gpBtn.classList.add('selected');
                kbBtn.classList.remove('selected');
            }
        }
        this.refreshControlOptionButtons();
    }

    updateOnlineGamepadStatus() {
        const gamepads = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(g => g !== null);
        const count = gamepads.length;
        const statusEl = document.getElementById('online-gamepad-status');
        const kbBtn = document.getElementById('online-keyboard-btn');
        const gpBtn = document.getElementById('online-gamepad-btn');
        const p1NameInput = document.getElementById('p1-name-input');
        
        // Ensure name input is visible in Online menu too
        const controlsSelection = document.getElementById('controls-selection');
        if (controlsSelection) {
            controlsSelection.classList.remove('hidden');
        }

        if (statusEl) statusEl.innerText = `${count} GAMEPAD(S) DETECTED`;

        if (count === 0) {
            kbBtn.disabled = false;
            gpBtn.disabled = true;
            if (this.p1ControlMode === 'GAMEPAD') {
                gpBtn.classList.add('selected');
                kbBtn.classList.remove('selected');
            } else {
                kbBtn.classList.add('selected');
                gpBtn.classList.remove('selected');
            }
        } else {
            kbBtn.disabled = false;
            gpBtn.disabled = false;
            if (this.p1ControlMode === 'GAMEPAD') {
                gpBtn.classList.add('selected');
                kbBtn.classList.remove('selected');
            } else {
                kbBtn.classList.add('selected');
                gpBtn.classList.remove('selected');
            }
        }
    }

    update(dt) {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const prestigeTriggers = [];
        const worldRules = this.getWorldRules();

        for (let player of this.players) {
            if (player.isEliminated) continue; // Skip eliminated players completely

            if (!player.isDead) {
                player.previousX = player.x;
                player.previousY = player.y;
                if (player.id <= 2 && !player.isNPC) {
                    const oldPrestigeLevel = player.prestigeLevel;
                    const inputCamera = player.id === 1 ? this.getPlayerOneCamera() : this.camera;
                    if (player.id === 1 && this.mouse.m2Pressed && this.mouse.m2Held) {
                        this.beginPlayerOneAimLock(player, inputCamera);
                    }
                    const assignedGamepad = this.getAssignedGamepad(player, gamepads);
                    if (player.controlMode === 'GAMEPAD') this.updateControllerAimLock(player, assignedGamepad);
                    else if (player.controllerAimLockLatched || !player.controllerAimLockArmed) player.resetControllerAimLock();
                    const isAimTargetValid = target => this.isValidAimLockTarget(player, target);
                    player.update(dt, this.keys, this.mouse, inputCamera, this.players, this.asteroids, gamepads, this.gameState === 'PVP', this.transformationKills, this.hazards, isAimTargetValid, this.areTransformationsEnabled(), worldRules);
                    if (player.id === 1) {
                        this.mouse.m2Pressed = false;
                        this.mouse.m2Released = false;
                    }
                    
                    if (player.prestigeLevel > oldPrestigeLevel) {
                        prestigeTriggers.push(player);
                        // Trigger on-screen message for local human players
                        if (player.id === 1 || player.id === 2) {
                            const nextReq = (player.prestigeLevel + 1) * 20 + ((player.prestigeLevel) * (player.prestigeLevel + 1) / 2) * 20;
                            const currentReq = player.prestigeLevel * 20 + ((player.prestigeLevel - 1) * player.prestigeLevel / 2) * 20;
                            const diff = nextReq - currentReq;
                            
                            this.vfx.push({
                                text: `${currentReq} KILLS! TRANSFORMATION ACHIEVED! NEXT TRANSFORMATION: ${diff} KILLS`,
                                life: 4.0,
                                flashTimer: 0,
                                flashCount: 0,
                                visible: true,
                                update(dt) {
                                    this.life -= dt;
                                    this.flashTimer += dt;
                                    if (this.flashTimer > 0.66) { // Slow flash (approx 3 times in 4 seconds)
                                        this.flashTimer = 0;
                                        this.visible = !this.visible;
                                        if (!this.visible) this.flashCount++;
                                    }
                                    if (this.life <= 0) this.finished = true;
                                },
                                draw(ctx) {
                                    if (!this.visible) return;
                                    ctx.save();
                                    ctx.font = 'bold 30px "Courier New", monospace'; // 8-bit style
                                    ctx.fillStyle = '#00ffff';
                                    ctx.textAlign = 'center';
                                    ctx.shadowBlur = 10;
                                    ctx.shadowColor = '#000';
                                    ctx.fillText(this.text, DESIGN_WIDTH / 2, DESIGN_HEIGHT / 3);
                                    ctx.restore();
                                }
                            });
                        }
                    }
                    
                    // Handle burst fire triggered by player internal state
                    if (player.shouldTriggerBurstFire) {
                        this.handleFire(player.id, true); // true = silent/secondary burst shot
                        player.shouldTriggerBurstFire = false;
                    }

                    // Firing Logic
                    if (player.id === 1 && player.controlMode === 'KEYBOARD') {
                        // Mouse Autofire
                        if (this.mouse.clicked && player.fireCooldown <= 0) {
                            this.handleFire(player.id);
                        }
                    }

                    // Gamepad Firing logic
                    if (assignedGamepad) {
                        const rt = assignedGamepad.buttons[7]; // R2 / RT
                        if (rt && rt.pressed && player.fireCooldown <= 0) {
                            this.handleFire(player.id);
                        }
                    }
                } else if (player.isNPC) {
                    player.update(dt, {}, {}, this.camera, this.players, this.asteroids, [], false, this.transformationKills, this.hazards, null, this.areTransformationsEnabled(), worldRules);
                    player.resolveNPCLevelUps();
                    if (player.justPrestiged) prestigeTriggers.push(player);
                    
                    if (player.shouldTriggerBurstFire) {
                        this.handleFire(player.id, true);
                        player.shouldTriggerBurstFire = false;
                    }

                    if (player.shouldFire) {
                        this.handleFire(player.id);
                        player.shouldFire = false;
                    }
                } else {
                    // Remote player prediction
                    player.x += player.vx * dt;
                    player.y += player.vy * dt;
                    if (player.x < 0) player.x += WORLD_WIDTH;
                    if (player.x > WORLD_WIDTH) player.x -= WORLD_WIDTH;
                    if (player.y < 0) player.y += WORLD_HEIGHT;
                    if (player.y > WORLD_HEIGHT) player.y -= WORLD_HEIGHT;
                }
            } else if (player.respawnTimer > 0) {
                player.respawnTimer -= dt;
                if (player.respawnTimer <= 0) {
                    this.respawnPlayer(player);
                }
            }
        }

        for (const prestigePlayer of prestigeTriggers) {
            this.applyPrestigeShieldPulse(prestigePlayer);
            prestigePlayer.justPrestiged = false;
        }

        if (this.gameState === 'ONLINE') {
            this.network.sendState();
        }

        if (worldRules.usesRooms) {
            this.players.filter(player => !player.isDead).forEach(player => this.resolveExperimentalSlide(player));
        }

        this.asteroids.forEach(a => {
            a.previousX = a.x;
            a.previousY = a.y;
            a.update(dt, worldRules);
        });
        this.hazards.forEach(h => {
            h.previousX = h.x;
            h.previousY = h.y;
            h.update(dt, this, worldRules);
        });
        if (worldRules.usesRooms) this.resolveExperimentalEntityWalls();
        
        const activeCameras = this.getActiveCameras();
        
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            if (p.isOrbital && (!p.owner || p.owner.isEliminated || p.owner.isDead)) {
                this.removeProjectile(p);
                continue;
            }
            p.update(dt, this.asteroids, this.players, this.hazards, this.projectiles, worldRules);
            if (worldRules.usesRooms && this.resolveExperimentalProjectileWall(p)) continue;
            
            // Lasers persist only while on screen (visible in any active camera)
            if (p.isLaser) {
                let isVisible = false;
                for (let cam of activeCameras) {
                    if (cam.isPointOnScreen(p.x, p.y)) {
                        isVisible = true;
                        break;
                    }
                }
                if (!isVisible) {
                    this.removeProjectile(p);
                    continue;
                }
            }
            
            if (p.lifeSpan < 0 && !p.isOrbital) {
                this.removeProjectile(p);
                continue;
            }
        }

        for (let i = this.vfx.length - 1; i >= 0; i--) {
            const v = this.vfx[i];
            v.update(dt);
            if (v.finished) this.vfx.splice(i, 1);
        }

        // Thruster Sounds Removed

        this.checkCollisions();

        if (worldRules.usesRooms) {
            this.players.filter(player => !player.isDead && !player.isNPC)
                .forEach(player => this.resolveExperimentalPlayerRoomMembership(player));
        }

        this.reconcileArcadeNPCs();
        
        if (this.players[0]) {
            if (worldRules.usesRooms) this.camera.useDirectWorld();
            else this.camera.useWrappedWorld();
            this.camera.follow(this.players[0]);
        }
    }

    getExperimentalCollisionCategory(entity) {
        if (entity instanceof Player) {
            return entity.isNPC
                ? EXPERIMENTAL_COLLISION_CATEGORY.NPC_SHIP
                : EXPERIMENTAL_COLLISION_CATEGORY.HUMAN_PLAYER;
        }
        if (entity instanceof Asteroid) {
            if (entity.size === 'large') return EXPERIMENTAL_COLLISION_CATEGORY.LARGE_ASTEROID;
            if (entity.size === 'medium') return EXPERIMENTAL_COLLISION_CATEGORY.MEDIUM_ASTEROID;
            return EXPERIMENTAL_COLLISION_CATEGORY.SMALL_ASTEROID;
        }
        if (entity instanceof Satellite) return EXPERIMENTAL_COLLISION_CATEGORY.SATELLITE;
        if (entity instanceof SpaceDebris) return EXPERIMENTAL_COLLISION_CATEGORY.SPACE_DEBRIS;
        if (entity instanceof Projectile) {
            if (entity.isOrbital) return EXPERIMENTAL_COLLISION_CATEGORY.ORBITAL;
            if (entity.isTentacle) return EXPERIMENTAL_COLLISION_CATEGORY.TENTACLE;
            if (entity.isMissile || entity.isSkinnyMissile) return EXPERIMENTAL_COLLISION_CATEGORY.MISSILE;
            if (entity.isLaser) return EXPERIMENTAL_COLLISION_CATEGORY.LASER;
            return EXPERIMENTAL_COLLISION_CATEGORY.PROJECTILE;
        }
        return null;
    }

    getExperimentalCollisionWalls(entity) {
        const category = Game.prototype.getExperimentalCollisionCategory.call(this, entity);
        const room = Game.prototype.getExperimentalRoom.call(this, entity?.roomId) || this.experimentalRooms[0];
        const connectedDoors = (this.experimentalDoors || []).filter(door => door.roomIds.includes(room?.id));
        const adjacentDoors = category === EXPERIMENTAL_COLLISION_CATEGORY.HUMAN_PLAYER
            ? connectedDoors.filter(door => Game.prototype.isExperimentalDoorAdjacent.call(this, entity, door)) : [];
        const roomIds = new Set([room?.id]);
        adjacentDoors.forEach(door => door.roomIds.forEach(roomId => roomIds.add(roomId)));
        const walls = [];
        const seenWallIds = new Set();
        for (const roomId of roomIds) {
            const selectedRoom = Game.prototype.getExperimentalRoom.call(this, roomId);
            if (!selectedRoom) continue;
            const selectedWalls = [...selectedRoom.walls];
            for (const door of connectedDoors) {
                const owner = this.experimentalRooms.find(candidate => candidate.walls.some(wall => door.sharedWallIds.includes(wall.id)));
                if (owner) selectedWalls.push(...owner.walls.filter(wall => door.sharedWallIds.includes(wall.id)));
            }
            for (const wall of selectedWalls) {
                if (seenWallIds.has(wall.id)) continue;
                seenWallIds.add(wall.id);
                walls.push(wall);
            }
        }
        for (const door of connectedDoors) {
            if (door.blockedCategories.includes(category)) walls.push(door.blocker);
        }
        return walls;
    }

    isExperimentalDoorAdjacent(entity, door = this.experimentalDoors?.[0], otherRadius = 0) {
        if (!entity || !door) return false;
        const radius = Math.max(0, entity.radius || 0);
        const room = Game.prototype.getExperimentalRoom.call(this, entity.roomId) || this.experimentalRooms[0];
        const thickness = room?.wallCollisionThickness || 0;
        const margin = radius + Math.max(0, otherRadius) + thickness / 2 + door.transitionTolerance;
        const along = door.orientation === 'HORIZONTAL' ? entity.x : entity.y;
        const across = door.orientation === 'HORIZONTAL' ? entity.y : entity.x;
        return along >= door.openingMin - margin && along <= door.openingMax + margin
            && Math.abs(across - door.boundaryCoordinate) <= margin;
    }

    resolveExperimentalPlayerRoomMembership(player) {
        if (!player || player.isNPC) return player?.roomId || null;
        const previousRoomId = player.roomId;
        const currentRoom = Game.prototype.getExperimentalRoom.call(this, previousRoomId);
        for (const door of (this.experimentalDoors || []).filter(candidate => candidate.roomIds.includes(previousRoomId))) {
            const along = door.orientation === 'HORIZONTAL' ? player.x : player.y;
            if (along < door.openingMin || along > door.openingMax) continue;
            const candidateId = door.roomIds.find(roomId => roomId !== previousRoomId);
            const candidate = Game.prototype.getExperimentalRoom.call(this, candidateId);
            if (!currentRoom || !candidate) continue;
            const clearance = Math.max(0, player.radius || 0) + door.transitionTolerance;
            const across = door.orientation === 'HORIZONTAL' ? player.y : player.x;
            const direction = door.orientation === 'HORIZONTAL'
                ? Math.sign(candidate.bounds.top - currentRoom.bounds.top)
                : Math.sign(candidate.bounds.left - currentRoom.bounds.left);
            if ((direction > 0 && across > door.boundaryCoordinate + clearance)
                || (direction < 0 && across < door.boundaryCoordinate - clearance)) {
                player.roomId = candidateId;
                break;
            }
        }
        const nextRoom = Game.prototype.getExperimentalRoom.call(this, player.roomId);
        if (player.roomId !== previousRoomId
            && currentRoom?.roomNumber > 0
            && nextRoom?.roomNumber === 0) {
            player.clearExperimentalRoomCapsuleBonuses();
        }
        return player.roomId;
    }

    findExperimentalSweptWallHit(entity, walls, thickness) {
        if (!Number.isFinite(entity.previousX) || !Number.isFinite(entity.previousY)) return null;
        const from = { x: entity.previousX, y: entity.previousY };
        const to = { x: entity.x, y: entity.y };
        let firstHit = null;
        for (const wall of walls) {
            const hit = sweptCircleSegmentIntersection(from, to, entity.radius || 0, wall, thickness);
            if (hit && (!firstHit || hit.t < firstHit.hit.t)) firstHit = { hit, wall };
        }
        return firstHit;
    }

    resolveExperimentalSlide(entity) {
        const room = Game.prototype.getExperimentalRoom.call(this, entity.roomId) || this.experimentalRooms[0];
        if (!room) return false;
        const walls = Game.prototype.getExperimentalCollisionWalls.call(this, entity);
        let collided = false;
        const swept = Game.prototype.findExperimentalSweptWallHit.call(this, entity, walls, room.wallCollisionThickness);
        if (swept) {
            entity.x = swept.hit.x;
            entity.y = swept.hit.y;
            correctWallPenetration(entity, swept.hit, room.collisionEpsilon);
            slideVelocity(entity, swept.hit.normal);
            collided = true;
        }
        for (let pass = 0; pass < room.maxCorrectionPasses; pass++) {
            let passCollision = false;
            for (const wall of walls) {
                const contact = circleThickSegmentContact(entity, wall, room.wallCollisionThickness);
                if (!contact) continue;
                correctWallPenetration(entity, contact, room.collisionEpsilon);
                slideVelocity(entity, contact.normal);
                passCollision = true;
                collided = true;
            }
            if (!passCollision) break;
        }
        if (collided) this.audio.playSpatialUnwrapped('laser_fire', entity.x, entity.y, this.getActiveCameras());
        return collided;
    }

    resolveExperimentalEntityWalls() {
        const fallbackRoom = this.experimentalRooms[0];
        if (!fallbackRoom) return;
        const destroyedSmall = [];
        let confirmedImpact = false;
        for (const asteroid of this.asteroids) {
            const room = Game.prototype.getExperimentalRoom.call(this, asteroid.roomId) || fallbackRoom;
            const walls = Game.prototype.getExperimentalCollisionWalls.call(this, asteroid);
            const swept = Game.prototype.findExperimentalSweptWallHit.call(this, asteroid, walls, room.wallCollisionThickness);
            if (swept) {
                confirmedImpact = true;
                if (asteroid.size === 'small') {
                    destroyedSmall.push({ asteroid, replenish: swept.wall.isDoorBlocker === true });
                    continue;
                }
                asteroid.x = swept.hit.x;
                asteroid.y = swept.hit.y;
                correctWallPenetration(asteroid, swept.hit, room.collisionEpsilon);
                reflectVelocity(asteroid, swept.hit.normal);
            }
            for (const wall of walls) {
                const contact = circleThickSegmentContact(asteroid, wall, room.wallCollisionThickness);
                if (!contact) continue;
                confirmedImpact = true;
                if (asteroid.size === 'small') {
                    destroyedSmall.push({ asteroid, replenish: wall.isDoorBlocker === true });
                    break;
                }
                correctWallPenetration(asteroid, contact, room.collisionEpsilon);
                reflectVelocity(asteroid, contact.normal);
            }
        }
        for (const { asteroid, replenish } of destroyedSmall) {
            const roomId = asteroid.roomId;
            asteroid.hits = asteroid.maxHits - 1;
            this.hitTarget(asteroid, null);
            if (replenish && this.gameState === GAME_MODE.EXPERIMENTAL) this.spawnAsteroid('small', undefined, undefined, roomId);
        }
        for (const hazard of this.hazards) {
            const room = Game.prototype.getExperimentalRoom.call(this, hazard.roomId) || fallbackRoom;
            const walls = Game.prototype.getExperimentalCollisionWalls.call(this, hazard);
            const swept = Game.prototype.findExperimentalSweptWallHit.call(this, hazard, walls, room.wallCollisionThickness);
            if (swept) {
                confirmedImpact = true;
                hazard.x = swept.hit.x;
                hazard.y = swept.hit.y;
                correctWallPenetration(hazard, swept.hit, room.collisionEpsilon);
                reflectVelocity(hazard, swept.hit.normal);
            }
            for (const wall of walls) {
                const contact = circleThickSegmentContact(hazard, wall, room.wallCollisionThickness);
                if (!contact) continue;
                confirmedImpact = true;
                correctWallPenetration(hazard, contact, room.collisionEpsilon);
                reflectVelocity(hazard, contact.normal);
            }
        }
        if (confirmedImpact) {
            const impact = destroyedSmall[0]?.asteroid || this.asteroids[0] || this.hazards[0];
            if (impact) this.audio.playSpatialUnwrapped('laser_fire', impact.x, impact.y, this.getActiveCameras());
        }
    }

    resolveExperimentalProjectileWall(projectile) {
        const room = Game.prototype.getExperimentalRoom.call(this, projectile.roomId) || this.experimentalRooms[0];
        if (!room || projectile.isRemoved) return false;
        const from = { x: projectile.previousX ?? projectile.x, y: projectile.previousY ?? projectile.y };
        const to = { x: projectile.x, y: projectile.y };
        let firstHit = null;
        for (const wall of Game.prototype.getExperimentalCollisionWalls.call(this, projectile)) {
            const hit = sweptCircleSegmentIntersection(from, to, projectile.radius || 0, wall, room.wallCollisionThickness);
            if (hit && (!firstHit || hit.t < firstHit.t)) firstHit = hit;
        }
        if (!firstHit) return false;
        projectile.x = firstHit.x;
        projectile.y = firstHit.y;
        if (projectile.isMissile || projectile.isSkinnyMissile) {
            if (projectile.isSkinnyMissile) this.detonateAoEProjectile(projectile);
            else this.detonateMissile(projectile);
        }
        this.removeProjectile(projectile);
        if (!projectile.isMissile && !projectile.isSkinnyMissile) {
            this.audio.playSpatialUnwrapped('laser_fire', projectile.x, projectile.y, this.getActiveCameras());
        }
        return true;
    }

    respawnPlayer(player) {
        player.resetControllerAimLock(true);
        player.isDead = false;
        player.restoreHP();
        player.vx = 0;
        player.vy = 0;
        player.spawnImmunityTimer = 1.0; 

        // Preserve match-local capacity while restoring the Arena's respawn benefit.
        player.restoreShieldCharges(this.startingShieldCharges);

        if (this.gameState === GAME_MODE.EXPERIMENTAL) {
            const roomId = Game.prototype.getExperimentalRoom.call(this, player.roomId)?.id || this.experimentalRooms[0].id;
            const spawn = this.findExperimentalSpawn(player.radius, this.players, roomId);
            player.x = spawn.x;
            player.y = spawn.y;
            player.roomId = roomId;
            if (player.isNPC) player.rollAggression();
            return;
        }

        // Pick a spawn point far from other players
        let bestSpawn = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
        let maxMinDist = -1;

        // Test the centers of the 9x9 sectors
        for (let row = 0; row < 9; row++) {
            for (let col = 0; col < 9; col++) {
                const tx = col * DESIGN_WIDTH + DESIGN_WIDTH / 2;
                const ty = row * DESIGN_HEIGHT + DESIGN_HEIGHT / 2;
                
                let minDistToOther = Infinity;
                for (let other of this.players) {
                    if (other === player || other.isDead) continue;
                    const d = Math.hypot(other.x - tx, other.y - ty);
                    if (d < minDistToOther) minDistToOther = d;
                }

                if (minDistToOther > maxMinDist) {
                    maxMinDist = minDistToOther;
                    bestSpawn = { x: tx, y: ty };
                }
            }
        }

        player.x = bestSpawn.x;
        player.y = bestSpawn.y;

        // Re-roll NPC aggression range (1-5) on every respawn
        if (player.isNPC) {
            player.rollAggression();
        }
    }

    hitTarget(target, killer) {
        if (!target || target.isDestroyed) return;
        
        target.hits++;
        if (target.hits >= target.maxHits) {
            target.isDestroyed = true;
            for (const player of this.players) {
                if (player.lockedAimTarget === target) player.clearAimLock();
            }
            // Spatial audio
            const cameras = this.getActiveCameras();
            this.audio.playSpatial('explosion', target.x, target.y, cameras, WORLD_WIDTH, WORLD_HEIGHT);
            
            this.createExplosion(target.x, target.y, target.radius);
            
            if (target instanceof Asteroid) {
                if (target.size === 'large') {
                    this.awardXP(killer, 1);
                    for (let i = 0; i < 3; i++) this.spawnAsteroid('medium', target.x, target.y, target.roomId);
                    
                    // Queue a respawn for a new large asteroid
                    const delay = 12 + Math.random() * 32; // 12 to 44 seconds
                    Game.prototype.scheduleEnvironmentReplacement.call(this, delay, target.roomId, 'asteroids', () => {
                        this.spawnAsteroid('large', undefined, undefined, target.roomId);
                    });
                } else if (target.size === 'medium') {
                    for (let i = 0; i < 3; i++) this.spawnAsteroid('small', target.x, target.y, target.roomId);
                }

                const currentIndex = this.asteroids.indexOf(target);
                if (currentIndex !== -1) {
                    this.asteroids.splice(currentIndex, 1);
                }
            } else if (target.isDebris || target.isSatellite) {
                this.awardXP(killer, target.isSatellite ? 15 : 5);

                const currentIndex = this.hazards.indexOf(target);
                if (currentIndex !== -1) {
                    this.hazards.splice(currentIndex, 1);
                }

                // If satellite, spawn another one
                if (target.isSatellite && Game.prototype.shouldSpawnExperimentalReplacement.call(this, target.roomId, 'satellites')) {
                    this.spawnSatellite(target.roomId);
                }
                
                // If debris, maybe respawn later like asteroids
                if (target.isDebris) {
                    const delay = 30 + Math.random() * 60;
                    Game.prototype.scheduleEnvironmentReplacement.call(this, delay, target.roomId, 'debris', () => {
                        this.spawnSpaceDebris(target.roomId);
                    });
                }
                return; // Prevent kills/high-tide tracking for debris/satellites
            }
        }
    }

    removeProjectile(projectile) {
        if (!projectile || projectile.isRemoved) return false;
        const index = this.projectiles.indexOf(projectile);
        if (index === -1) return false;
        this.projectiles.splice(index, 1);
        projectile.isRemoved = true;
        this.clearAimLocksForTarget(projectile);
        return true;
    }

    clearAimLocksForTarget(target) {
        for (const player of this.players) {
            if (player.lockedAimTarget === target) player.clearAimLock();
        }
    }

    applyPrestigeShieldPulse(sourcePlayer) {
        const cameras = this.getActiveCameras();

        for (const player of this.players) {
            if (!player || player === sourcePlayer || player.isDead || player.isEliminated) continue;
            if (player.grantShieldCharge()) {
                this.audio.playSpatial('shield_hit', player.x, player.y, cameras, WORLD_WIDTH, WORLD_HEIGHT);
            }
        }
    }

    playerDeath(player, killer) {
        return Game.prototype.resolvePlayerDamage.call(this, player, 1, killer);
    }

    resolvePlayerDamage(player, amount, killer) {
        if (!player || player.isDead || player.spawnImmunityTimer > 0) return;

        const damage = Math.max(0, Math.floor(Number(amount) || 0));
        const result = { shieldsConsumed: 0, hpLost: 0, died: false };
        const cameras = this.getActiveCameras();

        for (let point = 0; point < damage && !player.isDead; point++) {
            if (player.consumeShield()) {
                result.shieldsConsumed++;
                continue;
            }

            const hpBefore = player.currentHP;
            const survived = player.takeHPDamage();
            result.hpLost += Math.max(0, hpBefore - player.currentHP);
            if (survived) continue;

            Game.prototype.confirmPlayerDeath.call(this, player, killer, cameras);
            result.died = player.isDead;
        }

        if (result.shieldsConsumed > 0) {
            this.audio.playSpatial('shield_hit', player.x, player.y, cameras, WORLD_WIDTH, WORLD_HEIGHT);
        }
        return result;
    }

    confirmPlayerDeath(player, killer, cameras = this.getActiveCameras()) {
        if (!player || player.isDead || player.currentHP > 0) return;
        player.isDead = true;
        player.cancelBurstFire();
        player.resetControllerAimLock(true);
        this.clearAimLocksForTarget(player);
        player.respawnTimer = 2;

        // Award the confirmed kill before Hardcore clears the victim's progression.
        if (killer && killer !== player && typeof killer.addCapsule === 'function') {
            if (player.isNPC) this.awardXP(killer, Game.prototype.getNPCXPReward.call(this, player));
            killer.addCapsule();
            killer.score = (killer.score || 0) + 1;
            killer.killStreak = (killer.killStreak || 0) + 1;
            if (killer.killStreak > (killer.highTide || 0)) killer.highTide = killer.killStreak;
        }

        const isArcadeHuman = this.gameState === 'ARCADE' && !player.isNPC;
        const arcadeResult = isArcadeHuman ? {
            finalLevel: player.level,
            totalXP: player.totalXP,
            totalCapsulesGained: player.totalCapsulesGained
        } : null;

        if (Game.prototype.isHardcoreActive.call(this)) player.resetLevelProgress();
        
        // Reset ALL power-up progress on death
        player.powerUpCapsules = 0;
        player.activeGun = 'Normal';
        player.ghosts = []; 
        player.hasMissile = false;
        player.restoreShieldCharges(0);
        player.history = []; // Clear history so ghosts don't snap back to old positions on respawn
        player.martianParallelGuns = 1;

        // Dying resets this ship's current kill streak AND best High Tide
        player.killStreak = 0;
        player.highTide = 0;
        
        // Spatial explosion sound
        this.audio.playSpatial('explosion', player.x, player.y, cameras, WORLD_WIDTH, WORLD_HEIGHT);
        
        this.createExplosion(player.x, player.y, 50);
        
        if (window.ProgressLogger) {
            window.ProgressLogger.logProgress('player_death');
        }

        if (this.gameState === 'ARCADE') {
            player.respawnTimer = 0;
            if (player.isNPC) {
                player.isEliminated = true;
            } else {
                this.showArcadeGameOver(arcadeResult);
            }
        }

    }

    awardXP(killer, amount) {
        if (!killer || !this.players.includes(killer) || typeof killer.addXP !== 'function') return 0;
        const levelsGained = killer.addXP(amount);
        if (killer.isNPC) killer.resolveNPCLevelUps();
        return levelsGained;
    }

    getNPCXPReward(npc) {
        if (!npc?.isNPC || !Number.isFinite(npc.level) || npc.level < 1) return 0;
        return Math.floor(npc.level) * 100;
    }

    areExperimentalEntitiesCoLocated(first, second) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL || first?.roomId === second?.roomId) return true;
        const door = this.experimentalDoors?.find(candidate =>
            candidate.roomIds.includes(first?.roomId) && candidate.roomIds.includes(second?.roomId));
        if (!door) return false;
        const human = first instanceof Player && !first.isNPC
            ? first
            : second instanceof Player && !second.isNPC ? second : null;
        const other = human === first ? second : first;
        const isAdjacentEnvironment = other instanceof Asteroid || other instanceof SpaceDebris || other instanceof Satellite;
        return Boolean(human && isAdjacentEnvironment
            && Game.prototype.isExperimentalDoorAdjacent.call(this, human, door, other?.radius || 0)
            && Game.prototype.isExperimentalDoorAdjacent.call(this, other, door, human.radius || 0));
    }

    checkCollisions() {
        // Projectiles vs Asteroids and Hazards
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            if (!p || p.isRemoved || p.hasDetonated) continue;

            // Check against Asteroids
            for (let j = this.asteroids.length - 1; j >= 0; j--) {
                const a = this.asteroids[j];
                if (!a || a.isDestroyed) continue;
                if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, p, a)) continue;
                if (checkCollision(p, a)) {
                    if (p.isMissile || p.isSkinnyMissile) {
                        if (p.isSkinnyMissile) this.detonateAoEProjectile(p);
                        else this.detonateMissile(p);
                        this.removeProjectile(p);
                    } else if (p.aoeRadius > 0 && !p.isDecoy) {
                        this.detonateAoEProjectile(p);
                        if (!p.isOrbital) this.removeProjectile(p);
                    } else {
                        // Lasers pierce through all asteroids
                        if (!p.isLaser && !p.isOrbital && !p.isTentacle) {
                            this.removeProjectile(p);
                        }
                        this.hitTarget(a, p.owner);
                    }
                    if (!p.isTentacle) break;
                }
            }

            if (p.isRemoved || p.hasDetonated) continue;

            // Check against Hazards (Space Debris and Satellites)
            for (let j = this.hazards.length - 1; j >= 0; j--) {
                const h = this.hazards[j];
                if (!h || h.isDestroyed) continue;
                if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, p, h)) continue;
                if (checkCollision(p, h)) {
                    if (p.isMissile || p.isSkinnyMissile) {
                        if (p.isSkinnyMissile) this.detonateAoEProjectile(p);
                        else this.detonateMissile(p);
                        this.removeProjectile(p);
                    } else if (p.aoeRadius > 0 && !p.isDecoy) {
                        this.detonateAoEProjectile(p);
                        if (!p.isOrbital) this.removeProjectile(p);
                    } else {
                        // Lasers pierce through all hazards (debris/satellites)
                        if (!p.isLaser && !p.isOrbital && !p.isTentacle) {
                            this.removeProjectile(p);
                        }
                        this.hitTarget(h, p.owner);
                    }
                    if (!p.isTentacle) break;
                }
            }
        }

        // Projectiles vs Players (PvP)
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            if (!p || p.isRemoved || p.hasDetonated) continue;
            for (let player of this.players) {
                if (!player || player.isDead || player.isEliminated || p.owner === player) continue;
                if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, p, player)) continue;
                if (checkCollision(p, player)) {
                    if (p.isDecoy) {
                        this.createExplosion(p.x, p.y, 60);
                        this.removeProjectile(p);
                        this.playerDeath(player, p.owner);
                    } else if (p.isMissile || p.isSkinnyMissile) {
                        if (p.isSkinnyMissile) this.detonateAoEProjectile(p);
                        else this.detonateMissile(p);
                        this.removeProjectile(p);
                    } else if (p.aoeRadius > 0) {
                        this.detonateAoEProjectile(p);
                        if (!p.isOrbital) this.removeProjectile(p);
                    } else {
                        if (!p.isLaser && !p.isOrbital && !p.isTentacle) {
                            this.removeProjectile(p);
                        } else if (p.isLaser) {
                            // Lasers are destroyed by players but pierce everything else
                            this.removeProjectile(p);
                        }
                        this.playerDeath(player, p.owner);
                    }
                    if (!p.isTentacle) break;
                }
            }
        }

        // Projectiles vs Missiles
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p1 = this.projectiles[i];
            if (!p1 || p1.isRemoved || p1.hasDetonated) continue;
            if (p1.isMissile || p1.isSkinnyMissile) {
                for (let j = this.projectiles.length - 1; j >= 0; j--) {
                    if (i === j) continue;
                    const p2 = this.projectiles[j];
                    if (!p2 || p2.isRemoved || p2.hasDetonated) continue;
                    if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, p1, p2)) continue;
                    if (p1.owner && p1.owner === p2.owner) continue;
                    if (!p2.isMissile && !p2.isSkinnyMissile && checkCollision(p1, p2)) {
                        if (p1.isSkinnyMissile) this.detonateAoEProjectile(p1);
                        else this.detonateMissile(p1);
                        this.removeProjectile(p1);
                        this.removeProjectile(p2);
                        break;
                    }
                }
            }
        }

        // Players vs Asteroids and Hazards
        this.asteroidPlayerContacts ??= new WeakMap();
        for (let player of this.players) {
            if (!player || player.isDead || player.isEliminated || (player.id !== 1 && player.id !== 2)) continue;

            // Asteroids
            for (let a of this.asteroids) {
                if (!a || a.isDestroyed) continue;
                if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, player, a)) continue;
                const contacts = this.asteroidPlayerContacts.get(a) || new Set();
                if (!checkCollision(player, a)) {
                    contacts.delete(player);
                    continue;
                }
                this.asteroidPlayerContacts.set(a, contacts);
                if (a.size !== 'small' && player.spawnImmunityTimer > 0) break;
                if (!contacts.has(player)) {
                    contacts.add(player);
                    if (a.size === 'small') {
                        // Preserve the physical impact outcome while exempting only Player damage.
                        this.hitTarget(a);
                    } else if (a.size === 'large') {
                        player.clearShieldCharges();
                        a.hits = a.maxHits - 1;
                        this.hitTarget(a);
                    } else if (a.size === 'medium') {
                        Game.prototype.resolvePlayerDamage.call(this, player, 5);
                    } else {
                        this.playerDeath(player);
                    }
                }
                break;
            }
            if (player.isDead) continue;

            // Hazards
            for (let h of this.hazards) {
                if (!h || h.isDestroyed) continue;
                if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, player, h)) continue;
                if (checkCollision(player, h)) {
                    this.playerDeath(player);
                    break;
                }
            }
            if (player.isDead) continue;
            
            // Cyborg Decoys
            for (let i = this.projectiles.length - 1; i >= 0; i--) {
                const p = this.projectiles[i];
                if (!p || p.isRemoved || p.hasDetonated) continue;
                if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, player, p)) continue;
                if (p.isDecoy && p.owner !== player && checkCollision(player, p)) {
                    this.createExplosion(p.x, p.y, 60);
                    this.removeProjectile(p);
                    this.playerDeath(player, p.owner);
                }
            }
        }
    }

    // Standard AoE projectile detonation (e.g. Cyborg Orbs)
    detonateAoEProjectile(p) {
        if (!p || p.hasDetonated) return;
        p.hasDetonated = true;

        const radius = p.aoeRadius || 60;
        const cameras = this.getActiveCameras();

        this.audio.playSpatial('explosion', p.x, p.y, cameras, WORLD_WIDTH, WORLD_HEIGHT);
        this.createExplosion(p.x, p.y, radius);

        // Check asteroids
        const impactedAsteroids = [];
        for (let j = this.asteroids.length - 1; j >= 0; j--) {
            const a = this.asteroids[j];
            if (!a || a.isDestroyed) continue;
            if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, p, a)) continue;
            const dist = Math.hypot(a.x - p.x, a.y - p.y);
            if (dist < radius + a.radius && !this.isExperimentalBlastBlocked(p, a)) {
                impactedAsteroids.push(a);
            }
        }

        for (const a of impactedAsteroids) {
            if (!a || a.isDestroyed) continue;
            // Cyborg Orbs destroy large and medium asteroids in one hit
            if (p.owner && p.owner.isCyborg) {
                a.hits = a.maxHits - 1;
            }
            this.hitTarget(a, p.owner);
        }

        // AoE missiles and other AoE projectiles also damage debris and satellites.
        // Collect first because hitTarget() may remove destroyed hazards from this.hazards.
        const impactedHazards = [];
        for (let j = this.hazards.length - 1; j >= 0; j--) {
            const h = this.hazards[j];
            if (!h || h.isDestroyed) continue;
            if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, p, h)) continue;
            const dist = Math.hypot(h.x - p.x, h.y - p.y);
            if (dist < radius + h.radius && !this.isExperimentalBlastBlocked(p, h)) {
                impactedHazards.push(h);
            }
        }

        for (const h of impactedHazards) {
            if (!h || h.isDestroyed) continue;
            this.hitTarget(h, p.owner);
        }

        // Check players
        for (let player of this.players) {
            if (player.isDead || player === p.owner) continue;
            if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, p, player)) continue;
            const dist = Math.hypot(player.x - p.x, player.y - p.y);
            if (dist < radius + player.radius && !this.isExperimentalBlastBlocked(p, player)) {
                this.playerDeath(player, p.owner);
            }
        }
    }

    // Missiles detonate with a large area-of-effect blast: asteroids are destroyed instantly,
    // debris and satellites take damage through their existing hit system, and any other
    // player caught in the radius is killed by the explosion.
    detonateMissile(missile) {
        if (!missile || missile.hasDetonated) return;
        missile.hasDetonated = true;

        const radius = missile.aoeRadius || 160;
        const cameras = this.getActiveCameras();

        this.audio.playSpatial('explosion', missile.x, missile.y, cameras, WORLD_WIDTH, WORLD_HEIGHT);
        this.createExplosion(missile.x, missile.y, radius);

        // Instantly destroy every asteroid caught in the blast radius
        const impactedAsteroids = [];
        for (let j = this.asteroids.length - 1; j >= 0; j--) {
            const a = this.asteroids[j];
            if (!a || a.isDestroyed) continue;
            if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, missile, a)) continue;
            const dist = Math.hypot(a.x - missile.x, a.y - missile.y);
            if (dist < radius + a.radius && !this.isExperimentalBlastBlocked(missile, a)) {
                impactedAsteroids.push(a);
            }
        }

        for (const a of impactedAsteroids) {
            if (!a || a.isDestroyed) continue;
            a.hits = a.maxHits - 1; // Force destruction in one shot regardless of size
            this.hitTarget(a, missile.owner);
        }

        // Damage every debris or satellite caught in the blast radius.
        // Collect first because hitTarget() may remove destroyed hazards from this.hazards.
        const impactedHazards = [];
        for (let j = this.hazards.length - 1; j >= 0; j--) {
            const h = this.hazards[j];
            if (!h || h.isDestroyed) continue;
            if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, missile, h)) continue;
            const dist = Math.hypot(h.x - missile.x, h.y - missile.y);
            if (dist < radius + h.radius && !this.isExperimentalBlastBlocked(missile, h)) {
                impactedHazards.push(h);
            }
        }

        for (const h of impactedHazards) {
            if (!h || h.isDestroyed) continue;
            this.hitTarget(h, missile.owner);
        }

        // Catch any nearby players in the blast too
        for (let player of this.players) {
            if (player.isDead || player === missile.owner) continue;
            if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, missile, player)) continue;
            const dist = Math.hypot(player.x - missile.x, player.y - missile.y);
            if (dist < radius + player.radius && !this.isExperimentalBlastBlocked(missile, player)) {
                this.playerDeath(player, missile.owner);
            }
        }
    }

    isExperimentalBlastBlocked(source, target) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return false;
        const room = Game.prototype.getExperimentalRoom.call(this, source.roomId) || this.experimentalRooms[0];
        const walls = Game.prototype.getExperimentalCollisionWalls.call(this, source)
            .filter(wall => !wall.isDoorBlocker);
        return Boolean(room && isLineBlockedByWalls(source, target, walls, room.wallCollisionThickness));
    }

    createExplosion(x, y, radius) {
        this.vfx.push({
            x, y, 
            radius: radius * 2,
            life: 1.0,
            update(dt) {
                this.life -= dt * 2;
                if (this.life <= 0) this.finished = true;
            },
            draw(ctx, assets, camera) {
                ctx.save();
                camera.apply(ctx, this.x, this.y);
                ctx.globalAlpha = Math.max(0, this.life);
                const size = this.radius * (2 - this.life);
                ctx.drawImage(assets.explosion, -size/2, -size/2, size, size);
                ctx.restore();
            }
        });
    }

    draw() {
        if (!this.assets) return;

        if (this.gameState === 'SPLASH') {
            this.drawSplash();
            return;
        }

        if (this.gameState === 'PVP') {
            this.drawSplitScreen();
        } else {
            this.drawSingleScreen();
        }

        if (this.gameState !== 'MENU') {
            this.hud.draw(
                this.ctx,
                this.players,
                this.asteroids,
                this.camera,
                this.gameState === 'PVP',
                this.swapUI,
                {
                    usesRooms: this.gameState === GAME_MODE.EXPERIMENTAL,
                    owner: this.players[0],
                    rooms: this.experimentalRooms,
                    hazards: this.hazards
                }
            );
        }

        this.drawCrosshair();
    }

    drawCrosshair() {
        if (!this.domCursor) return;
        if (!this.cursorVisible || this.shouldHideMouseCursor()) {
            this.domCursor.style.display = 'none';
            return;
        }
        
        // Sync DOM cursor color with player color
        const p1 = this.players.find(p => p.id === 1);
        this.domCursor.style.display = 'block';
        const color = (p1 && !p1.isNPC) ? p1.color : '#00ffff';
        
        this.domCursor.style.setProperty('--cursor-color', color);
        
        // Handle color-specific overrides if needed
        if (this.selectedCursorStyle === 1) {
            this.domCursor.style.borderColor = color;
            this.domCursor.style.boxShadow = `0 0 12px ${color}`;
        } else {
            this.domCursor.style.borderColor = 'transparent';
            this.domCursor.style.boxShadow = 'none';
        }
    }

    shouldHideMouseCursor() {
        const mousePlayer = this.getMouseControlledPlayer();
        const target = mousePlayer?.lockedAimTarget;
        return Boolean(
            target
            && Number.isFinite(target.x)
            && Number.isFinite(target.y)
            && this.isValidAimLockTarget(mousePlayer, target)
        );
    }

    getMouseControlledPlayer() {
        return this.players.find(player =>
            player.id === 1 && !player.isNPC && player.controlMode === 'KEYBOARD'
        ) || null;
    }

    updateCursorVisuals() {
        if (!this.domCursor) return;
        
        // Clear previous classes and lines
        this.domCursor.className = '';
        this.domCursor.classList.add(`cursor-style-${this.selectedCursorStyle}`);
        this.domCursor.innerHTML = '';
        
        // Add specific lines based on style
        switch (this.selectedCursorStyle) {
            case 0: // Standard Crosshair
                this.domCursor.innerHTML = `
                    <div class="cursor-line line-n"></div>
                    <div class="cursor-line line-s"></div>
                    <div class="cursor-line line-e"></div>
                    <div class="cursor-line line-w"></div>
                `;
                break;
            case 1: // Circle & Cross
                this.domCursor.innerHTML = `
                    <div class="cursor-line cursor-line-h"></div>
                    <div class="cursor-line cursor-line-v"></div>
                `;
                break;
            case 2: // Dot
                // Already handled by container style in CSS
                break;
            case 3: // Square Bracket
                this.domCursor.innerHTML = `
                    <div class="cursor-line cursor-tl"></div>
                    <div class="cursor-line cursor-tr"></div>
                    <div class="cursor-line cursor-bl"></div>
                    <div class="cursor-line cursor-br"></div>
                `;
                break;
            case 4: // X-Style Triangles
                this.domCursor.innerHTML = `
                    <div class="cursor-line x1"></div>
                    <div class="cursor-line x2"></div>
                    <div class="cursor-line x3"></div>
                    <div class="cursor-line x4"></div>
                `;
                break;
            case 5: // Triangles (+)
                this.domCursor.innerHTML = `
                    <div class="cursor-line t1"></div>
                    <div class="cursor-line t2"></div>
                    <div class="cursor-line t3"></div>
                    <div class="cursor-line t4"></div>
                `;
                break;
        }
    }

    drawSplash() {
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

        if (this.splashPhase === 'FADE_IN' || this.splashPhase === 'FADE_OUT') {
            this.ctx.font = 'bold 48px Orbitron';
            this.ctx.fillStyle = `rgba(255, 255, 255, ${this.splashAlpha})`;
            this.ctx.textAlign = 'center';
            this.ctx.fillText('Antique Land Games', DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
        }
    }

    drawSingleScreen() {
        this.ctx.fillStyle = '#050505';
        this.ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

        this.drawWorld(this.ctx, this.camera);
        this.drawAimLockOutline(this.ctx, this.players[0], this.camera);
    }

    drawSplitScreen() {
        const p1 = this.players[0];
        const p2 = this.players[1];

        // Left half for P1
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(0, 0, DESIGN_WIDTH / 2, DESIGN_HEIGHT);
        this.ctx.clip();
        
        this.ctx.fillStyle = '#050505';
        this.ctx.fillRect(0, 0, DESIGN_WIDTH / 2, DESIGN_HEIGHT);
        
        // P1 Camera centered in left half, zoomed out further for PVP
        const p1Cam = new Camera();
        p1Cam.zoom = this.camera.zoom * 0.8;
        p1Cam.follow(p1);
        
        // Shift drawing to left half center
        this.ctx.translate(-DESIGN_WIDTH / 4, 0); 
        this.drawWorld(this.ctx, p1Cam);
        this.drawAimLockOutline(this.ctx, p1, p1Cam);
        this.ctx.restore();

        // Right half for P2
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(DESIGN_WIDTH / 2, 0, DESIGN_WIDTH / 2, DESIGN_HEIGHT);
        this.ctx.clip();

        this.ctx.fillStyle = '#050505';
        this.ctx.fillRect(DESIGN_WIDTH / 2, 0, DESIGN_WIDTH / 2, DESIGN_HEIGHT);

        // P2 Camera centered in right half, zoomed out further for PVP
        const p2Cam = new Camera();
        p2Cam.zoom = this.camera.zoom * 0.8;
        p2Cam.follow(p2);

        this.ctx.translate(DESIGN_WIDTH / 4, 0);
        this.drawWorld(this.ctx, p2Cam);
        this.drawAimLockOutline(this.ctx, p2, p2Cam);
        this.ctx.restore();

        // Divider
        this.ctx.strokeStyle = '#00ffff';
        this.ctx.lineWidth = 4;
        this.ctx.beginPath();
        this.ctx.moveTo(DESIGN_WIDTH / 2, 0);
        this.ctx.lineTo(DESIGN_WIDTH / 2, DESIGN_HEIGHT);
        this.ctx.stroke();
    }

    drawWorld(ctx, camera) {
        this.drawBackground(ctx, camera);
        if (this.gameState === GAME_MODE.EXPERIMENTAL) this.drawExperimentalWalls(ctx, camera);

        const visible = entities => Game.prototype.getRenderableEntities.call(this, entities, camera);
        visible(this.asteroids).forEach(a => a.draw(ctx, this.assets, camera));
        visible(this.hazards).forEach(h => h.draw(ctx, this.assets, camera));
        visible(this.projectiles).forEach(p => p.draw(ctx, this.assets, camera));
        visible(this.players).forEach(p => {
            if (!p.isDead && !p.isEliminated) p.draw(ctx, this.assets, camera);
        });
        this.vfx.forEach(v => v.draw(ctx, this.assets, camera));
    }

    getRenderableEntities(entities, camera) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return entities;
        const halfWidth = DESIGN_WIDTH / (2 * camera.zoom);
        const halfHeight = DESIGN_HEIGHT / (2 * camera.zoom);
        return entities.filter(entity => {
            const radius = Math.max(0, entity.radius || 0);
            return Math.abs(entity.x - camera.x) <= halfWidth + radius
                && Math.abs(entity.y - camera.y) <= halfHeight + radius;
        });
    }

    drawExperimentalWalls(ctx, camera) {
        for (const room of this.experimentalRooms) {
            for (const wall of room.walls) {
                const dx = wall.end.x - wall.start.x;
                const dy = wall.end.y - wall.start.y;
                ctx.save();
                camera.apply(ctx, wall.start.x, wall.start.y);
                ctx.lineCap = 'round';
                ctx.shadowColor = '#00ffff';
                ctx.shadowBlur = 28;
                ctx.strokeStyle = 'rgba(0, 255, 255, 0.22)';
                ctx.lineWidth = room.wallCollisionThickness;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(dx, dy);
                ctx.stroke();
                ctx.shadowBlur = 10;
                ctx.strokeStyle = '#00ffff';
                ctx.lineWidth = room.wallVisualCoreThickness;
                ctx.stroke();
                ctx.restore();
            }
        }
    }

    drawAimLockOutline(ctx, player, camera) {
        if (!player?.aimLockActive) return;
        ctx.save();
        camera.apply(ctx, player.lockedAimTarget.x, player.lockedAimTarget.y);
        const radius = Math.max(32, player.lockedAimTarget.radius + 12);
        ctx.strokeStyle = player.color;
        ctx.lineWidth = 4 / camera.zoom;
        ctx.setLineDash([12 / camera.zoom, 8 / camera.zoom]);
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    drawBackground(ctx, camera) {
        const camX = camera.x;
        const camY = camera.y;

        // Draw Minimal Static Stars
        ctx.fillStyle = '#ffffff';
        this.stars.forEach(star => {
            let screenX = (star.x - camX);
            let screenY = (star.y - camY);
            
            if (screenX < -DESIGN_WIDTH) screenX += WORLD_WIDTH;
            if (screenX > DESIGN_WIDTH * 2) screenX -= WORLD_WIDTH;
            if (screenY < -DESIGN_HEIGHT) screenY += WORLD_HEIGHT;
            if (screenY > DESIGN_HEIGHT * 2) screenY -= WORLD_HEIGHT;

            ctx.globalAlpha = star.opacity;
            ctx.fillRect(screenX, screenY, star.size, star.size);
        });
        ctx.globalAlpha = 1.0;

        // Draw Infinite Dotted Grid Lines
        ctx.strokeStyle = 'rgba(0, 255, 255, 0.2)'; 
        ctx.lineWidth = 1;
        ctx.setLineDash([10, 10]); 

        const startX = Math.floor((camX - DESIGN_WIDTH) / DESIGN_WIDTH) * DESIGN_WIDTH;
        const startY = Math.floor((camY - DESIGN_HEIGHT) / DESIGN_HEIGHT) * DESIGN_HEIGHT;

        for (let x = startX; x <= startX + DESIGN_WIDTH * 3; x += DESIGN_WIDTH) {
            ctx.save();
            camera.apply(ctx, x, 0);
            ctx.beginPath();
            ctx.moveTo(0, -WORLD_HEIGHT * 10);
            ctx.lineTo(0, WORLD_HEIGHT * 10);
            ctx.stroke();
            ctx.restore();
        }

        for (let y = startY; y <= startY + DESIGN_HEIGHT * 3; y += DESIGN_HEIGHT) {
            ctx.save();
            camera.apply(ctx, 0, y);
            ctx.beginPath();
            ctx.moveTo(-WORLD_WIDTH * 10, 0);
            ctx.lineTo(WORLD_WIDTH * 10, 0);
            ctx.stroke();
            ctx.restore();
        }
        
        ctx.setLineDash([]); 
        ctx.globalAlpha = 1.0;
    }
}
