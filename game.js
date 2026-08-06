import { Player } from './entities/player.js';
import { Asteroid } from './entities/asteroid.js';
import { SpaceDebris, Satellite } from './entities/hazards.js';
import { Projectile } from './entities/projectile.js';
import { Camera, DEFAULT_GAMEPLAY_ZOOM } from './camera.js';
import { HUD } from './ui/hud.js';
import { AudioManager } from './audio_manager.js';
import { ExperimentalProfileStore } from './persistence/experimental_profiles.js';
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
    EXPERIMENTAL_COLLISION_CATEGORY,
    EXPERIMENTAL_SHORTCUT_ID,
    SECTOR_9_BBG_ENCOUNTER,
    getSector9BBGImageRect,
    getSector9BBGAnchorWorldPosition
} from './world/experimental_rooms.js';

export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;
export const WORLD_WIDTH = DESIGN_WIDTH * 9;
export const WORLD_HEIGHT = DESIGN_HEIGHT * 9;
export const EXPERIMENTAL_ROOM_GRID_WIDTH = 5;
export const EXPERIMENTAL_ROOM_GRID_HEIGHT = 5;
export const EXPERIMENTAL_ROOM_WIDTH = DESIGN_WIDTH * EXPERIMENTAL_ROOM_GRID_WIDTH;
export const EXPERIMENTAL_ROOM_HEIGHT = DESIGN_HEIGHT * EXPERIMENTAL_ROOM_GRID_HEIGHT;
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
export const DEFAULT_P1_CONTROL_MODE = 'KEYBOARD';

export function chooseRandomPlayerColor(random = Math.random) {
    return PLAYER_COLORS[Math.floor(random() * PLAYER_COLORS.length)];
}

export function chooseOrdinaryNPCColor(playerColor, random = Math.random, colorPool = PLAYER_COLORS) {
    const availableColors = colorPool.filter(color => color !== playerColor);
    if (availableColors.length === 0) return playerColor === '#ffffff' ? '#00ffff' : '#ffffff';
    return availableColors[Math.min(availableColors.length - 1, Math.floor(random() * availableColors.length))];
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
// Covers one high-speed projectile frame plus common sprite glow/shield overflow.
export const EXPERIMENTAL_RENDER_CULL_MARGIN = 120;
export const EXPERIMENTAL_HALLWAY_ACTIVITY_DEPTH = 1200;
const EXPERIMENTAL_SECTOR_MESSAGE_DURATION = 2.25;
const EXPERIMENTAL_OBJECTIVE_MESSAGE_DURATION = 4.5;
const CONTROLLER_AIM_DEADZONE = 0.15;
const RAY_DISTANCE_TIE_EPSILON = 0.001;
export const COMBAT_MUSIC_HOLD_DURATION = 5;
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
const VICTORY_FADE_DURATION_SECONDS = 4;
const EXPERIMENTAL_NEW_GAME_PLUS_LEVEL_STEP = 10;

export function getArenaPopulationTargets(asteroidLevel, debrisLevel, satelliteLevel) {
    return {
        asteroids: Math.max(0, Math.min(5, asteroidLevel || 0)) * 80,
        debris: DEBRIS_DENSITY_COUNTS[debrisLevel] || 0,
        satellites: SATELLITE_DENSITY_COUNTS[satelliteLevel] || 0
    };
}

export function getExperimentalPopulationTargets(asteroidLevel, debrisLevel, satelliteLevel) {
    const sharedTargets = getArenaPopulationTargets(asteroidLevel, debrisLevel, satelliteLevel);
    const areaScale = (EXPERIMENTAL_ROOM_GRID_WIDTH * EXPERIMENTAL_ROOM_GRID_HEIGHT) / (9 * 9);
    return Object.fromEntries(Object.entries(sharedTargets).map(([kind, target]) => [
        kind,
        target === 0 ? 0 : Math.max(1, Math.round(target * areaScale))
    ]));
}

export function getExperimentalRoomPopulationTargets(roomNumber, asteroidLevel, debrisLevel, satelliteLevel) {
    const targets = getExperimentalPopulationTargets(asteroidLevel, debrisLevel, satelliteLevel);
    const asteroidMultiplier = roomNumber === 7 ? 1.2 : roomNumber === 8 ? 1.4 : 1;
    return { ...targets, asteroids: Math.round(targets.asteroids * asteroidMultiplier) };
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
        this.experimentalProfiles = new ExperimentalProfileStore();
        this.selectedExperimentalProfileSlot = null;
        this.pendingExperimentalProfileSlot = null;

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
        
        // Gamepad input is opt-in from the main Options screen.
        this.gamepadEnabled = false;
        this.p1ControlMode = DEFAULT_P1_CONTROL_MODE;
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
        this.combatMusicTimer = 0;
        this.lastCombatMusicTier = null;
        this.nextArcadeNpcId = 2;
        this.experimentalNewGamePlusCycle = 0;
        this.experimentalUnlockedShortcutIds = new Set();
        this.experimentalShortcutPromptedIds = new Set();
        this.sector9BBGEncounter = this.createSector9BBGEncounterState();
        this.victoryFadeTimer = 0;
        this.victoryFadeActive = false;
        this.victoryScreenActive = false;
        this.victoryContinueConfirmationActive = false;
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
            ship: await this.loadImage('assets/ShipSketch_256x256.png'),
            ufo: await this.loadImage('assets/1000008891.png'),
            cyborg: await this.loadImage('assets/cyborg_ship.webp'),
            dimensionX: await this.loadImage('assets/dimension_x_monster.webp'),
            eventHorizon: await this.loadImage('assets/event_horizon_horror.webp'),
            asteroid: await this.loadImage('assets/asteroid.webp'),
            spaceDebris: await this.loadImage('assets/space_debris.webp'),
            satellite: await this.loadImage('assets/broken_satellite.webp'),
            projectile: await this.loadImage('assets/projectile.webp'),
            background: await this.loadImage('assets/space_background.webp'),
            explosion: await this.loadImage('assets/explosion_vfx.webp'),
            squidScenery: await this.loadImage('assets/Squid.png'),
            cranioidScenery: await this.loadImage('assets/Cranioid.png'),
            schoolDeskBackground: await this.loadImage('assets/SchoolDeskZorka5.png'),
            schoolDeskVisor: await this.loadImage('assets/SchoolDeskZorkaVisor2.png'),
            bbgScenery: await this.loadImage(SECTOR_9_BBG_ENCOUNTER.imagePath)
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
                    p.initializeNPCLevel(1);
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
                    p.initializeNPCLevel(1);
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
                p.initializeNPCLevel(1);
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
        return this.gameState === 'ARCADE'
            || (this.gameState !== GAME_MODE.EXPERIMENTAL && this.hardcoreMode);
    }

    refreshControlOptionButtons() {
        const gamepadCheckbox = document.getElementById('main-gamepad-enabled');
        if (gamepadCheckbox) {
            gamepadCheckbox.checked = this.gamepadEnabled;
            gamepadCheckbox.setAttribute('aria-checked', String(this.gamepadEnabled));
        }
    }

    getGamepads() {
        if (!this.gamepadEnabled || !navigator.getGamepads) return [];
        return navigator.getGamepads();
    }

    areTransformationsEnabled() {
        return this.gameState !== GAME_MODE.ARCADE && this.gameState !== GAME_MODE.EXPERIMENTAL;
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

    restartCurrentGameMode() {
        if (this.gameState === GAME_MODE.EXPERIMENTAL) {
            this.startExperimentalMode(null, { preserveNewGamePlusCycle: true });
            return;
        }

        if (this.gameState === GAME_MODE.ARCADE || this.gameState === 'ARCADE') {
            this.startArcadeMode();
            return;
        }

        this.startGame(this.gameState, this.players.length || 1);
    }

    startArcadeMode() {
        this.experimentalNewGamePlusCycle = 0;
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
        Game.prototype.beginGameplayMusic.call(this);
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
        Game.prototype.indexExperimentalEntity.call(this, 'hazards', debris);
    }

    spawnSatellite(roomId = null) {
        const experimentalRoomId = roomId || this.experimentalRooms?.[0]?.id;
        const spawn = this.gameState === GAME_MODE.EXPERIMENTAL
            ? this.findExperimentalSpawn(32, this.players, experimentalRoomId)
            : { x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT };
        const satellite = new Satellite(spawn.x, spawn.y);
        if (this.gameState === GAME_MODE.EXPERIMENTAL) satellite.roomId = experimentalRoomId;
        this.hazards.push(satellite);
        Game.prototype.indexExperimentalEntity.call(this, 'hazards', satellite);
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
        Game.prototype.indexExperimentalEntity.call(this, 'asteroids', asteroid);
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
            if (Game.prototype.handleLevelUpgradeKey.call(this, e.code)) {
                e.preventDefault();
                return;
            }
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
            document.getElementById('main-menu').classList.add('hidden');
            document.getElementById('arcade-menu').classList.remove('hidden');
            this.menuIndex = 0;
            this.lastActiveMenuId = 'arcade-menu';
        });
        document.getElementById('btn-arcade-play').addEventListener('click', () => {
            document.getElementById('arcade-menu').classList.add('hidden');
            this.startArcadeMode();
        });
        document.getElementById('btn-arcade-back').addEventListener('click', () => {
            document.getElementById('arcade-menu').classList.add('hidden');
            document.getElementById('main-menu').classList.remove('hidden');
            this.menuIndex = 0;
            this.lastActiveMenuId = 'main-menu';
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

        document.getElementById('btn-experimental-start').addEventListener('click', () => {
            this.showExperimentalProfileSelection();
        });
        document.getElementById('btn-experimental-profile-play').addEventListener('click', () => {
            this.playSelectedExperimentalProfile();
        });
        document.getElementById('btn-experimental-profile-change').addEventListener('click', () => {
            this.closeExperimentalProfileActions();
        });
        document.getElementById('btn-experimental-profile-delete').addEventListener('click', () => {
            this.openExperimentalProfileDeleteConfirmation();
        });
        document.getElementById('btn-profile-delete-confirm').addEventListener('click', () => {
            this.deleteSelectedExperimentalProfile();
        });
        document.getElementById('btn-profile-delete-cancel').addEventListener('click', () => {
            this.closeExperimentalProfileDeleteConfirmation();
        });
        document.getElementById('btn-experimental-profile-back').addEventListener('click', () => {
            this.hideExperimentalProfileNameEntry();
            document.getElementById('experimental-profile-menu').classList.add('hidden');
            document.getElementById('experimental-profile-actions').classList.add('hidden');
            document.getElementById('profile-delete-confirmation').classList.add('hidden');
            document.getElementById('main-menu').classList.remove('hidden');
        });
        document.getElementById('btn-experimental-profile-cancel').addEventListener('click', () => {
            this.hideExperimentalProfileNameEntry();
        });
        document.getElementById('btn-experimental-profile-create').addEventListener('click', () => {
            this.createSelectedExperimentalProfile();
        });
        document.getElementById('experimental-profile-name').addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.createSelectedExperimentalProfile();
            }
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


        document.getElementById('btn-help-open').addEventListener('click', () => {
            const optionsPopup = document.getElementById('main-options-popup');
            const helpPopup = document.getElementById('help-popup');
            optionsPopup.classList.add('hidden');
            optionsPopup.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
            helpPopup.classList.remove('hidden');
            this.setInitialMenuFocus(helpPopup, document.getElementById('btn-help-back'));
            this.menuCooldown = 0.3;
            this.lastActiveMenuId = helpPopup.id;
        });

        document.getElementById('btn-help-back').addEventListener('click', () => {
            const helpPopup = document.getElementById('help-popup');
            const optionsPopup = document.getElementById('main-options-popup');
            helpPopup.classList.add('hidden');
            helpPopup.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
            optionsPopup.classList.remove('hidden');
            this.setInitialMenuFocus(optionsPopup, document.getElementById('btn-help-open'));
            this.menuCooldown = 0.3;
            this.lastActiveMenuId = optionsPopup.id;
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

        const mainGamepadCheckbox = document.getElementById('main-gamepad-enabled');

        mainGamepadCheckbox?.addEventListener('change', (event) => {
            this.gamepadEnabled = event.currentTarget.checked;
            this.p1ControlMode = this.gamepadEnabled ? 'GAMEPAD' : 'KEYBOARD';
            this.startBtnWasPressed = false;
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
            this.restartCurrentGameMode();
        });

        document.getElementById('btn-arcade-menu').addEventListener('click', () => {
            this.openQuitConfirmation(document.getElementById('btn-arcade-menu'));
        });

        document.getElementById('btn-quit-yes').addEventListener('click', () => this.confirmQuit());
        document.getElementById('btn-quit-no').addEventListener('click', () => this.closeQuitConfirmation());
        document.getElementById('btn-victory-continue')?.addEventListener('click', () => this.openVictoryContinueConfirmation());
        document.getElementById('btn-victory-new-game-plus')?.addEventListener('click', () => this.startExperimentalNewGamePlus());
        document.getElementById('btn-victory-continue-confirm')?.addEventListener('click', () => this.confirmVictoryContinue());
        document.getElementById('btn-victory-continue-cancel')?.addEventListener('click', () => this.closeVictoryContinueConfirmation());

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
        const gamepads = this.getGamepads();
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
        if (mode !== GAME_MODE.EXPERIMENTAL) {
            this.experimentalNewGamePlusCycle = 0;
            this.clearExperimentalState();
        }
        this.gameState = mode;
        document.getElementById('menu-overlay').classList.add('hidden');
        this.closePauseMenu();
        // Clear selected buttons
        document.querySelectorAll('button.selected').forEach(btn => btn.classList.remove('selected'));
        this.spawnPlayers(mode, customShipCount);
        this.spawnInitialAsteroids();

        Game.prototype.beginGameplayMusic.call(this);
    }

    beginGameplayMusic() {
        Game.prototype.resetCombatMusicState.call(this);
        this.audio.startGameplayMusic();
    }

    resetCombatMusicState() {
        this.combatMusicTimer = 0;
        this.lastCombatMusicTier = null;
    }

    getPrimaryMusicPlayer() {
        // Local PvP intentionally uses Player 1 as its single music listener.
        return this.players.find(player => !player.isNPC && player.id === 1)
            || this.players.find(player => !player.isNPC)
            || null;
    }

    resolveCombatParticipant(source) {
        let participant = source;
        const visited = new Set();
        while (participant?.owner && participant.owner !== participant && !visited.has(participant)) {
            visited.add(participant);
            participant = participant.owner;
        }
        return participant instanceof Player ? participant : null;
    }

    refreshCombatMusicForDamage(attacker, target) {
        const resolvedAttacker = Game.prototype.resolveCombatParticipant.call(this, attacker);
        const resolvedTarget = Game.prototype.resolveCombatParticipant.call(this, target);
        const listener = Game.prototype.getPrimaryMusicPlayer.call(this);
        if (!listener || !resolvedAttacker || !resolvedTarget) return false;
        const qualifies = (resolvedAttacker === listener && resolvedTarget.isNPC)
            || (resolvedTarget === listener && resolvedAttacker.isNPC);
        if (!qualifies) return false;
        this.combatMusicTimer = COMBAT_MUSIC_HOLD_DURATION;
        return true;
    }

    getCombatMusicMix(player = Game.prototype.getPrimaryMusicPlayer.call(this)) {
        const criticalHealthActive = Boolean(player?.maxHP > 0 && player.currentHP / player.maxHP <= 0.25);
        const inCombat = this.combatMusicTimer > 0 && player && !player.isDead && !player.isEliminated;
        if (!inCombat) return { intensity: 0.85, drumsActive: false, criticalHealthActive };
        const noShields = player.shieldCharges <= 0;
        const halfHP = player.maxHP > 0 && player.currentHP / player.maxHP <= 0.5;
        return {
            intensity: noShields && halfHP ? 1.5 : noShields || halfHP ? 1.25 : 1,
            drumsActive: true,
            criticalHealthActive
        };
    }

    updateCombatMusic(dt) {
        this.combatMusicTimer = Math.max(0, (this.combatMusicTimer || 0) - Math.max(0, dt || 0));
        const mix = Game.prototype.getCombatMusicMix.call(this);
        const tier = `${mix.intensity}:${mix.drumsActive}:${mix.criticalHealthActive}`;
        if (tier === this.lastCombatMusicTier) return;
        this.lastCombatMusicTier = tier;
        this.audio.setGameplayMusicMix(mix.intensity, mix.drumsActive, mix.criticalHealthActive);
    }


    createSector9BBGEncounterState() {
        return {
            initialized: false,
            completed: false,
            victoryTransitionStarted: false,
            memberIds: new Set(),
            anchorIds: new Set(SECTOR_9_BBG_ENCOUNTER.anchors.map(anchor => anchor.id))
        };
    }

    getExperimentalEnemyLevel(baseLevel) {
        return Math.max(1, Math.floor(Number(baseLevel) || 1))
            + (this.experimentalNewGamePlusCycle || 0) * EXPERIMENTAL_NEW_GAME_PLUS_LEVEL_STEP;
    }

    isHumanPlayerEntity(entity) {
        return entity instanceof Player && !entity.isNPC && !entity.isDead && !entity.isEliminated;
    }

    isSector9BBGDefender(entity) {
        return entity instanceof Player && entity.isSector9BBGEncounterNPC === true;
    }

    getSector9BBGRoom() {
        return (this.experimentalRooms || []).find(room => room.roomNumber === SECTOR_9_BBG_ENCOUNTER.roomNumber) || null;
    }

    allowsOrdinaryExperimentalNPCPopulation(roomOrId) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return true;
        const room = typeof roomOrId === 'string'
            ? Game.prototype.getExperimentalRoom.call(this, roomOrId)
            : roomOrId;
        return Boolean(room?.isPopulationEligible && room.ordinaryNPCsAllowed !== false);
    }

    removeStaleOrdinaryExperimentalNPCsFromBlockedRooms() {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return 0;
        let removed = 0;
        for (const player of [...this.players]) {
            if (!player?.isNPC || Game.prototype.isSector9BBGDefender.call(this, player)) continue;
            if (Game.prototype.allowsOrdinaryExperimentalNPCPopulation.call(this, player.roomId)) continue;
            Game.prototype.unindexExperimentalEntity.call(this, 'players', player);
            const index = this.players.indexOf(player);
            if (index !== -1) {
                this.players.splice(index, 1);
                removed++;
            }
        }
        return removed;
    }

    getSector9BBGAnchorWorldPosition(anchor) {
        return getSector9BBGAnchorWorldPosition(Game.prototype.getSector9BBGRoom.call(this), anchor);
    }

    spawnSector9BBGEncounter() {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return false;
        const state = this.sector9BBGEncounter || Game.prototype.createSector9BBGEncounterState.call(this);
        this.sector9BBGEncounter = state;
        if (state.initialized) return false;
        const room = Game.prototype.getSector9BBGRoom.call(this);
        if (!room) return false;
        let nextNpcId = Math.max(1, ...this.players.map(player => player.id || 0)) + 1;
        for (const anchor of SECTOR_9_BBG_ENCOUNTER.anchors) {
            const position = getSector9BBGAnchorWorldPosition(room, anchor);
            if (!position) continue;
            const npc = new Player(position.x, position.y, nextNpcId++, chooseRandomPlayerColor());
            if (typeof this.configurePlayerShields === 'function') this.configurePlayerShields(npc);
            npc.isNPC = true;
            npc.name = `BBG DEFENDER ${anchor.label || anchor.id}`;
            npc.roomId = room.id;
            npc.isSector9BBGEncounterNPC = true;
            npc.sector9BBGEncounterId = SECTOR_9_BBG_ENCOUNTER.id;
            npc.sector9BBGAnchorId = anchor.id;
            npc.isFixedPositionNPC = true;
            npc.playerOnlyDamageTarget = true;
            npc.noRespawn = true;
            npc.fixedAnchorX = position.x;
            npc.fixedAnchorY = position.y;
            npc.aggressionLevel = SECTOR_9_BBG_ENCOUNTER.npcAggressionLevel;
            npc.rollAccuracy();
            npc.initializeNPCLevel(Game.prototype.getExperimentalEnemyLevel.call(this, SECTOR_9_BBG_ENCOUNTER.baseNpcLevel));
            npc.applyRandomCapsulePowerUps(Math.floor(npc.level * 0.75));
            this.players.push(npc);
            Game.prototype.indexExperimentalEntity.call(this, 'players', npc);
            state.memberIds.add(npc.id);
        }
        state.initialized = true;
        state.completed = false;
        state.victoryTransitionStarted = false;
        return true;
    }

    resetSector9BBGEncounterForCurrentWorld() {
        for (const player of [...this.players]) {
            if (!Game.prototype.isSector9BBGDefender.call(this, player)) continue;
            Game.prototype.unindexExperimentalEntity.call(this, 'players', player);
            const index = this.players.indexOf(player);
            if (index !== -1) this.players.splice(index, 1);
        }
        this.sector9BBGEncounter = Game.prototype.createSector9BBGEncounterState.call(this);
        return Game.prototype.spawnSector9BBGEncounter.call(this);
    }

    resolveDamageOwner(source) {
        if (!source) return null;
        if (source.owner && source.owner !== source) return Game.prototype.resolveDamageOwner.call(this, source.owner);
        return source;
    }

    canDamagePlayerTarget(target, source) {
        if (!Game.prototype.isSector9BBGDefender.call(this, target)) return true;
        return Game.prototype.isHumanPlayerEntity.call(this, Game.prototype.resolveDamageOwner.call(this, source));
    }

    checkSector9BBGEncounterCompletion() {
        const state = this.sector9BBGEncounter;
        if (this.gameState !== GAME_MODE.EXPERIMENTAL || !state?.initialized || state.victoryTransitionStarted) return false;
        const remaining = this.players.some(player => Game.prototype.isSector9BBGDefender.call(this, player)
            && !player.isDead && !player.isEliminated);
        if (remaining) return false;
        state.completed = true;
        state.victoryTransitionStarted = true;
        Game.prototype.beginSector9VictoryTransition.call(this);
        return true;
    }

    beginSector9VictoryTransition() {
        this.victoryFadeTimer = 0;
        this.victoryFadeActive = true;
        this.victoryScreenActive = false;
        this.victoryContinueConfirmationActive = false;
        this.resetLockInputs();
        this.mouse.clicked = false;
        this.players.forEach(player => { player.shouldFire = false; player.clearAimLock?.(); });
        this.audio.stopGameplayMusic?.();
        this.audio.play?.('victory_sfx');
        this.audio.startBGM?.('victory_music');
    }

    showVictoryScreen() {
        this.victoryFadeActive = false;
        this.victoryScreenActive = true;
        document.getElementById('victory-screen')?.classList.remove('hidden');
        document.getElementById('victory-continue-confirmation')?.classList.add('hidden');
        this.menuIndex = 0;
        this.lastActiveMenuId = 'victory-screen';
        this.setInitialMenuFocus(document.getElementById('victory-screen'));
    }

    hideVictoryScreen() {
        this.victoryFadeActive = false;
        this.victoryScreenActive = false;
        this.victoryContinueConfirmationActive = false;
        if (typeof document !== 'undefined') {
            document.getElementById('victory-screen')?.classList.add('hidden');
            document.getElementById('victory-continue-confirmation')?.classList.add('hidden');
        }
    }

    openVictoryContinueConfirmation() {
        this.victoryContinueConfirmationActive = true;
        document.getElementById('victory-continue-confirmation')?.classList.remove('hidden');
        this.menuIndex = 0;
        this.lastActiveMenuId = 'victory-continue-confirmation';
        this.setInitialMenuFocus(document.getElementById('victory-continue-confirmation'));
    }

    closeVictoryContinueConfirmation() {
        this.victoryContinueConfirmationActive = false;
        document.getElementById('victory-continue-confirmation')?.classList.add('hidden');
        this.menuIndex = 0;
        this.lastActiveMenuId = 'victory-screen';
        this.setInitialMenuFocus(document.getElementById('victory-screen'));
    }

    confirmVictoryContinue() {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return false;
        Game.prototype.hideVictoryScreen.call(this);
        this.audio.stopBGM?.();
        Game.prototype.resetSector9BBGEncounterForCurrentWorld.call(this);
        const human = this.players.find(player => !player.isNPC && !player.isDead && !player.isEliminated);
        if (human) {
            const defenders = this.players.filter(player => Game.prototype.isSector9BBGDefender.call(this, player));
            const unsafe = defenders.some(defender => Math.hypot(defender.x - human.x, defender.y - human.y) < defender.radius + human.radius + 80);
            if (unsafe) {
                const room = Game.prototype.getExperimentalRoom.call(this, human.roomId) || Game.prototype.getSector9BBGRoom.call(this);
                const spawn = Game.prototype.findExperimentalSpawn.call(this, human.radius, this.players.filter(player => player !== human), room?.id);
                Game.prototype.unindexExperimentalEntity.call(this, 'players', human);
                human.x = spawn.x; human.y = spawn.y; human.roomId = room?.id || human.roomId;
                Game.prototype.indexExperimentalEntity.call(this, 'players', human);
            }
        }
        Game.prototype.beginGameplayMusic.call(this);
        this.resetMouseLockInput();
        return true;
    }

    startExperimentalNewGamePlus() {
        const profile = Number.isInteger(this.selectedExperimentalProfileSlot)
            ? this.experimentalProfiles.getProfile(this.selectedExperimentalProfileSlot)
            : null;
        if (!profile) return false;
        this.experimentalUnlockedShortcutIds = new Set();
        this.experimentalNewGamePlusCycle = Math.max(0, profile.newGamePlusCycle || 0) + 1;
        const updatedProfile = this.experimentalProfiles.updateProfile(this.selectedExperimentalProfileSlot, {
            ...profile,
            newGamePlusCycle: this.experimentalNewGamePlusCycle,
            unlockedShortcutIds: []
        });
        Game.prototype.hideVictoryScreen.call(this);
        return this.startExperimentalMode(updatedProfile);
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
        this.experimentalEncounterStates = new Map();
        this.experimentalSessionId = (this.experimentalSessionId || 0) + 1;
        this.experimentalRoomAssignments = new Map();
        this.experimentalAreaIndexes = new Map();
        this.experimentalCameraState = null;
        this.experimentalSectorMessage = null;
        this.experimentalObjectiveMessage = null;
        this.experimentalShortcutPromptedIds = new Set();
        this.experimentalDialogueState = {
            completedSequenceIds: new Set(),
            activeSequenceId: null,
            activeElapsed: 0
        };
        this.sector9BBGEncounter = Game.prototype.createSector9BBGEncounterState.call(this);
        this.victoryFadeTimer = 0;
        this.victoryFadeActive = false;
        this.victoryScreenActive = false;
        this.victoryContinueConfirmationActive = false;
        if (typeof document !== 'undefined') {
            document.getElementById('victory-screen')?.classList.add('hidden');
            document.getElementById('victory-continue-confirmation')?.classList.add('hidden');
        }
    }

    initializeExperimentalRooms() {
        this.experimentalRooms = createExperimentalAreas(EXPERIMENTAL_ROOM_WIDTH, EXPERIMENTAL_ROOM_HEIGHT);
        this.experimentalDoors = createExperimentalDoors(this.experimentalRooms);
        Game.prototype.initializeExperimentalAreaIndexes.call(this);
        Game.prototype.initializeExperimentalEncounterStates.call(this);
        this.experimentalRoomPopulations = new Map(this.experimentalRooms.filter(room => room.isPopulationEligible).map(room => [room.id, {
            density: Object.freeze({
                asteroidLevel: this.asteroidDensityLevel,
                debrisLevel: this.debrisDensityLevel,
                satelliteLevel: this.satelliteDensityLevel
            }),
            desired: Object.freeze(getExperimentalRoomPopulationTargets(
                room.roomNumber,
                this.asteroidDensityLevel,
                this.debrisDensityLevel,
                this.satelliteDensityLevel
            ))
        }]));
    }

    initializeExperimentalEncounterStates() {
        this.experimentalEncounterStates = new Map();
        for (const room of (this.experimentalRooms || []).filter(area => area.roomNumber > 0
            && area.roomNumber < SECTOR_9_BBG_ENCOUNTER.roomNumber && area.ordinaryNPCsAllowed !== false)) {
            const hallway = this.experimentalRooms.find(area => area.roomNumber === 0
                && area.connectedAreaIds?.includes(room.id)
                && area.connectedAreaIds?.includes(`experimental-room-${room.roomNumber + 1}`));
            const progressionDoor = hallway && this.experimentalDoors.find(door =>
                door.roomIds.includes(room.id) && door.roomIds.includes(hallway.id));
            this.experimentalEncounterStates.set(room.id, {
                roomId: room.id, encounterCleared: false, doorUnlocked: false, populationSpawned: false,
                npcCount: room.npcCount, npcLevel: room.npcLevel,
                requiredPlayerKills: room.npcCount, playerCreditedKills: 0,
                progressionDoorId: progressionDoor?.id || null,
                progressionHallwayId: hallway?.id || null
            });
        }
        return this.experimentalEncounterStates;
    }

    getExperimentalEncounterState(roomId) {
        return this.experimentalEncounterStates?.get(roomId) || null;
    }

    isExperimentalProgressionDoorLocked(door) {
        if (!door) return false;
        const encounter = [...(this.experimentalEncounterStates?.values() || [])]
            .find(state => state.progressionDoorId === door.id);
        return Boolean(encounter && !encounter.doorUnlocked);
    }

    isExperimentalShortcutUnlocked(shortcutId) {
        return Boolean(shortcutId && this.experimentalUnlockedShortcutIds?.has(shortcutId));
    }

    isExperimentalShortcutDoorLocked(door) {
        return door?.shortcutRole === 'LOCKED_SOURCE'
            && !Game.prototype.isExperimentalShortcutUnlocked.call(this, door.shortcutId);
    }

    unlockExperimentalShortcut(shortcutId, player) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL || !player || player.isNPC
            || !Object.values(EXPERIMENTAL_SHORTCUT_ID).includes(shortcutId)
            || Game.prototype.isExperimentalShortcutUnlocked.call(this, shortcutId)) return false;
        this.experimentalUnlockedShortcutIds.add(shortcutId);
        Game.prototype.saveExperimentalProfile.call(this, player);
        this.experimentalObjectiveMessage = {
            lines: ['Shortcut to Sector 1 opened.'],
            remaining: EXPERIMENTAL_OBJECTIVE_MESSAGE_DURATION
        };
        return true;
    }

    updateExperimentalShortcutInteractions(player) {
        if (!player || player.isNPC || player.isDead) return false;
        let changed = false;
        const adjacentLockedIds = new Set();
        for (const door of this.experimentalDoors || []) {
            if (!door.shortcutId || !door.roomIds.includes(player.roomId)
                || !Game.prototype.isExperimentalDoorAdjacent.call(this, player, door, 80)) continue;
            if (door.shortcutRole === 'UNLOCKING_DESTINATION') {
                changed = Game.prototype.unlockExperimentalShortcut.call(this, door.shortcutId, player) || changed;
            } else if (Game.prototype.isExperimentalShortcutDoorLocked.call(this, door)) {
                adjacentLockedIds.add(door.shortcutId);
                if (!this.experimentalShortcutPromptedIds?.has(door.shortcutId)) {
                    this.experimentalShortcutPromptedIds ||= new Set();
                    this.experimentalShortcutPromptedIds.add(door.shortcutId);
                    this.experimentalObjectiveMessage = {
                        lines: [door.sourceMessage],
                        remaining: EXPERIMENTAL_OBJECTIVE_MESSAGE_DURATION
                    };
                }
            }
        }
        for (const shortcutId of this.experimentalShortcutPromptedIds || []) {
            if (!adjacentLockedIds.has(shortcutId)) this.experimentalShortcutPromptedIds.delete(shortcutId);
        }
        return changed;
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
                hasHumanInArea: roomId => Game.prototype.hasHumanInExperimentalArea.call(this, roomId),
                getWallsFor: entity => Game.prototype.getExperimentalCollisionWalls.call(this, entity)
            };
        }
        return { wrap: true, usesRooms: false, camera: 'WRAP', spawn: 'GLOBAL', room: null };
    }

    getExperimentalRoom(roomId) {
        return this.experimentalRooms.find(room => room.id === roomId) || null;
    }

    initializeExperimentalAreaIndexes() {
        this.experimentalAreaIndexes = new Map((this.experimentalRooms || []).map(area => [area.id, {
            players: new Set(), asteroids: new Set(), hazards: new Set(), projectiles: new Set(), vfx: new Set()
        }]));
    }

    indexExperimentalEntity(kind, entity) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL || !entity?.roomId) return;
        this.experimentalAreaIndexes?.get(entity.roomId)?.[kind]?.add(entity);
    }

    unindexExperimentalEntity(kind, entity, roomId = entity?.roomId) {
        this.experimentalAreaIndexes?.get(roomId)?.[kind]?.delete(entity);
    }

    getExperimentalAreaEntities(roomId, kind) {
        const indexed = this.experimentalAreaIndexes?.get(roomId)?.[kind];
        if (indexed) return Array.from(indexed);
        return Array.from(this?.[kind] || []).filter(entity => entity.roomId === roomId);
    }

    getExperimentalCandidates(entity, kind, canonical) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return canonical;
        const candidates = Game.prototype.getExperimentalAreaEntities.call(this, entity?.roomId, kind);
        if (entity instanceof Player && !entity.isNPC) {
            for (const door of this.experimentalDoors || []) {
                if (!door.roomIds.includes(entity.roomId)
                    || !Game.prototype.isExperimentalDoorAdjacent.call(this, entity, door)) continue;
                const adjacentId = door.roomIds.find(roomId => roomId !== entity.roomId);
                candidates.push(...Game.prototype.getExperimentalAreaEntities.call(this, adjacentId, kind));
            }
        }
        return [...new Set(candidates)];
    }

    isHostileTarget(attacker, candidate) {
        if (!attacker || !candidate || attacker === candidate || candidate.isDead || candidate.isEliminated) {
            return false;
        }

        // BBG defenders can only be targeted by a living human player.
        if (candidate.isSector9BBGEncounterNPC) {
            return Game.prototype.isHumanPlayerEntity.call(this, attacker);
        }

        // BBG defenders target human players only, never other NPCs.
        if (attacker.isSector9BBGEncounterNPC && candidate.isNPC) {
            return false;
        }

        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return true;
        if (attacker.roomId !== candidate.roomId) return false;
        if (!attacker.isNPC || !candidate.isNPC) return true;
        return attacker.color !== candidate.color;
    }

    hasHumanInExperimentalArea(roomId) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return true;
        const indexed = this.experimentalAreaIndexes?.has(roomId)
            ? Game.prototype.getExperimentalAreaEntities.call(this, roomId, 'players')
            : (this.players || []).filter(player => player.roomId === roomId);
        if (indexed.some(player => !player.isNPC && !player.isDead && !player.isEliminated)) return true;

        const area = Game.prototype.getExperimentalRoom.call(this, roomId);
        if (!area || area.roomNumber <= 0) return false;
        return (this.players || []).some(player => {
            if (player.isNPC || player.isDead || player.isEliminated) return false;
            const hallway = Game.prototype.getExperimentalRoom.call(this, player.roomId);
            if (!hallway || hallway.roomNumber !== 0 || !hallway.connectedAreaIds.includes(area.id)) return false;
            return Game.prototype.getExperimentalHallwayDepthFromArea.call(this, player, hallway, area)
                <= EXPERIMENTAL_HALLWAY_ACTIVITY_DEPTH;
        });
    }

    handleLevelUpgradeKey(code) {
        const choices = {
            Digit1: 'projectile', Numpad1: 'projectile',
            Digit2: 'speed', Numpad2: 'speed',
            Digit3: 'shield', Numpad3: 'shield'
        };
        const choice = choices[code];
        if (!choice || !this.isInGameplayState() || this.isPauseMenuOpen || this.activeModal) return false;
        const player = this.players.find(candidate => !candidate.isNPC && candidate.controlMode === 'KEYBOARD');
        if (!player || player.isDead || player.pendingLevelUps <= 0) return false;
        player.applyLevelUpgrade(choice);
        return true;
    }

    addProjectile(projectile) {
        this.projectiles.push(projectile);
        Game.prototype.indexExperimentalEntity.call(this, 'projectiles', projectile);
        return projectile;
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
            const spawn = {
                x: (room.bounds.left + room.bounds.right) / 2,
                y: (room.bounds.top + room.bounds.bottom) / 2
            };
            player.x = spawn.x;
            player.y = spawn.y;
            player.roomId = room.id;
            player.experimentalLastCombatRoomId = room.id;
            Game.prototype.indexExperimentalEntity.call(this, 'players', player);
            placedPlayers.push(player);
        });
        for (const npcRoom of this.experimentalRooms.filter(area => Game.prototype.allowsOrdinaryExperimentalNPCPopulation.call(this, area))) {
            Game.prototype.spawnOrdinaryExperimentalRoomNPCs.call(this, npcRoom.id, placedPlayers);
        }
        Game.prototype.spawnSector9BBGEncounter.call(this);
        Game.prototype.removeStaleOrdinaryExperimentalNPCsFromBlockedRooms.call(this);
        this.asteroids = [];
        this.hazards = [];
        for (const populationRoom of this.experimentalRooms.filter(area => area.isPopulationEligible)) {
            const targets = this.experimentalRoomPopulations?.get(populationRoom.id)?.desired
                || getExperimentalRoomPopulationTargets(populationRoom.roomNumber,
                    this.asteroidDensityLevel, this.debrisDensityLevel, this.satelliteDensityLevel);
            for (let index = 0; index < targets.asteroids; index++) this.spawnAsteroid('large', undefined, undefined, populationRoom.id);
            for (let index = 0; index < targets.debris; index++) this.spawnSpaceDebris(populationRoom.id);
            for (let index = 0; index < targets.satellites; index++) this.spawnSatellite(populationRoom.id);
        }
    }

    spawnOrdinaryExperimentalRoomNPCs(roomId, placedPlayers = this.players, spawnCount = null) {
        const room = Game.prototype.getExperimentalRoom.call(this, roomId);
        if (!room || !Game.prototype.allowsOrdinaryExperimentalNPCPopulation.call(this, room)
            || room.roomNumber >= SECTOR_9_BBG_ENCOUNTER.roomNumber) return [];
        const encounter = Game.prototype.getExperimentalEncounterState.call(this, room.id);
        const count = spawnCount === null ? (encounter?.npcCount ?? room.npcCount) : Math.max(0, spawnCount);
        let nextNpcId = Math.max(1, ...this.players.map(player => player.id || 0)) + 1;
        const spawned = [];
        const humanColor = this.players.find(player => !player.isNPC)?.color;
        for (let index = 0; index < count; index++) {
            const spawn = Game.prototype.findExperimentalSpawn.call(this, 25, placedPlayers, room.id);
            const npc = new Player(spawn.x, spawn.y, nextNpcId++, chooseOrdinaryNPCColor(humanColor));
            if (typeof this.configurePlayerShields === 'function') this.configurePlayerShields(npc);
            npc.isNPC = true;
            npc.name = `ROOM ${room.roomNumber} BOT ${index + 1}`;
            npc.roomId = room.id;
            npc.isOrdinaryExperimentalNPC = true;
            npc.noRespawn = true;
            if (this.botAggressionLevel > 0) {
                npc.aggressionLevel = this.botAggressionLevel;
                npc.rollAccuracy();
            } else npc.rollAggression();
            npc.initializeNPCLevel(Game.prototype.getExperimentalEnemyLevel.call(this, encounter?.npcLevel ?? room.npcLevel));
            npc.applyOrdinaryNPCCapsulePowerUps(Math.floor(npc.level * 0.75));
            this.players.push(npc);
            Game.prototype.indexExperimentalEntity.call(this, 'players', npc);
            if (placedPlayers !== this.players) placedPlayers.push(npc);
            spawned.push(npc);
        }
        if (encounter) encounter.populationSpawned = true;
        return spawned;
    }

    isLivingOrdinaryExperimentalRoomEnemy(player, roomId = player?.roomId) {
        return this.gameState === GAME_MODE.EXPERIMENTAL && player instanceof Player && player.isNPC
            && player.isOrdinaryExperimentalNPC === true && player.roomId === roomId
            && !player.isDead && !player.isEliminated;
    }

    resolveExperimentalHumanKillCredit(victim, source) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL || !victim?.isOrdinaryExperimentalNPC) return null;
        const killer = Game.prototype.resolveCombatParticipant.call(this, source);
        if (!killer || killer === victim || killer.isNPC || !this.players.includes(killer)) return null;
        return killer;
    }

    resolveExperimentalOrdinaryNPCDeath(deadNPC, source) {
        if (!deadNPC?.isOrdinaryExperimentalNPC) return false;
        const encounter = Game.prototype.getExperimentalEncounterState.call(this, deadNPC.roomId);
        if (!encounter) return false;
        const credited = Boolean(Game.prototype.resolveExperimentalHumanKillCredit.call(this, deadNPC, source));

        Game.prototype.unindexExperimentalEntity.call(this, 'players', deadNPC);
        const deadIndex = this.players.indexOf(deadNPC);
        if (deadIndex !== -1) this.players.splice(deadIndex, 1);

        if (!credited) {
            if (!encounter.doorUnlocked) {
                Game.prototype.spawnOrdinaryExperimentalRoomNPCs.call(this, deadNPC.roomId, this.players, 1);
            }
            return false;
        }

        encounter.playerCreditedKills = Math.min(
            encounter.requiredPlayerKills,
            encounter.playerCreditedKills + 1
        );
        if (encounter.doorUnlocked || encounter.playerCreditedKills < encounter.requiredPlayerKills) return false;
        encounter.encounterCleared = true;
        encounter.doorUnlocked = true;
        encounter.populationSpawned = false;
        this.experimentalObjectiveMessage = { lines: ['Hallway opened!'], remaining: EXPERIMENTAL_OBJECTIVE_MESSAGE_DURATION };
        return true;
    }

    resetExperimentalRoomEncounter(roomId) {
        const encounter = Game.prototype.getExperimentalEncounterState.call(this, roomId);
        if (!encounter) return [];
        for (const npc of [...this.players]) {
            if (!npc?.isOrdinaryExperimentalNPC || npc.roomId !== roomId) continue;
            Game.prototype.unindexExperimentalEntity.call(this, 'players', npc);
            this.players.splice(this.players.indexOf(npc), 1);
        }
        encounter.populationSpawned = false;
        return Game.prototype.spawnOrdinaryExperimentalRoomNPCs.call(this, roomId, this.players);
    }

    getExperimentalRoomPopulation(roomId) {
        const desired = this.experimentalRoomPopulations?.get(roomId)?.desired || { asteroids: 0, debris: 0, satellites: 0 };
        const asteroids = Game.prototype.getExperimentalAreaEntities.call(this, roomId, 'asteroids');
        const hazards = Game.prototype.getExperimentalAreaEntities.call(this, roomId, 'hazards');
        return {
            desired,
            live: {
                asteroids: asteroids.filter(asteroid => !asteroid.isDestroyed).length,
                largeAsteroids: asteroids.filter(asteroid => !asteroid.isDestroyed && asteroid.size === 'large').length,
                debris: hazards.filter(hazard => !hazard.isDestroyed && hazard.isDebris).length,
                satellites: hazards.filter(hazard => !hazard.isDestroyed && hazard.isSatellite).length
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

    showExperimentalProfileSelection(message = '') {
        this.selectedExperimentalProfileSlot = null;
        this.pendingExperimentalProfileSlot = null;
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('experimental-profile-menu').classList.remove('hidden');
        this.hideExperimentalProfileNameEntry();
        this.renderExperimentalProfileSlots();
        this.closeExperimentalProfileActions();
        document.getElementById('experimental-profile-error').textContent = message;
        this.menuIndex = 0;
        this.lastActiveMenuId = 'experimental-profile-menu';
    }

    renderExperimentalProfileSlots() {
        const container = document.getElementById('experimental-profile-slots');
        container.replaceChildren();
        this.experimentalProfiles.getSummaries().forEach((summary, slot) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'menu-button profile-slot';
            button.dataset.profileSlot = String(slot);
            button.classList.toggle('selected', slot === this.selectedExperimentalProfileSlot);
            if (summary) {
                const name = document.createElement('span');
                name.className = 'profile-slot-name';
                name.textContent = summary.name;
                const level = document.createElement('span');
                level.className = 'profile-slot-level';
                level.textContent = `Lvl ${summary.level}`;
                button.append(name, level);
                button.addEventListener('click', () => this.selectExperimentalProfile(slot));
            } else {
                button.textContent = 'New Profile';
                button.addEventListener('click', () => this.showExperimentalProfileNameEntry(slot));
            }
            container.appendChild(button);
        });
    }

    showExperimentalProfileNameEntry(slot) {
        this.pendingExperimentalProfileSlot = slot;
        document.getElementById('experimental-profile-slots').classList.add('hidden');
        document.querySelector('.profile-menu-actions').classList.add('hidden');
        document.getElementById('experimental-profile-name-entry').classList.remove('hidden');
        const input = document.getElementById('experimental-profile-name');
        input.value = '';
        document.getElementById('experimental-profile-error').textContent = '';
        input.focus();
    }

    hideExperimentalProfileNameEntry() {
        this.pendingExperimentalProfileSlot = null;
        document.getElementById('experimental-profile-name-entry').classList.add('hidden');
        document.getElementById('experimental-profile-slots').classList.remove('hidden');
        document.querySelector('.profile-menu-actions').classList.remove('hidden');
    }

    createSelectedExperimentalProfile() {
        const slot = this.pendingExperimentalProfileSlot;
        const input = document.getElementById('experimental-profile-name');
        try {
            this.experimentalProfiles.createProfile(slot, input.value);
            this.hideExperimentalProfileNameEntry();
            this.selectedExperimentalProfileSlot = slot;
            this.renderExperimentalProfileSlots();
            this.openExperimentalProfileActions();
        } catch (error) {
            document.getElementById('experimental-profile-error').textContent = error.message;
        }
    }

    selectExperimentalProfile(slot) {
        const profile = this.experimentalProfiles.getProfile(slot);
        if (!profile) {
            console.warn('[Zorka] The selected Experimental profile is no longer available.');
            this.showExperimentalProfileSelection('Profile unavailable. Select another slot.');
            return false;
        }
        this.selectedExperimentalProfileSlot = slot;
        this.renderExperimentalProfileSlots();
        document.getElementById('experimental-profile-error').textContent = '';
        this.openExperimentalProfileActions();
        return true;
    }

    openExperimentalProfileActions() {
        const slot = this.selectedExperimentalProfileSlot;
        const profile = Number.isInteger(slot) ? this.experimentalProfiles.getProfile(slot) : null;
        if (!profile) return false;
        document.getElementById('experimental-profile-actions-title').textContent = profile.name;
        document.getElementById('experimental-profile-actions').classList.remove('hidden');
        return true;
    }

    closeExperimentalProfileActions() {
        document.getElementById('experimental-profile-actions').classList.add('hidden');
    }

    playSelectedExperimentalProfile() {
        const slot = this.selectedExperimentalProfileSlot;
        const profile = Number.isInteger(slot) ? this.experimentalProfiles.getProfile(slot) : null;
        if (!profile) {
            this.showExperimentalProfileSelection('Select a profile to begin.');
            return false;
        }
        this.closeExperimentalProfileActions();
        return this.startExperimentalMode(profile);
    }

    openExperimentalProfileDeleteConfirmation() {
        const slot = this.selectedExperimentalProfileSlot;
        const profile = Number.isInteger(slot) ? this.experimentalProfiles.getProfile(slot) : null;
        if (!profile) return false;
        document.getElementById('profile-delete-confirmation-message').textContent = 'Are you sure?';
        document.getElementById('experimental-profile-actions').classList.add('hidden');
        document.getElementById('profile-delete-confirmation').classList.remove('hidden');
        return true;
    }

    closeExperimentalProfileDeleteConfirmation() {
        document.getElementById('profile-delete-confirmation').classList.add('hidden');
        this.openExperimentalProfileActions();
    }

    deleteSelectedExperimentalProfile() {
        const slot = this.selectedExperimentalProfileSlot;
        if (!Number.isInteger(slot)) return false;
        try {
            this.experimentalProfiles.deleteProfile(slot);
            this.selectedExperimentalProfileSlot = null;
            this.closeExperimentalProfileDeleteConfirmation();
            this.renderExperimentalProfileSlots();
            document.getElementById('experimental-profile-actions').classList.add('hidden');
            document.getElementById('experimental-profile-error').textContent = 'Profile deleted.';
            return true;
        } catch (error) {
            this.closeExperimentalProfileDeleteConfirmation();
            document.getElementById('experimental-profile-error').textContent = error.message;
            return false;
        }
    }

    saveExperimentalProfile(player) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL || player?.isNPC
            || player !== this.players.find(candidate => !candidate.isNPC)
            || !Number.isInteger(this.selectedExperimentalProfileSlot)) return false;
        try {
            this.experimentalProfiles.updateProfile(
                this.selectedExperimentalProfileSlot,
                {
                    ...player.getPersistentProgressionSnapshot(),
                    newGamePlusCycle: this.experimentalNewGamePlusCycle || 0,
                    unlockedShortcutIds: [...(this.experimentalUnlockedShortcutIds || [])]
                }
            );
            return true;
        } catch (error) {
            console.warn(`[Zorka] Experimental profile save skipped: ${error.message}`);
            this.selectedExperimentalProfileSlot = null;
            return false;
        }
    }

    setupExperimentalMatch() {
        // Reuse the shared Solo human contract; room-configured NPCs are added below.
        this.spawnPlayers(GAME_MODE.SOLO, 2);
        this.gameState = GAME_MODE.EXPERIMENTAL;
        this.initializeExperimentalWorldState();
    }

    initializeExperimentalWorldState() {
        // World/run state is rebuilt independently from the retained human's profile progression.
        Game.prototype.clearExperimentalState.call(this);
        this.players = (this.players || []).filter(player => !player.isNPC);
        this.asteroids = [];
        this.hazards = [];
        this.projectiles = [];
        this.vfx = [];
        Game.prototype.initializeExperimentalRooms.call(this);
        Game.prototype.setupExperimentalPopulations.call(this);
        const startingRoom = this.experimentalRooms.find(area => area.roomNumber === 1) || this.experimentalRooms[0];
        Game.prototype.showExperimentalSectorMessage.call(this, startingRoom?.roomNumber || 1);
        Game.prototype.showExperimentalObjectiveMessage.call(this);
    }

    resetExperimentalWorldLoop(player) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL || !player || player.isNPC) return false;
        Game.prototype.initializeExperimentalWorldState.call(this);
        player.experimentalWorldResetPending = false;
        return true;
    }


    showExperimentalSectorMessage(roomNumber) {
        const normalizedRoomNumber = Math.max(1, Math.floor(Number(roomNumber) || 1));
        this.experimentalSectorMessage = {
            text: `Sector ${normalizedRoomNumber}`,
            remaining: EXPERIMENTAL_SECTOR_MESSAGE_DURATION
        };
    }

    showExperimentalHallwayMessage() {
        this.experimentalSectorMessage = {
            text: 'Sector 0',
            remaining: EXPERIMENTAL_SECTOR_MESSAGE_DURATION
        };
    }

    showExperimentalObjectiveMessage() {
        const human = (this.players || []).find(player => !player.isNPC);
        const encounter = Game.prototype.getExperimentalEncounterState.call(this, human?.roomId);
        this.experimentalObjectiveMessage = {
            lines: encounter && !encounter.doorUnlocked
                ? [
                    'Defeat the required enemies yourself to open the hallway.',
                    `Player kills remaining: ${Math.max(0, encounter.requiredPlayerKills - encounter.playerCreditedKills)}`
                ]
                : ['The Princess is in Sector 9!', 'Save the Princess!', 'Save the Galaxy!'],
            remaining: EXPERIMENTAL_OBJECTIVE_MESSAGE_DURATION
        };
    }

    updateExperimentalMessages(dt) {
        for (const key of ['experimentalSectorMessage', 'experimentalObjectiveMessage']) {
            const message = this[key];
            if (!message) continue;
            message.remaining -= dt;
            if (message.remaining <= 0) this[key] = null;
        }
    }

    drawExperimentalMessages(ctx) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 14;

        if (this.experimentalObjectiveMessage) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 42px "Courier New", monospace';
            const lineHeight = 52;
            const startY = DESIGN_HEIGHT * 0.62 - lineHeight;
            this.experimentalObjectiveMessage.lines.forEach((line, index) => {
                ctx.fillText(line, DESIGN_WIDTH / 2, startY + index * lineHeight);
            });
        }

        if (this.experimentalSectorMessage) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 42px "Courier New", monospace';
            ctx.fillText(this.experimentalSectorMessage.text, DESIGN_WIDTH / 2, DESIGN_HEIGHT * 0.36);
            if (this.experimentalSectorMessage.detail) {
                ctx.font = 'bold 26px "Courier New", monospace';
                ctx.fillText(this.experimentalSectorMessage.detail, DESIGN_WIDTH / 2, DESIGN_HEIGHT * 0.36 + 48);
            }
        }
        ctx.restore();
    }

    getExperimentalHallwayDepthFromArea(player, hallway, area) {
        if (!player || !hallway || !area) return Infinity;
        const overlapLeft = Math.max(hallway.bounds.left, area.bounds.left);
        const overlapRight = Math.min(hallway.bounds.right, area.bounds.right);
        const overlapTop = Math.max(hallway.bounds.top, area.bounds.top);
        const overlapBottom = Math.min(hallway.bounds.bottom, area.bounds.bottom);
        if (hallway.bounds.top === area.bounds.bottom) return Math.max(0, player.y - hallway.bounds.top);
        if (hallway.bounds.bottom === area.bounds.top) return Math.max(0, hallway.bounds.bottom - player.y);
        if (hallway.bounds.left === area.bounds.right) return Math.max(0, player.x - hallway.bounds.left);
        if (hallway.bounds.right === area.bounds.left) return Math.max(0, hallway.bounds.right - player.x);
        return overlapLeft <= overlapRight && overlapTop <= overlapBottom ? 0 : Infinity;
    }

    getExperimentalActiveAreaIds() {
        const currentArea = Game.prototype.getExperimentalRenderArea.call(this);
        if (!currentArea) return new Set();

        const active = new Set([currentArea.id]);
        if (currentArea.roomNumber !== 0) return active;

        const localPlayer = this.players.find(player => !player.isNPC && !player.isDead && !player.isEliminated);
        if (!localPlayer) return active;

        for (const connectedId of currentArea.connectedAreaIds || []) {
            const connectedArea = Game.prototype.getExperimentalRoom.call(this, connectedId);
            if (!connectedArea || connectedArea.roomNumber <= 0) continue;

            const depth = Game.prototype.getExperimentalHallwayDepthFromArea.call(
                this,
                localPlayer,
                currentArea,
                connectedArea
            );
            if (depth <= EXPERIMENTAL_HALLWAY_ACTIVITY_DEPTH) active.add(connectedArea.id);
        }

        return active;
    }

    startExperimentalMode(profile = null, options = {}) {
        const selectedProfile = profile || (Number.isInteger(this.selectedExperimentalProfileSlot)
            ? this.experimentalProfiles.getProfile(this.selectedExperimentalProfileSlot)
            : null);
        if (!selectedProfile) {
            this.showExperimentalProfileSelection('Select or create a profile to begin.');
            return false;
        }
        this.experimentalNewGamePlusCycle = Math.max(0, Math.floor(Number(selectedProfile.newGamePlusCycle) || 0));
        this.experimentalUnlockedShortcutIds = new Set(selectedProfile.unlockedShortcutIds || []);
        this.closePauseMenu();
        this.hideArcadeGameOver();
        this.arcadeGameOver = false;
        this.arcadeResult = null;
        Game.prototype.hideVictoryScreen.call(this);
        this.clearExperimentalState();
        this.players = [];
        this.asteroids = [];
        this.hazards = [];
        this.projectiles = [];
        this.vfx = [];
        this.setupExperimentalMatch();
        const human = this.players.find(player => !player.isNPC);
        if (!human) {
            this.showExperimentalProfileSelection('Unable to create the selected pilot.');
            return false;
        }
        human.name = selectedProfile.name;
        human.applyPersistentProgression(selectedProfile);
        human.resetTransientLifeState();
        human.onPersistentProgressionChanged = player => Game.prototype.saveExperimentalProfile.call(this, player);
        document.getElementById('menu-overlay').classList.add('hidden');
        this.experimentalCameraState = { previousZoom: this.camera.zoom };
        this.camera.zoom = DEFAULT_GAMEPLAY_ZOOM;
        this.camera.follow(this.players[0]);
        this.camera.useDirectWorld();
        Game.prototype.beginGameplayMusic.call(this);
        this.resetMouseLockInput();
        return true;
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
        this.audio.stopBGM?.();
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
        this.experimentalNewGamePlusCycle = 0;
        this.closePauseMenu();
        this.hideArcadeGameOver();
        this.arcadeWaveSize = 0;
        this.arcadeSustainEight = false;
        this.nextArcadeReplacementLevel = 9;
        this.arcadeGameOver = false;
        this.arcadeResult = null;
        this.optionsOpenedFromPause = false;
        this.gameState = 'MENU';
        Game.prototype.resetCombatMusicState.call(this);
        document.getElementById('menu-overlay').classList.remove('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
        document.getElementById('arcade-menu').classList.add('hidden');
        document.getElementById('solo-menu').classList.add('hidden');
        document.getElementById('online-menu').classList.add('hidden');
        document.getElementById('experimental-menu')?.classList.add('hidden');
        document.getElementById('experimental-profile-menu').classList.add('hidden');
        document.getElementById('main-options-popup').classList.add('hidden');
        document.getElementById('main-options-popup').querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
        document.getElementById('help-popup').classList.add('hidden');
        document.getElementById('help-popup').querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
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

        Game.prototype.hideVictoryScreen.call(this);
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
        if (!player || player.isDead || this.victoryFadeActive || this.victoryScreenActive) return;
        if (this.gameState === GAME_MODE.EXPERIMENTAL && player.isNPC
            && !Game.prototype.hasHumanInExperimentalArea.call(this, player.roomId)) return;
        
        const projs = player.fire(isBurstShot);
        if (projs && projs.length > 0) {
            if (this.gameState === GAME_MODE.EXPERIMENTAL) {
                projs.forEach(projectile => { projectile.roomId = player.roomId; });
            }
            projs.forEach(projectile => Game.prototype.addProjectile.call(this, projectile));
            
            // Spatial audio
            const cameras = this.getActiveCameras();
            if (!isBurstShot) {
                Game.prototype.playSpatialEvent.call(this, 'laser_fire', player.x, player.y, player.roomId, cameras);
            }
            
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

    playSpatialEvent(name, x, y, roomId = null, cameras = this.getActiveCameras()) {
        if (this.gameState === GAME_MODE.EXPERIMENTAL
            && !Game.prototype.hasHumanInExperimentalArea.call(this, roomId)) return false;
        if (this.gameState === GAME_MODE.EXPERIMENTAL || typeof this.audio.playSpatial !== 'function') {
            this.audio.playSpatialUnwrapped?.(name, x, y, cameras);
        } else {
            this.audio.playSpatial(name, x, y, cameras, WORLD_WIDTH, WORLD_HEIGHT);
        }
        return true;
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

        const source = (kind, canonical) => Game.prototype.getExperimentalCandidates.call(this, lockingPlayer, kind, canonical);
        source('players', this.players).forEach(player => {
            if (player !== lockingPlayer && !player.isDead && !player.isEliminated) add(player, 'player');
        });
        source('projectiles', this.projectiles).forEach(projectile => {
            if ((projectile.isMissile || projectile.isSkinnyMissile)
                && !projectile.hasDetonated && !projectile.isRemoved && projectile.lifeSpan > 0) {
                add(projectile, 'missile');
            }
        });
        source('hazards', this.hazards).forEach(hazard => {
            if ((hazard instanceof SpaceDebris || hazard instanceof Satellite) && !hazard.isDestroyed) add(hazard, 'hazard');
        });
        source('asteroids', this.asteroids).forEach(asteroid => {
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
        } else if (this.victoryScreenActive || this.victoryContinueConfirmationActive) {
            this.updateMenuNavigation(dt);
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

        const gamepads = this.getGamepads();
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
        const gamepads = this.getGamepads();
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
        const gamepads = this.getGamepads();
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
        
        const gamepads = this.getGamepads();
        const gp = Array.from(gamepads).find(gamepad => gamepad !== null) || null;
        if (!gp) return;

        if (this.menuCooldown > 0) {
            this.menuCooldown -= dt;
            return;
        }

        // Determine the topmost active menu container. Modal and Game Over
        // layers live outside the normal menu overlay but share this contract.
        let activeMenu = null;
        const potentialContainers = this.victoryContinueConfirmationActive
            ? ['victory-continue-confirmation']
            : this.victoryScreenActive
                ? ['victory-screen']
                : this.activeModal === 'quit'
            ? ['quit-confirmation']
            : this.arcadeGameOver
                ? ['arcade-game-over']
                : ['profile-delete-confirmation', 'experimental-profile-actions', 'help-popup', 'main-options-popup', 'botless-popup', 'options-popup', 'solo-menu', 'online-menu', 'experimental-profile-menu', 'experimental-menu', 'arcade-menu', 'main-menu'];
        for (const id of potentialContainers) {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden')) {
                activeMenu = el;
                // If it's a menu-level container, only count it if it's the specific active one
                if (id === 'solo-menu' || id === 'online-menu' || id === 'experimental-profile-menu' || id === 'experimental-menu' || id === 'arcade-menu' || id === 'main-menu') {
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
        const gamepads = Array.from(this.getGamepads()).filter(g => g !== null);
        const count = gamepads.length;
        const statusEl = document.getElementById('gamepad-status');
        const kbBtn = document.getElementById('p1-keyboard-btn');
        const gpBtn = document.getElementById('p1-gamepad-btn');
        const isPvP = this.pendingMode === 'PVP';

        if (!this.gamepadEnabled) {
            if (statusEl) statusEl.innerText = 'GAMEPAD DISABLED IN OPTIONS';
            if (kbBtn) {
                kbBtn.disabled = false;
                kbBtn.classList.add('selected');
            }
            if (gpBtn) {
                gpBtn.disabled = true;
                gpBtn.classList.remove('selected');
            }
            this.p1ControlMode = 'KEYBOARD';
            return;
        }

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
        const gamepads = Array.from(this.getGamepads()).filter(g => g !== null);
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
        if (this.victoryFadeActive) {
            this.victoryFadeTimer += dt;
            if (this.victoryFadeTimer >= VICTORY_FADE_DURATION_SECONDS) {
                Game.prototype.showVictoryScreen.call(this);
            }
            return;
        }
        if (this.victoryScreenActive) return;
        if (this.gameState === GAME_MODE.EXPERIMENTAL) {
            this.updateExperimentalMessages(dt);
            this.updateExperimentalDialogue(dt);
        }
        const gamepads = this.getGamepads();
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
                    if (!this.victoryFadeActive && !this.victoryScreenActive && player.id === 1 && this.mouse.m2Pressed && this.mouse.m2Held) {
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
                                roomId: player.roomId,
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
                            Game.prototype.indexExperimentalEntity.call(this, 'vfx', this.vfx.at(-1));
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
                        if (!this.victoryFadeActive && !this.victoryScreenActive && this.mouse.clicked && player.fireCooldown <= 0) {
                            this.handleFire(player.id);
                        }
                    }

                    // Gamepad Firing logic
                    if (assignedGamepad) {
                        const rt = assignedGamepad.buttons[7]; // R2 / RT
                        if (!this.victoryFadeActive && !this.victoryScreenActive && rt && rt.pressed && player.fireCooldown <= 0) {
                            this.handleFire(player.id);
                        }
                    }
                } else if (player.isNPC) {
                    const localPlayers = worldRules.usesRooms
                        ? Game.prototype.getExperimentalAreaEntities.call(this, player.roomId, 'players') : this.players;
                    const localTargets = worldRules.usesRooms
                        ? localPlayers.filter(candidate => Game.prototype.isHostileTarget.call(this, player, candidate))
                        : localPlayers;
                    const localAsteroids = worldRules.usesRooms
                        ? Game.prototype.getExperimentalAreaEntities.call(this, player.roomId, 'asteroids') : this.asteroids;
                    const localHazards = worldRules.usesRooms
                        ? Game.prototype.getExperimentalAreaEntities.call(this, player.roomId, 'hazards') : this.hazards;
                    player.update(dt, {}, {}, this.camera, localTargets, localAsteroids, [], false, this.transformationKills, localHazards, null, this.areTransformationsEnabled(), worldRules);
                    if (player.isFixedPositionNPC) {
                        player.x = player.fixedAnchorX;
                        player.y = player.fixedAnchorY;
                        player.vx = 0;
                        player.vy = 0;
                    }
                    player.resolveNPCLevelUps();
                    if (player.justPrestiged) prestigeTriggers.push(player);
                    
                    if (player.shouldTriggerBurstFire) {
                        this.handleFire(player.id, true);
                        player.shouldTriggerBurstFire = false;
                    }

                    if (!this.victoryFadeActive && !this.victoryScreenActive && player.shouldFire) {
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
                    if (this.gameState === GAME_MODE.EXPERIMENTAL
                        && !player.isNPC && player.experimentalWorldResetPending) {
                        Game.prototype.resetExperimentalWorldLoop.call(this, player);
                    }
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
            this.players.filter(player => !player.isDead && !player.isFixedPositionNPC).forEach(player => this.resolveExperimentalSlide(player));
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
            const projectilePlayers = worldRules.usesRooms
                ? this.players.filter(player => Game.prototype.isHostileTarget.call(this, p.owner, player))
                : this.players;
            p.update(dt, this.asteroids, projectilePlayers, this.hazards, this.projectiles, worldRules);
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
            if (v.finished) {
                Game.prototype.unindexExperimentalEntity.call(this, 'vfx', v);
                this.vfx.splice(i, 1);
            }
        }

        // Thruster Sounds Removed

        this.checkCollisions();

        if (worldRules.usesRooms) {
            this.players.filter(player => !player.isDead && !player.isNPC)
                .forEach(player => {
                    Game.prototype.updateExperimentalShortcutInteractions.call(this, player);
                    this.resolveExperimentalPlayerRoomMembership(player);
                });
        }

        this.reconcileArcadeNPCs();
        Game.prototype.updateCombatMusic.call(this, dt);
        
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
            if (door.blockedCategories.includes(category)
                || (category === EXPERIMENTAL_COLLISION_CATEGORY.HUMAN_PLAYER
                    && (Game.prototype.isExperimentalProgressionDoorLocked.call(this, door)
                        || Game.prototype.isExperimentalShortcutDoorLocked.call(this, door)))) walls.push(door.blocker);
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
                Game.prototype.unindexExperimentalEntity.call(this, 'players', player, previousRoomId);
                player.roomId = candidateId;
                if (candidate.roomNumber > 0) player.experimentalLastCombatRoomId = candidate.id;
                Game.prototype.indexExperimentalEntity.call(this, 'players', player);
                break;
            }
        }
        const nextRoom = Game.prototype.getExperimentalRoom.call(this, player.roomId);
        if (player.roomId !== previousRoomId && nextRoom?.roomNumber > 0) {
            Game.prototype.showExperimentalSectorMessage.call(this, nextRoom.roomNumber);
            Game.prototype.showExperimentalObjectiveMessage.call(this);
        }
        if (player.roomId !== previousRoomId
            && currentRoom?.roomNumber > 0
            && nextRoom?.roomNumber === 0) {
            Game.prototype.showExperimentalHallwayMessage.call(this);
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
        return collided;
    }

    resolveExperimentalEntityWalls() {
        const fallbackRoom = this.experimentalRooms[0];
        if (!fallbackRoom) return;
        const destroyedSmall = [];
        for (const asteroid of this.asteroids) {
            const room = Game.prototype.getExperimentalRoom.call(this, asteroid.roomId) || fallbackRoom;
            const walls = Game.prototype.getExperimentalCollisionWalls.call(this, asteroid);
            const swept = Game.prototype.findExperimentalSweptWallHit.call(this, asteroid, walls, room.wallCollisionThickness);
            if (swept) {
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
                hazard.x = swept.hit.x;
                hazard.y = swept.hit.y;
                correctWallPenetration(hazard, swept.hit, room.collisionEpsilon);
                reflectVelocity(hazard, swept.hit.normal);
            }
            for (const wall of walls) {
                const contact = circleThickSegmentContact(hazard, wall, room.wallCollisionThickness);
                if (!contact) continue;
                correctWallPenetration(hazard, contact, room.collisionEpsilon);
                reflectVelocity(hazard, contact.normal);
            }
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
        return true;
    }

    respawnPlayer(player) {
        player.resetTransientLifeState();

        const primaryMusicPlayer = Game.prototype.getPrimaryMusicPlayer.call(this);
        if (!player.isNPC && player === primaryMusicPlayer && this.gameState !== GAME_MODE.ARCADE) {
            Game.prototype.beginGameplayMusic.call(this);
        }

        if (this.gameState === GAME_MODE.EXPERIMENTAL) {
            const previousRoomId = player.roomId;
            const previousRoom = Game.prototype.getExperimentalRoom.call(this, previousRoomId);
            const room = player.isNPC
                ? (Game.prototype.allowsOrdinaryExperimentalNPCPopulation.call(this, previousRoom)
                    ? previousRoom
                    : this.experimentalRooms.find(area => Game.prototype.allowsOrdinaryExperimentalNPCPopulation.call(this, area)))
                : (this.experimentalRooms.find(area => area.roomNumber === 1) || this.experimentalRooms[0]);
            if (player.isNPC && !room) {
                player.isEliminated = true;
                player.respawnTimer = 0;
                return;
            }
            const roomId = room.id;
            const spawn = player.isNPC
                ? this.findExperimentalSpawn(player.radius, this.players, roomId)
                : {
                    x: (room.bounds.left + room.bounds.right) / 2,
                    y: (room.bounds.top + room.bounds.bottom) / 2
                };

            if (previousRoomId !== roomId) {
                Game.prototype.unindexExperimentalEntity.call(this, 'players', player, previousRoomId);
            }
            player.x = spawn.x;
            player.y = spawn.y;
            player.roomId = roomId;
            Game.prototype.indexExperimentalEntity.call(this, 'players', player);

            if (player.isNPC) {
                player.resetLevelProgress();
                player.initializeNPCLevel(Game.prototype.getExperimentalEnemyLevel.call(this, room.npcLevel));
                player.applyRandomCapsulePowerUps(Math.floor(player.level * 0.75));
                player.color = chooseRandomPlayerColor();
                player.rollAggression();
            } else {
                Game.prototype.showExperimentalSectorMessage.call(this, 1);
            }
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
            Game.prototype.playSpatialEvent.call(this, 'explosion', target.x, target.y, target.roomId, cameras);
            
            this.createExplosion(target.x, target.y, target.radius, target.roomId);
            
            if (target instanceof Asteroid) {
                if (target.size === 'large') {
                    this.awardXP(killer, 1, target);
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
                    Game.prototype.unindexExperimentalEntity.call(this, 'asteroids', target);
                    this.asteroids.splice(currentIndex, 1);
                }
            } else if (target.isDebris || target.isSatellite) {
                this.awardXP(killer, target.isSatellite ? 15 : 5, target);

                const currentIndex = this.hazards.indexOf(target);
                if (currentIndex !== -1) {
                    Game.prototype.unindexExperimentalEntity.call(this, 'hazards', target);
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
        Game.prototype.unindexExperimentalEntity.call(this, 'projectiles', projectile);
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
                Game.prototype.playSpatialEvent.call(this, 'shield_hit', player.x, player.y, player.roomId, cameras);
            }
        }
    }

    playerDeath(player, killer) {
        return Game.prototype.resolvePlayerDamage.call(this, player, 1, killer);
    }

    resolvePlayerDamage(player, amount, killer) {
        if (!player || player.isDead || player.spawnImmunityTimer > 0) return;
        if (!Game.prototype.canDamagePlayerTarget.call(this, player, killer)) return { shieldsConsumed: 0, hpLost: 0, died: false };

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

        const primaryPlayer = Game.prototype.getPrimaryMusicPlayer.call(this);
        const isPrimaryHuman = !player.isNPC && player === primaryPlayer;
        const isNPCShipHit = player.isNPC
            && Game.prototype.isShipDamageSource.call(this, killer);

        if (result.shieldsConsumed > 0) {
            player.markShieldLoss();
            if (isPrimaryHuman) {
                this.audio.play?.('player_shield_hit');
            } else if (isNPCShipHit) {
                Game.prototype.playSpatialEvent.call(
                    this,
                    'player_shield_hit',
                    player.x,
                    player.y,
                    player.roomId,
                    cameras
                );
            } else {
                Game.prototype.playSpatialEvent.call(this, 'shield_hit', player.x, player.y, player.roomId, cameras);
            }
        }
        if (result.hpLost > 0) {
            player.markHullLoss();
            if (isPrimaryHuman) {
                this.audio.play?.('player_hull_hit');
            } else if (isNPCShipHit) {
                Game.prototype.playSpatialEvent.call(
                    this,
                    'player_hull_hit',
                    player.x,
                    player.y,
                    player.roomId,
                    cameras
                );
            }
        }
        if (result.shieldsConsumed > 0 || result.hpLost > 0 || result.died) {
            Game.prototype.refreshCombatMusicForDamage.call(this, killer, player);
        }
        return result;
    }

    getDamageSourceDisplayName(source) {
        if (!source) return 'the Environment';
        if (source.owner && source.owner !== source) return Game.prototype.getDamageSourceDisplayName.call(this, source.owner);
        if (typeof source.name === 'string' && source.name.trim()) return source.name.trim();
        if (source.isSatellite) return 'Satellite';
        if (source.isDebris) return 'Space Debris';
        if (source.size) return `${source.size[0].toUpperCase()}${source.size.slice(1)} Asteroid`;
        return 'the Environment';
    }

    isNPCDamageSource(source) {
        if (!source) return false;
        if (source.owner && source.owner !== source) {
            return Game.prototype.isNPCDamageSource.call(this, source.owner);
        }
        return source.isNPC === true;
    }

    isShipDamageSource(source) {
        if (!source) return false;
        if (source.owner && source.owner !== source) {
            return Game.prototype.isShipDamageSource.call(this, source.owner);
        }
        return this.players.includes(source);
    }

    confirmPlayerDeath(player, killer, cameras = this.getActiveCameras()) {
        if (!player || player.isDead || player.currentHP > 0) return;
        player.isDead = true;
        player.deaths++;
        player.cancelBurstFire();
        player.resetControllerAimLock(true);
        this.clearAimLocksForTarget(player);
        player.respawnTimer = player.noRespawn ? 0 : 2;

        if (this.gameState === GAME_MODE.EXPERIMENTAL && player.isNPC && player.isOrdinaryExperimentalNPC) {
            player.isEliminated = true;
            player.respawnTimer = 0;
            Game.prototype.resolveExperimentalOrdinaryNPCDeath.call(this, player, killer);
        }

        if (this.gameState === GAME_MODE.EXPERIMENTAL && !player.isNPC) {
            player.experimentalWorldResetPending = true;
        }

        const primaryMusicPlayer = Game.prototype.getPrimaryMusicPlayer.call(this);
        if (!player.isNPC && player === primaryMusicPlayer) {
            this.audio.play?.('death');
            this.audio.stopGameplayMusic?.();
            Game.prototype.resetCombatMusicState.call(this);
        }

        if (this.gameState === GAME_MODE.EXPERIMENTAL && !player.isNPC) {
            Game.prototype.saveExperimentalProfile.call(this, player);
            const deathCause = Game.prototype.isNPCDamageSource.call(this, killer)
                ? "Defeated by Zorka's Enemies"
                : `Destroyed by ${Game.prototype.getDamageSourceDisplayName.call(this, killer)}`;
            this.experimentalSectorMessage = {
                text: deathCause,
                detail: 'Returning to Sector 1',
                remaining: Math.max(EXPERIMENTAL_SECTOR_MESSAGE_DURATION, player.respawnTimer)
            };
        }

        // Award the confirmed kill before Hardcore clears the victim's progression.
        if (killer && killer !== player && typeof killer.addCapsule === 'function' && !player.noKillReward) {
            if (player.isNPC) this.awardXP(killer, Game.prototype.getNPCXPReward.call(this, player), player);
            killer.addCapsule();
            killer.score = (killer.score || 0) + 1;
            killer.killStreak = (killer.killStreak || 0) + 1;
            if (killer.killStreak > (killer.highTide || 0)) killer.highTide = killer.killStreak;
        }

        const isOneLifeHuman = (this.gameState === 'ARCADE' || this.gameState === GAME_MODE.EXPERIMENTAL)
            && !player.isNPC;
        const gameOverResult = isOneLifeHuman ? {
            finalLevel: player.level,
            totalXP: player.totalXP,
            totalCapsulesGained: player.totalCapsulesGained
        } : null;

        const preservesExperimentalProfile = this.gameState === GAME_MODE.EXPERIMENTAL && !player.isNPC;
        if (Game.prototype.isHardcoreActive.call(this) && !preservesExperimentalProfile) player.resetLevelProgress();
        
        // Reset ALL power-up progress on death
        player.powerUpCapsules = 0;
        player.activeGun = 'Normal';
        player.weaponStreamCounts = { Laser: 0, Antigun: 0, Double: 0, Orb: 0 };
        player.ghosts = []; 
        player.hasMissile = false;
        player.restoreShieldCharges(0);
        player.history = []; // Clear history so ghosts don't snap back to old positions on respawn
        player.martianParallelGuns = 1;
        player.resetEvolutionForm();

        // Dying resets this ship's current kill streak AND best High Tide
        player.killStreak = 0;
        player.highTide = 0;
        
        // Spatial explosion sound
        Game.prototype.playSpatialEvent.call(this, 'explosion', player.x, player.y, player.roomId, cameras);
        
        this.createExplosion(player.x, player.y, 50, player.roomId);
        
        if (window.ProgressLogger) {
            window.ProgressLogger.logProgress('player_death');
        }

        if (Game.prototype.isSector9BBGDefender.call(this, player)) {
            player.isEliminated = true;
            player.respawnTimer = 0;
            Game.prototype.unindexExperimentalEntity.call(this, 'players', player);
            Game.prototype.checkSector9BBGEncounterCompletion.call(this);
        }

        if (this.gameState === 'ARCADE') {
            player.respawnTimer = 0;
            if (player.isNPC) {
                player.isEliminated = true;
            } else {
                this.showArcadeGameOver(gameOverResult);
            }
        }

    }

    awardXP(killer, amount, source = null) {
        if (!killer || !this.players.includes(killer) || typeof killer.addXP !== 'function'
            || !Number.isFinite(amount) || amount <= 0) return 0;
        const levelsGained = killer.addXP(amount);
        if (source && Number.isFinite(source.x) && Number.isFinite(source.y)) {
            Game.prototype.createFloatingText.call(this, `+${amount} XP`, source.x, source.y - (source.radius || 0) - 18, '#ffff66', source.roomId);
        }
        if (levelsGained > 0) {
            Game.prototype.createFloatingText.call(this, 'Lvl Up!', killer.x, killer.y - killer.radius - 24, killer.color, killer.roomId);
        }
        if (killer.isNPC) killer.resolveNPCLevelUps();
        else Game.prototype.saveExperimentalProfile.call(this, killer);
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
            const projectileAsteroids = Game.prototype.getExperimentalCandidates.call(this, p, 'asteroids', this.asteroids);
            for (let j = projectileAsteroids.length - 1; j >= 0; j--) {
                const a = projectileAsteroids[j];
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
            const projectileHazards = Game.prototype.getExperimentalCandidates.call(this, p, 'hazards', this.hazards);
            for (let j = projectileHazards.length - 1; j >= 0; j--) {
                const h = projectileHazards[j];
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
            for (let player of Game.prototype.getExperimentalCandidates.call(this, p, 'players', this.players)) {
                if (!player || player.isDead || player.isEliminated || p.owner === player) continue;
                if (!Game.prototype.isHostileTarget.call(this, p.owner, player)) continue;
                if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, p, player)) continue;
                if (checkCollision(p, player)) {
                    if (p.isDecoy) {
                        this.createExplosion(p.x, p.y, 60, p.roomId);
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
                const localProjectiles = Game.prototype.getExperimentalCandidates.call(this, p1, 'projectiles', this.projectiles);
                for (let j = localProjectiles.length - 1; j >= 0; j--) {
                    const p2 = localProjectiles[j];
                    if (p1 === p2) continue;
                    if (!p2 || p2.isRemoved || p2.hasDetonated) continue;
                    if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, p1, p2)) continue;
                    if (p1.owner && p1.owner === p2.owner) continue;
                    if (p1.owner && p2.owner
                        && !Game.prototype.isHostileTarget.call(this, p1.owner, p2.owner)) continue;
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
            for (let a of Game.prototype.getExperimentalCandidates.call(this, player, 'asteroids', this.asteroids)) {
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
                        if (player.clearShieldCharges() > 0) player.markShieldLoss();
                        a.hits = a.maxHits - 1;
                        this.hitTarget(a);
                    } else if (a.size === 'medium') {
                        Game.prototype.resolvePlayerDamage.call(this, player, 5, a);
                    } else {
                        this.playerDeath(player, a);
                    }
                }
                break;
            }
            if (player.isDead) continue;

            // Hazards
            for (let h of Game.prototype.getExperimentalCandidates.call(this, player, 'hazards', this.hazards)) {
                if (!h || h.isDestroyed) continue;
                if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, player, h)) continue;
                if (checkCollision(player, h)) {
                    this.playerDeath(player, h);
                    break;
                }
            }
            if (player.isDead) continue;
            
            // Cyborg Decoys
            for (let i = this.projectiles.length - 1; i >= 0; i--) {
                const p = this.projectiles[i];
                if (!p || p.isRemoved || p.hasDetonated) continue;
                if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, player, p)) continue;
                if (p.isDecoy && p.owner !== player
                    && Game.prototype.isHostileTarget.call(this, p.owner, player)
                    && checkCollision(player, p)) {
                    this.createExplosion(p.x, p.y, 60, p.roomId);
                    this.removeProjectile(p);
                    this.playerDeath(player, p.owner);
                }
            }
        }
    }

    // Standard AoE projectile detonation (e.g. Orbs)
    detonateAoEProjectile(p) {
        if (!p || p.hasDetonated) return;
        p.hasDetonated = true;

        const radius = p.aoeRadius || 60;
        const cameras = this.getActiveCameras();

        Game.prototype.playSpatialEvent.call(this, 'explosion', p.x, p.y, p.roomId, cameras);
        this.createExplosion(p.x, p.y, radius, p.roomId);

        // Check asteroids
        const impactedAsteroids = [];
        const localAsteroids = Game.prototype.getExperimentalCandidates.call(this, p, 'asteroids', this.asteroids);
        for (let j = localAsteroids.length - 1; j >= 0; j--) {
            const a = localAsteroids[j];
            if (!a || a.isDestroyed) continue;
            if (!Game.prototype.areExperimentalEntitiesCoLocated.call(this, p, a)) continue;
            const dist = Math.hypot(a.x - p.x, a.y - p.y);
            if (dist < radius + a.radius && !this.isExperimentalBlastBlocked(p, a)) {
                impactedAsteroids.push(a);
            }
        }

        for (const a of impactedAsteroids) {
            if (!a || a.isDestroyed) continue;
            // Orbs destroy large and medium asteroids in one hit.
            if (p.isOrb) {
                a.hits = a.maxHits - 1;
            }
            this.hitTarget(a, p.owner);
        }

        // AoE missiles and other AoE projectiles also damage debris and satellites.
        // Collect first because hitTarget() may remove destroyed hazards from this.hazards.
        const impactedHazards = [];
        const localHazards = Game.prototype.getExperimentalCandidates.call(this, p, 'hazards', this.hazards);
        for (let j = localHazards.length - 1; j >= 0; j--) {
            const h = localHazards[j];
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
        for (let player of Game.prototype.getExperimentalCandidates.call(this, p, 'players', this.players)) {
            if (player.isDead || player === p.owner) continue;
            if (!Game.prototype.isHostileTarget.call(this, p.owner, player)) continue;
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

        Game.prototype.playSpatialEvent.call(this, 'explosion', missile.x, missile.y, missile.roomId, cameras);
        this.createExplosion(missile.x, missile.y, radius, missile.roomId);

        // Instantly destroy every asteroid caught in the blast radius
        const impactedAsteroids = [];
        const localAsteroids = Game.prototype.getExperimentalCandidates.call(this, missile, 'asteroids', this.asteroids);
        for (let j = localAsteroids.length - 1; j >= 0; j--) {
            const a = localAsteroids[j];
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
        const localHazards = Game.prototype.getExperimentalCandidates.call(this, missile, 'hazards', this.hazards);
        for (let j = localHazards.length - 1; j >= 0; j--) {
            const h = localHazards[j];
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
        for (let player of Game.prototype.getExperimentalCandidates.call(this, missile, 'players', this.players)) {
            if (player.isDead || player === missile.owner) continue;
            if (!Game.prototype.isHostileTarget.call(this, missile.owner, player)) continue;
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

    createExplosion(x, y, radius, roomId = null) {
        if (this.gameState === GAME_MODE.EXPERIMENTAL
            && !Game.prototype.hasHumanInExperimentalArea.call(this, roomId)) return null;
        this.vfx.push({
            x, y, roomId,
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
        Game.prototype.indexExperimentalEntity.call(this, 'vfx', this.vfx.at(-1));
        return this.vfx.at(-1);
    }

    createFloatingText(text, x, y, color = '#fff', roomId = null) {
        if (!Array.isArray(this.vfx)) this.vfx = [];
        const effect = {
            text, x, y, color, roomId, life: 1.25,
            update(dt) {
                this.life -= dt;
                this.y -= 28 * dt;
                if (this.life <= 0) this.finished = true;
            },
            draw(ctx, assets, camera) {
                ctx.save();
                camera.apply(ctx, this.x, this.y);
                ctx.globalAlpha = Math.max(0, Math.min(1, this.life / 0.35));
                ctx.font = 'bold 18px Orbitron';
                ctx.textAlign = 'center';
                ctx.fillStyle = this.color;
                ctx.fillText(this.text, 0, 0);
                ctx.restore();
            }
        };
        this.vfx.push(effect);
        Game.prototype.indexExperimentalEntity.call(this, 'vfx', effect);
        return effect;
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
                    hazards: this.hazards,
                    gameMode: this.gameState,
                    profileName: this.gameState === GAME_MODE.EXPERIMENTAL
                        && Number.isInteger(this.selectedExperimentalProfileSlot)
                        ? this.experimentalProfiles.getProfile(this.selectedExperimentalProfileSlot)?.name || null
                        : null
                }
            );
        }

        this.drawExperimentalMessages(this.ctx);
        this.drawVictoryFade(this.ctx);
        this.drawCrosshair();
    }


    drawVictoryFade(ctx) {
        if (!this.victoryFadeActive) return;
        const alpha = Math.max(0, Math.min(1, this.victoryFadeTimer / VICTORY_FADE_DURATION_SECONDS));
        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
        ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
        ctx.restore();
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
        if (this.gameState === GAME_MODE.EXPERIMENTAL) {
            this.drawExperimentalSectorBackground(ctx, camera);
            this.drawExperimentalScenery(ctx, camera);
            this.drawExperimentalWalls(ctx, camera);
        }

        const currentArea = Game.prototype.getExperimentalRenderArea.call(this);
        const activeAreaIds = Game.prototype.getExperimentalActiveAreaIds.call(this);
        const source = (kind, canonical) => currentArea
            ? [...activeAreaIds].flatMap(areaId => Game.prototype.getExperimentalAreaEntities.call(this, areaId, kind))
            : canonical;
        const visible = entities => Game.prototype.getRenderableEntities.call(this, entities, camera);
        visible(source('asteroids', this.asteroids)).forEach(a => a.draw(ctx, this.assets, camera));
        visible(source('hazards', this.hazards)).forEach(h => h.draw(ctx, this.assets, camera));
        visible(source('projectiles', this.projectiles)).forEach(p => p.draw(ctx, this.assets, camera));
        visible(source('players', this.players)).forEach(p => {
            if (!p.isDead && !p.isEliminated) p.draw(ctx, this.assets, camera);
        });
        visible(source('vfx', this.vfx)).forEach(v => v.draw(ctx, this.assets, camera));
        if (this.gameState === GAME_MODE.EXPERIMENTAL) this.drawExperimentalDialogue(ctx, camera);
    }

    getExperimentalRenderArea() {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return null;
        const localPlayer = this.players.find(player => !player.isNPC && !player.isDead && !player.isEliminated);
        return Game.prototype.getExperimentalRoom.call(this, localPlayer?.roomId);
    }

    getRenderableEntities(entities, camera) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return entities;
        const currentArea = Game.prototype.getExperimentalRenderArea.call(this);
        if (!currentArea) return [];
        const halfWidth = DESIGN_WIDTH / (2 * camera.zoom) + EXPERIMENTAL_RENDER_CULL_MARGIN;
        const halfHeight = DESIGN_HEIGHT / (2 * camera.zoom) + EXPERIMENTAL_RENDER_CULL_MARGIN;
        const viewport = {
            left: camera.x - halfWidth,
            right: camera.x + halfWidth,
            top: camera.y - halfHeight,
            bottom: camera.y + halfHeight
        };
        return entities.filter(entity => {
            if (!Game.prototype.getExperimentalActiveAreaIds.call(this).has(entity.roomId)) return false;
            if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return true;
            const bounds = Game.prototype.getExperimentalRenderBounds.call(this, entity);
            return bounds.right >= viewport.left && bounds.left <= viewport.right
                && bounds.bottom >= viewport.top && bounds.top <= viewport.bottom;
        });
    }

    getExperimentalRenderBounds(entity) {
        let extent = Math.max(0, entity.renderRadius || entity.radius || 0);
        if (entity instanceof Player) {
            let spriteExtent = entity.radius * 1.8;
            if (entity.isMartian) spriteExtent = entity.radius * 3.5;
            else if (entity.isDimensionX) spriteExtent = entity.radius * 4.2;
            else if (entity.isCyborg) spriteExtent = entity.radius * 2.275;
            else if (entity.isEventHorizon) spriteExtent *= 1 + (entity.highTide || 0) * 0.02;
            extent = Math.max(extent, spriteExtent, entity.hasForcefield ? entity.radius * 2 : 0, 60);
        } else if (entity instanceof Asteroid || entity instanceof SpaceDebris || entity instanceof Satellite) {
            extent = Math.max(extent, entity.radius * 1.25);
        } else if (entity instanceof Projectile) {
            if (entity.isDecoy) extent = Math.max(extent, 62);
            else if (entity.isLaser || entity.isMissile || entity.isSkinnyMissile) extent = Math.max(extent, 55);
            else if (entity.isOrbital) extent = Math.max(extent, entity.radius * 1.5);
            else extent = Math.max(extent, entity.radius * 2);
        }
        let bounds = {
            left: entity.x - extent,
            right: entity.x + extent,
            top: entity.y - extent,
            bottom: entity.y + extent
        };
        if (entity instanceof Player && Array.isArray(entity.ghosts)) {
            for (const ghost of entity.ghosts) {
                bounds.left = Math.min(bounds.left, ghost.x - extent);
                bounds.right = Math.max(bounds.right, ghost.x + extent);
                bounds.top = Math.min(bounds.top, ghost.y - extent);
                bounds.bottom = Math.max(bounds.bottom, ghost.y + extent);
            }
        }
        if (entity instanceof Projectile && entity.isTentacle && entity.owner) {
            bounds = {
                left: Math.min(bounds.left, entity.owner.x - 40),
                right: Math.max(bounds.right, entity.owner.x + 40),
                top: Math.min(bounds.top, entity.owner.y - 40),
                bottom: Math.max(bounds.bottom, entity.owner.y + 40)
            };
        }
        return bounds;
    }

    getExperimentalSceneryLayout() {
        const currentArea = Game.prototype.getExperimentalRenderArea.call(this);
        if (!currentArea || currentArea.id !== 'experimental-hallway-1-2') return null;

        const bounds = currentArea.bounds;
        const areaHeight = bounds.bottom - bounds.top;
        const outsideMargin = 40;

        return {
            areaId: currentArea.id,
            squid: {
                image: this.assets.squidScenery,
                x: bounds.left - 1180 / 2 - outsideMargin,
                y: bounds.top + areaHeight * 0.55,
                width: 1180,
                height: 1180,
                alpha: 0.9
            },
            upperCranioid: {
                image: this.assets.cranioidScenery,
                x: bounds.right + 390 / 2 + outsideMargin,
                y: bounds.top + areaHeight * 0.22,
                width: 390,
                height: 390,
                alpha: 0.9
            },
            lowerCranioid: {
                image: this.assets.cranioidScenery,
                x: bounds.right + 330 / 2 + outsideMargin,
                y: bounds.top + areaHeight * 0.76,
                width: 330,
                height: 330,
                alpha: 0.9
            }
        };
    }

    getExperimentalDialogueSequences() {
        return [
            {
                id: 'squid-greeting',
                order: 2,
                speaker: 'squid',
                triggerRadius: 1200,
                holdAfterLastLine: 8,
                lines: [
                    {
                        text: 'Yo whats up, Earthling? Going after Princess Zorka? Thats mighty awesome of you! Good luck on your quest!',
                        revealAt: 0,
                        textOffsetX: -200,
                        textOffsetY: -800,
                        pointerOffsetX: 0,
                        pointerOffsetY: 0,
                        maxTextWidth: 560
                    }
                ]
            },
            {
                id: 'squid-direction',
                order: 3,
                speaker: 'squid',
                triggerRadius: 1200,
                holdAfterLastLine: 4,
                lines: [
                    {
                        text: 'All roads lead to Sector 9, my dude.',
                        revealAt: 0,
                        textOffsetX: -200,
                        textOffsetY: 630,
                        pointerOffsetX: 0,
                        pointerOffsetY: 0,
                        maxTextWidth: 620
                    }
                ]
            },
            {
                id: 'upper-cranioid-cheer',
                order: 1,
                speaker: 'upperCranioid',
                triggerRadius: 1450,
                holdAfterLastLine: 4,
                lines: [
                    { text: 'Are they going for Zorka?!', revealAt: 0.0, textOffsetX: -520, textOffsetY: -360, maxTextWidth: 410 },
                    { text: 'No way!', revealAt: 0.25, textOffsetX: 220, textOffsetY: -180, maxTextWidth: 280 },
                    { text: 'Cool!', revealAt: 0.45, textOffsetX: 180, textOffsetY: 80, maxTextWidth: 240 },
                    { text: 'Get Zorka!', revealAt: 0.65, textOffsetX: 230, textOffsetY: 155, maxTextWidth: 320 },
                    { text: 'Rad!', revealAt: 0.85, textOffsetX: -420, textOffsetY: 180, maxTextWidth: 240 },
                    { text: 'Save the Princess!', revealAt: 1.05, textOffsetX: -270, textOffsetY: 300, maxTextWidth: 500 },
                    { text: 'Rad!', revealAt: 1.35, textOffsetX: -360, textOffsetY: 400, maxTextWidth: 240 }
                ]
            },
            {
                id: 'lower-cranioid-apology',
                order: 4,
                speaker: 'lowerCranioid',
                triggerRadius: 1450,
                holdAfterLastLine: 1,
                lines: [
                    { text: 'what smells?', revealAt: 0.0, textOffsetX: -250, textOffsetY: -340, maxTextWidth: 330 },
                    { text: 'sorry', revealAt: 0.95, textOffsetX: -360, textOffsetY: -90, maxTextWidth: 240 },
                    { text: 'sorry', revealAt: 1.25, textOffsetX: 220, textOffsetY: -40, maxTextWidth: 240 },
                    { text: 'sorry', revealAt: 1.65, textOffsetX: -390, textOffsetY: 150, maxTextWidth: 240 },
                    { text: 'sorry', revealAt: 1.85, textOffsetX: 230, textOffsetY: 120, maxTextWidth: 240 },
                    { text: 'sorry', revealAt: 2.05, textOffsetX: -350, textOffsetY: 280, maxTextWidth: 240 },
                    { text: 'sorry', revealAt: 2.1, textOffsetX: 220, textOffsetY: 255, maxTextWidth: 240 },
                    { text: 'sorry', revealAt: 3.10, textOffsetX: -100, textOffsetY: 390, maxTextWidth: 240 },
                    { text: 'sorry', revealAt: 5.8, textOffsetX: 80, textOffsetY: 450, maxTextWidth: 240 }
                ]
            }
        ];
    }

    updateExperimentalDialogue(dt) {
        const state = this.experimentalDialogueState;
        if (!state) return;

        const sequences = Game.prototype.getExperimentalDialogueSequences.call(this)
            .slice()
            .sort((a, b) => a.order - b.order);

        if (state.activeSequenceId) {
            const activeSequence = sequences.find(sequence => sequence.id === state.activeSequenceId);
            if (!activeSequence) {
                state.activeSequenceId = null;
                state.activeElapsed = 0;
                return;
            }

            state.activeElapsed += Math.max(0, dt || 0);
            const lastRevealAt = Math.max(0, ...activeSequence.lines.map(line => line.revealAt || 0));
            if (state.activeElapsed >= lastRevealAt + activeSequence.holdAfterLastLine) {
                state.completedSequenceIds.add(activeSequence.id);
                state.activeSequenceId = null;
                state.activeElapsed = 0;
            }
            return;
        }

        const layout = Game.prototype.getExperimentalSceneryLayout.call(this);
        if (!layout) return;

        const player = this.players.find(candidate => !candidate.isNPC && !candidate.isDead && !candidate.isEliminated);
        if (!player || player.roomId !== layout.areaId) return;

        const nextSequence = sequences.find(sequence => !state.completedSequenceIds.has(sequence.id));
        if (!nextSequence) return;

        const speaker = layout[nextSequence.speaker];
        if (!speaker) return;
        const distance = Math.hypot(player.x - speaker.x, player.y - speaker.y);
        if (distance > nextSequence.triggerRadius) return;

        state.activeSequenceId = nextSequence.id;
        state.activeElapsed = 0;
    }

    drawExperimentalSectorBackground(ctx, camera) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return;
        if (!this.assets.schoolDeskBackground) return;

        const currentArea = Game.prototype.getExperimentalRenderArea.call(this);
        if (!currentArea || ![1, SECTOR_9_BBG_ENCOUNTER.roomNumber].includes(currentArea.roomNumber)) return;

        if (currentArea.roomNumber === SECTOR_9_BBG_ENCOUNTER.roomNumber) {
            const rect = getSector9BBGImageRect(currentArea);
            const image = this.assets.bbgScenery;
            if (!rect || !image) return;
            ctx.save();
            camera.apply(ctx, rect.centerX, rect.centerY);
            ctx.globalAlpha = 0.9;
            ctx.drawImage(image, -rect.width / 2, -rect.height / 2, rect.width, rect.height);
            ctx.restore();
            if (typeof window !== 'undefined' && window.ZORKA_DEBUG_BBG_ANCHORS) {
                for (const anchor of SECTOR_9_BBG_ENCOUNTER.anchors) {
                    const position = getSector9BBGAnchorWorldPosition(currentArea, anchor);
                    if (!position) continue;
                    ctx.save();
                    camera.apply(ctx, position.x, position.y);
                    ctx.strokeStyle = '#00ffff';
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.arc(0, 0, 20, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                }
            }
            return;
        }

        const { left, right, top, bottom } = currentArea.bounds;
        const width = right - left;
        const height = bottom - top;
        const centerX = left + width / 2;
        const centerY = top + height / 2;

        ctx.save();
        camera.apply(ctx, centerX, centerY);
        ctx.globalAlpha = 0.4;

        const image = this.assets.schoolDeskBackground;
        const imageScale = 1.5;

        const drawWidth = image.naturalWidth * imageScale;
        const drawHeight = image.naturalHeight * imageScale;

        // Preserve the original room-local placement as normalized offsets.
        const offsetX = width * -0.02158564814814815;
        const offsetY = height * 0.006172839506172839;

        ctx.drawImage(
            image,
            -drawWidth / 2 + offsetX,
            -drawHeight / 2 + offsetY,
            drawWidth,
            drawHeight
        );

        const localPlayer = this.players.find(player => !player.isNPC);
        const visorImage = this.assets.schoolDeskVisor;

        if (localPlayer && visorImage) {
            const visorColor = localPlayer.color || '#00ffff';
            const visorWidth = visorImage.naturalWidth;
            const visorHeight = visorImage.naturalHeight;

            if (
                !this.schoolDeskVisorTint
                || this.schoolDeskVisorTint.color !== visorColor
                || this.schoolDeskVisorTint.width !== visorWidth
                || this.schoolDeskVisorTint.height !== visorHeight
            ) {
                const tintedCanvas = document.createElement('canvas');
                tintedCanvas.width = visorWidth;
                tintedCanvas.height = visorHeight;

                const tintedCtx = tintedCanvas.getContext('2d');
                tintedCtx.drawImage(visorImage, 0, 0);
                tintedCtx.globalCompositeOperation = 'source-in';
                tintedCtx.fillStyle = visorColor;
                tintedCtx.fillRect(0, 0, visorWidth, visorHeight);

                this.schoolDeskVisorTint = {
                    canvas: tintedCanvas,
                    color: visorColor,
                    width: visorWidth,
                    height: visorHeight
                };
            }

            ctx.drawImage(
                this.schoolDeskVisorTint.canvas,
                -drawWidth / 2 + offsetX,
                -drawHeight / 2 + offsetY,
                drawWidth,
                drawHeight
            );
        }

        ctx.restore();
    }

    drawExperimentalScenery(ctx, camera) {
        if (this.gameState !== GAME_MODE.EXPERIMENTAL) return;
        const layout = Game.prototype.getExperimentalSceneryLayout.call(this);
        if (!layout) return;

        for (const item of [layout.squid, layout.upperCranioid, layout.lowerCranioid]) {
            if (!item.image) continue;

            const halfWidth = item.width / 2;
            const halfHeight = item.height / 2;
            const visibleHalfWidth = DESIGN_WIDTH / (2 * camera.zoom) + halfWidth;
            const visibleHalfHeight = DESIGN_HEIGHT / (2 * camera.zoom) + halfHeight;

            if (
                Math.abs(item.x - camera.x) > visibleHalfWidth
                || Math.abs(item.y - camera.y) > visibleHalfHeight
            ) continue;

            ctx.save();
            camera.apply(ctx, item.x, item.y);
            ctx.globalAlpha = item.alpha;
            ctx.drawImage(item.image, -halfWidth, -halfHeight, item.width, item.height);
            ctx.restore();
        }
    }

    drawExperimentalDialogue(ctx, camera) {
        const state = this.experimentalDialogueState;
        if (!state?.activeSequenceId) return;

        const layout = Game.prototype.getExperimentalSceneryLayout.call(this);
        if (!layout) return;
        const sequence = Game.prototype.getExperimentalDialogueSequences.call(this)
            .find(candidate => candidate.id === state.activeSequenceId);
        if (!sequence) return;

        const speaker = layout[sequence.speaker];
        if (!speaker) return;

        const visibleLines = sequence.lines.filter(line => state.activeElapsed >= (line.revealAt || 0));
        for (const line of visibleLines) {
            const textX = speaker.x + line.textOffsetX;
            const textY = speaker.y + line.textOffsetY;

            // Pointer lines remain available per line, but are temporarily disabled.
            if (line.showPointer) {
                ctx.save();
                camera.apply(ctx, speaker.x, speaker.y);
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 6;
                ctx.lineCap = 'round';
                ctx.shadowColor = '#000000';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.moveTo(line.pointerOffsetX || 0, line.pointerOffsetY || 0);
                ctx.lineTo(
                    line.textOffsetX > 0 ? line.textOffsetX - 24 : line.textOffsetX + line.maxTextWidth + 24,
                    line.textOffsetY + 18
                );
                ctx.stroke();
                ctx.restore();
            }

            ctx.save();
            camera.apply(ctx, textX, textY);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 42px "Courier New", monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.shadowColor = '#000000';
            ctx.shadowBlur = 12;
            Game.prototype.drawWrappedWorldText.call(this, ctx, line.text, line.maxTextWidth, 50);
            ctx.restore();
        }
    }

    drawWrappedWorldText(ctx, text, maxWidth, lineHeight) {
        const words = String(text).split(/\s+/);
        let line = '';
        let y = 0;
        for (const word of words) {
            const testLine = line ? `${line} ${word}` : word;
            if (line && ctx.measureText(testLine).width > maxWidth) {
                ctx.fillText(line, 0, y);
                line = word;
                y += lineHeight;
            } else {
                line = testLine;
            }
        }
        if (line) ctx.fillText(line, 0, y);
    }

    drawExperimentalWalls(ctx, camera) {
        for (const { area: room, wall } of Game.prototype.getExperimentalRenderableWalls.call(this, camera)) {
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
        for (const door of this.experimentalDoors || []) {
            const shortcutLocked = Game.prototype.isExperimentalShortcutDoorLocked.call(this, door);
            if (!shortcutLocked && !Game.prototype.isExperimentalProgressionDoorLocked.call(this, door)) continue;
            const blocker = door.blocker;
            const dx = blocker.end.x - blocker.start.x;
            const dy = blocker.end.y - blocker.start.y;
            ctx.save();
            camera.apply(ctx, blocker.start.x, blocker.start.y);
            ctx.strokeStyle = shortcutLocked ? door.color : '#ff5a5a';
            ctx.shadowColor = shortcutLocked ? door.color : '#ff2020';
            ctx.shadowBlur = 18;
            ctx.lineWidth = 10;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(dx, dy);
            ctx.stroke();
            ctx.restore();
        }
    }

    getExperimentalRenderableWalls(camera) {
        const currentArea = Game.prototype.getExperimentalRenderArea.call(this);
        if (!currentArea) return [];
        const renderAreaIds = new Set([currentArea.id, ...(currentArea.connectedAreaIds || [])]);
        const halfWidth = DESIGN_WIDTH / (2 * camera.zoom);
        const halfHeight = DESIGN_HEIGHT / (2 * camera.zoom);
        const viewport = {
            left: camera.x - halfWidth,
            right: camera.x + halfWidth,
            top: camera.y - halfHeight,
            bottom: camera.y + halfHeight
        };
        const intersectsViewport = wall => Math.max(wall.start.x, wall.end.x) >= viewport.left
            && Math.min(wall.start.x, wall.end.x) <= viewport.right
            && Math.max(wall.start.y, wall.end.y) >= viewport.top
            && Math.min(wall.start.y, wall.end.y) <= viewport.bottom;
        const renderableWalls = [];
        for (const room of this.experimentalRooms.filter(area => renderAreaIds.has(area.id))) {
            for (const wall of room.walls) {
                if (!intersectsViewport(wall)) continue;
                renderableWalls.push({ area: room, wall });
            }
        }
        return renderableWalls;
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
