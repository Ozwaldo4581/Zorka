import { Player } from './entities/player.js';
import { Asteroid } from './entities/asteroid.js';
import { SpaceDebris, Satellite } from './entities/hazards.js';
import { Projectile } from './entities/projectile.js';
import { Camera } from './camera.js';
import { HUD } from './ui/hud.js';
import { AudioManager } from './audio_manager.js';
import { checkCollision } from './physics.js';

export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;
export const WORLD_WIDTH = DESIGN_WIDTH * 9;
export const WORLD_HEIGHT = DESIGN_HEIGHT * 9;

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
        this.pressStartVisible = true;
        this.pressStartTimer = 0;
        this.titleInputLockTimer = 0;

        // Hide menu overlay initially
        document.getElementById('menu-overlay').classList.add('hidden');

        this.players = [];
        this.asteroids = [];
        this.hazards = [];
        this.projectiles = [];
        this.vfx = [];

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
        
        // P1 Control Mode: 'KEYBOARD' or 'GAMEPAD' (defaults to GAMEPAD across all modes)
        this.p1ControlMode = 'GAMEPAD'; 
        this.p1WasdMode = 'RELATIVE';
        this.swapUI = false;
        this.transformationKills = 20;
        this.cursorVisible = true;
        
        // New Arena Options
        this.asteroidDensityLevel = 3; // Default to 3 (scaled 0-5)
        this.debrisDensityLevel = 3; 
        this.satelliteDensityLevel = 3;
        this.startingShieldCharges = 3;
        this.botAggressionLevel = 0; // 0 = Random, 1-5 = Fixed
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
            explosion: await this.loadImage('assets/explosion_vfx.webp'),
            splash: await this.loadImage('assets/8ecdc9b2-3cce-414a-bc1c-3787877ae412.png')
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
        this.resetMouseLockInput();
        // Keep space_ambient playing
        this.players = [];

        // Determine starting shield charges
        const startShields = this.startingShieldCharges || 0;

        const isSolo = mode === 'SOLO';
        const isPvP = mode === 'PVP';
        const isOnline = mode === 'ONLINE';

        if (isOnline && onlineRoomConfig) {
            this.transformationKills = onlineRoomConfig.transKills || 20;
        } else {
            this.transformationKills = 20;
        }

        let colors = ['#00ffff', '#ff00ff', '#ffff00', '#ff0000', '#00ff00', '#0000ff', '#ff8800', '#8800ff'];
        
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
            if (startShields > 0) {
                p1.hasForcefield = true;
                p1.shieldCharges = startShields;
            }
            // Name input removed from HTML, just use P1
            p1.name = "PLAYER 1";
            p1.controlMode = this.p1ControlMode;
            p1.wasdMode = this.p1WasdMode;
            this.players.push(p1);

            // NPCs for Solo Battle
            if (shipCount > 1) {
                for (let i = 1; i < shipCount; i++) {
                    const spawn = sectors.pop() || { x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT };
                    const p = new Player(spawn.x, spawn.y, i + 1, colors[i % colors.length]);
                    if (startShields > 0) {
                        p.hasForcefield = true;
                        p.shieldCharges = startShields;
                    }
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
                    if (startShields > 0) {
                        p.hasForcefield = true;
                        p.shieldCharges = startShields;
                    }
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
            if (startShields > 0) {
                p1.hasForcefield = true;
                p1.shieldCharges = startShields;
                p2.hasForcefield = true;
                p2.shieldCharges = startShields;
            }
            p1.name = "PLAYER 1";
            p2.name = "PLAYER 2";
            p1.controlMode = this.p1ControlMode;
            p1.wasdMode = this.p1WasdMode;
            p2.controlMode = 'GAMEPAD'; // P2 is always gamepad
            this.players.push(p1, p2);

            // Fill remainder with bots
            for (let i = 2; i < shipCount; i++) {
                const spawn = sectors.pop() || { x: Math.random() * WORLD_WIDTH, y: Math.random() * WORLD_HEIGHT };
                const p = new Player(spawn.x, spawn.y, i + 1, colors[i % colors.length]);
                if (startShields > 0) {
                    p.hasForcefield = true;
                    p.shieldCharges = startShields;
                }
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
            if (startShields > 0) {
                p1.hasForcefield = true;
                p1.shieldCharges = startShields;
            }
            p1.name = "PILOT";
            p1.controlMode = this.p1ControlMode;
            this.players = [p1];
        }
    }

    spawnRemotePlayer(x, y, networkId, color = '#00ffff') {
        const p = new Player(x, y, 3, color);
        p.networkId = networkId;
        
        // Apply starting shield charges
        if (this.startingShieldCharges > 0) {
            p.hasForcefield = true;
            p.shieldCharges = this.startingShieldCharges;
        }

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
        // Density Level (0-5): 0 = 0, 1 = 80, 2 = 160, 3 = 240, 4 = 320, 5 = 400
        const asteroidCount = this.asteroidDensityLevel * 80;
        for (let i = 0; i < asteroidCount; i++) {
            this.spawnAsteroid('large');
        }

        // Space Debris: 0=0, 1=3, 2=7, 3=10, 4=16, 5=21
        const debrisCounts = [0, 3, 7, 10, 16, 21];
        const debrisCount = debrisCounts[this.debrisDensityLevel] || 0;
        for (let i = 0; i < debrisCount; i++) {
            this.spawnSpaceDebris();
        }

        // Broken Satellites: 0=0, 1=3, 2=5, 3=6, 4=9, 5=14
        const satelliteCounts = [0, 3, 5, 6, 9, 14];
        const satelliteCount = satelliteCounts[this.satelliteDensityLevel] || 0;
        for (let i = 0; i < satelliteCount; i++) {
            this.spawnSatellite();
        }
    }

    spawnSpaceDebris() {
        const x = Math.random() * WORLD_WIDTH;
        const y = Math.random() * WORLD_HEIGHT;
        this.hazards.push(new SpaceDebris(x, y));
    }

    spawnSatellite() {
        const x = Math.random() * WORLD_WIDTH;
        const y = Math.random() * WORLD_HEIGHT;
        this.hazards.push(new Satellite(x, y));
    }

    spawnAsteroid(size, x, y) {
        let attempts = 0;
        const maxAttempts = 50;
        
        if (x === undefined || y === undefined) {
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
        
        const asteroid = new Asteroid(x, y, size);
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

            // Locked cursor presentation is updated from its world point each frame.
            if (this.domCursor && !this.players[0]?.aimLockActive) {
                this.domCursor.style.left = `${e.clientX}px`;
                this.domCursor.style.top = `${e.clientY}px`;
                this.domCursor.style.display = 'block';
            }
        });
        window.addEventListener('mousedown', (e) => {
            if (this.gameState === 'SPLASH') {
                this.advanceFromSplash();
                return;
            }
            if (e.button === 0) this.mouse.clicked = true;
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
        window.addEventListener('blur', () => this.resetMouseLockInput());
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.resetMouseLockInput();
        });

        // Menu buttons
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
            
            // No bot selected by default
            this.selectedBotCount = 0;
            document.querySelectorAll('.bot-count-btn').forEach(b => b.classList.remove('selected'));
            this.updateSoloMockLobby(0);
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

        const refreshWasdOptionButtons = () => {
            document.querySelectorAll('.mouse-control-btn[data-wasd-mode]').forEach(btn => {
                const isSelected = btn.dataset.wasdMode === this.p1WasdMode;
                btn.classList.toggle('selected', isSelected);
                btn.setAttribute('aria-pressed', String(isSelected));
            });
        };

        document.getElementById('btn-main-options-open').addEventListener('click', () => {
            this.optionsOpenedFromPause = false;

            const popup = document.getElementById('main-options-popup');
            popup.classList.remove('hidden');
            popup.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
            refreshAudioOptionButtons();
            refreshWasdOptionButtons();

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

        document.querySelectorAll('.mouse-control-btn[data-wasd-mode]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.p1WasdMode = btn.dataset.wasdMode;
                const p1 = this.players.find(player => player.id === 1 && !player.isNPC);
                if (p1) p1.wasdMode = this.p1WasdMode;
                refreshWasdOptionButtons();
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
            e.stopPropagation();
        });

        gpBtn.addEventListener('click', (e) => {
            if (gpBtn.disabled) return;
            this.p1ControlMode = 'GAMEPAD';
            gpBtn.classList.add('selected');
            kbBtn.classList.remove('selected');
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
            refreshWasdOptionButtons();

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
            this.closePauseMenu();
            this.returnToMenu();
        });

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
        return this.gameState !== 'MENU' && this.gameState !== 'SPLASH';
    }

    resetMouseLockInput() {
        this.mouse.m2Held = false;
        this.mouse.m2Pressed = false;
        this.mouse.m2Released = false;
        this.players[0]?.clearAimLock();
    }

    togglePauseMenu() {
        if (this.isPauseMenuOpen) {
            this.closePauseMenu();
        } else {
            this.openPauseMenu();
        }
    }

    openPauseMenu() {
        this.resetMouseLockInput();
        this.isPauseMenuOpen = true;
        document.getElementById('pause-menu').classList.remove('hidden');

        // Reset gamepad navigation state and highlight the first button
        this.pauseMenuIndex = 0;
        this.pauseMenuCooldown = 0.3; // Small delay so the Start press that opened this doesn't also select
        const buttons = Array.from(document.getElementById('pause-menu').querySelectorAll('button:not([disabled])'));
        buttons.forEach((btn, i) => {
            if (i === 0) btn.classList.add('focused');
            else btn.classList.remove('focused');
        });
    }

    closePauseMenu() {
        this.isPauseMenuOpen = false;
        document.getElementById('pause-menu').classList.add('hidden');
        // Clear focus
        document.getElementById('pause-menu').querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
    }

    // Gamepad D-pad/stick navigation for the floating in-game pause menu (Escape/Start menu)
    updatePauseMenuNavigation(dt) {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = gamepads[0];
        if (!gp) return;

        if (this.pauseMenuCooldown > 0) {
            this.pauseMenuCooldown -= dt;
            return;
        }

        const menuEl = document.getElementById('pause-menu');
        if (!menuEl || menuEl.classList.contains('hidden')) return;

        const buttons = Array.from(menuEl.querySelectorAll('button:not([disabled])'));
        if (buttons.length === 0) return;

        const iy = gp.axes[1];
        const ix = gp.axes[0];
        const up = gp.buttons[12].pressed || iy < -0.5;
        const down = gp.buttons[13].pressed || iy > 0.5;
        const left = gp.buttons[14].pressed || ix < -0.5;
        const right = gp.buttons[15].pressed || ix > 0.5;

        let changed = false;
        if (up || left) {
            this.pauseMenuIndex = (this.pauseMenuIndex - 1 + buttons.length) % buttons.length;
            changed = true;
        } else if (down || right) {
            this.pauseMenuIndex = (this.pauseMenuIndex + 1) % buttons.length;
            changed = true;
        }

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
        this.resetMouseLockInput();
        if (this.network) {
            this.network.leave();
        }
        this.closePauseMenu();
        this.gameState = 'MENU';
        document.getElementById('menu-overlay').classList.remove('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
        document.getElementById('solo-menu').classList.add('hidden');
        document.getElementById('online-menu').classList.add('hidden');
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

        this.players = [];
        this.asteroids = [];
        this.hazards = [];
        this.projectiles = [];
        this.vfx = [];
    }

    handleFire(playerId, isBurstShot = false) {
        const player = this.players.find(p => p.id === playerId);
        if (!player || player.isDead) return;
        
        const projs = player.fire(isBurstShot);
        if (projs && projs.length > 0) {
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
        } else if (this.gameState !== 'MENU') {
            // Only update game if local player is not eliminated, or show results
            this.update(dt);
            if (this.isPauseMenuOpen) {
                this.updatePauseMenuNavigation(dt);
            }
        } else {
            this.updateMenuNavigation(dt);
        }
        this.draw();

        requestAnimationFrame((t) => this.loop(t));
    }

    // Hide the cursor if any gamepad input is detected
    updateGamepadVisibilityDetection() {
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
        if (!this.isInGameplayState()) {
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
        if (this.gameState !== 'MENU') return; // Gate menu navigation
        if (this.titleInputLockTimer > 0) return; 

        // Update gamepad connection statuses in visible menus
        if (!document.getElementById('solo-menu').classList.contains('hidden')) {
            this.updateGamepadStatus();
        }
        if (!document.getElementById('online-menu').classList.contains('hidden')) {
            this.updateOnlineGamepadStatus();
        }
        
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const gp = gamepads[0];
        if (!gp) return;

        if (this.menuCooldown > 0) {
            this.menuCooldown -= dt;
            return;
        }

        // Determine the current active menu container, checking for popups first
        let activeMenu = null;
        const potentialContainers = ['main-options-popup', 'botless-popup', 'options-popup', 'solo-menu', 'online-menu', 'main-menu'];
        for (const id of potentialContainers) {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden')) {
                activeMenu = el;
                // If it's a menu-level container, only count it if it's the specific active one
                if (id === 'solo-menu' || id === 'online-menu' || id === 'main-menu') {
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
        const buttons = Array.from(activeMenu.querySelectorAll('button:not([disabled]), .lobby-item')).filter(el => {
            // Ensure the element itself or its parents are not hidden
            return el.offsetParent !== null;
        });

        if (buttons.length === 0) return;

        // Boundary check for menuIndex
        if (this.menuIndex >= buttons.length) this.menuIndex = 0;

        // Navigation (Stick or D-pad)
        const iy = gp.axes[1];
        const ix = gp.axes[0];
        const up = gp.buttons[12].pressed || iy < -0.5;
        const down = gp.buttons[13].pressed || iy > 0.5;
        const left = gp.buttons[14].pressed || ix < -0.5;
        const right = gp.buttons[15].pressed || ix > 0.5;

        let changed = false;
        if (up || left) {
            this.menuIndex = (this.menuIndex - 1 + buttons.length) % buttons.length;
            changed = true;
        } else if (down || right) {
            this.menuIndex = (this.menuIndex + 1) % buttons.length;
            changed = true;
        }

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
            kbBtn.classList.add('selected');
            kbBtn.disabled = true;
            gpBtn.classList.remove('selected');
            gpBtn.disabled = true;
            this.p1ControlMode = 'KEYBOARD';
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
            kbBtn.classList.add('selected');
            kbBtn.disabled = true;
            gpBtn.classList.remove('selected');
            gpBtn.disabled = true;
            this.p1ControlMode = 'KEYBOARD';
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

        for (let player of this.players) {
            if (player.isEliminated) continue; // Skip eliminated players completely

            if (!player.isDead) {
                if (player.id <= 2 && !player.isNPC) {
                    const oldPrestigeLevel = player.prestigeLevel;
                    const inputCamera = player.id === 1 ? this.getPlayerOneCamera() : this.camera;
                    player.update(dt, this.keys, this.mouse, inputCamera, this.players, this.asteroids, gamepads, this.gameState === 'PVP', this.transformationKills, this.hazards);
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
                    const gamepadsList = Array.from(gamepads).filter(g => g !== null);
                    let gp = null;
                    if (player.id === 1 && player.controlMode === 'GAMEPAD') {
                        if (gamepadsList.length >= 1) gp = gamepadsList[0];
                    } else if (player.id === 2) {
                        const p1OnGamepad = this.players[0] && this.players[0].controlMode === 'GAMEPAD';
                        if (p1OnGamepad) {
                            if (gamepadsList.length >= 2) gp = gamepadsList[1];
                        } else {
                            if (gamepadsList.length >= 1) gp = gamepadsList[0];
                        }
                    }
                    
                    if (gp) {
                        const rt = gp.buttons[7]; // R2 / RT
                        if (rt && rt.pressed && player.fireCooldown <= 0) {
                            this.handleFire(player.id);
                        }
                    }
                } else if (player.isNPC) {
                    player.update(dt, {}, {}, this.camera, this.players, this.asteroids, [], false, this.transformationKills, this.hazards);
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

        this.asteroids.forEach(a => a.update(dt));
        this.hazards.forEach(h => h.update(dt, this));
        
        const activeCameras = this.getActiveCameras();
        
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            if (p.isOrbital && (!p.owner || p.owner.isEliminated || p.owner.isDead)) {
                this.projectiles.splice(i, 1);
                continue;
            }
            p.update(dt, this.asteroids, this.players, this.hazards);
            
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
                    this.projectiles.splice(i, 1);
                    continue;
                }
            }
            
            if (p.lifeSpan < 0 && !p.isOrbital) {
                this.projectiles.splice(i, 1);
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
        
        if (this.players[0]) {
            this.camera.follow(this.players[0]);
        }
    }

    respawnPlayer(player) {
        player.clearAimLock();
        player.isDead = false;
        player.vx = 0;
        player.vy = 0;
        player.spawnImmunityTimer = 1.0; 

        // Apply starting shield charges
        if (this.startingShieldCharges > 0) {
            player.hasForcefield = true;
            player.shieldCharges = this.startingShieldCharges;
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
            // Spatial audio
            const cameras = this.getActiveCameras();
            this.audio.playSpatial('explosion', target.x, target.y, cameras, WORLD_WIDTH, WORLD_HEIGHT);
            
            this.createExplosion(target.x, target.y, target.radius);
            
            if (target instanceof Asteroid) {
                if (target.size === 'large') {
                    for (let i = 0; i < 3; i++) this.spawnAsteroid('medium', target.x, target.y);
                    
                    // Queue a respawn for a new large asteroid
                    const delay = 12 + Math.random() * 32; // 12 to 44 seconds
                    setTimeout(() => {
                        if (this.gameState !== 'MENU') {
                            this.spawnAsteroid('large');
                        }
                    }, delay * 1000);
                } else if (target.size === 'medium') {
                    for (let i = 0; i < 3; i++) this.spawnAsteroid('small', target.x, target.y);
                }

                const currentIndex = this.asteroids.indexOf(target);
                if (currentIndex !== -1) {
                    this.asteroids.splice(currentIndex, 1);
                }
            } else if (target.isDebris || target.isSatellite) {
                // Award capsule for space debris and broken satellite
                if (killer && killer.addCapsule) {
                    killer.addCapsule();
                }

                const currentIndex = this.hazards.indexOf(target);
                if (currentIndex !== -1) {
                    this.hazards.splice(currentIndex, 1);
                }

                // If satellite, spawn another one
                if (target.isSatellite) {
                    this.spawnSatellite();
                }
                
                // If debris, maybe respawn later like asteroids
                if (target.isDebris) {
                    const delay = 30 + Math.random() * 60;
                    setTimeout(() => {
                        if (this.gameState !== 'MENU') {
                            this.spawnSpaceDebris();
                        }
                    }, delay * 1000);
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
        return true;
    }

    applyPrestigeShieldPulse(sourcePlayer) {
        const cameras = this.getActiveCameras();

        for (const player of this.players) {
            if (!player || player === sourcePlayer || player.isDead || player.isEliminated) continue;
            player.hasForcefield = true;
            this.audio.playSpatial('shield_hit', player.x, player.y, cameras, WORLD_WIDTH, WORLD_HEIGHT);
        }
    }

    playerDeath(player, killer) {
        // Spawn immunity check
        if (player.spawnImmunityTimer > 0) return;

        // If player has forcefield, absorb hit instead of death
        const cameras = this.getActiveCameras();
        if (player.hasForcefield) {
            player.shieldCharges = (player.shieldCharges || 1) - 1;
            if (player.shieldCharges <= 0) {
                player.hasForcefield = false;
                player.shieldCharges = 0;
            }
            this.audio.playSpatial('shield_hit', player.x, player.y, cameras, WORLD_WIDTH, WORLD_HEIGHT); 
            return;
        }

        player.isDead = true;
        player.clearAimLock();
        player.respawnTimer = 2;
        
        // Reset ALL power-up progress on death
        player.powerUpCapsules = 0;
        player.activeGun = 'Normal';
        player.ghosts = []; 
        player.hasMissile = false;
        player.hasForcefield = false;
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

        // Credit killer if it was another ship
        if (killer && killer !== player && typeof killer.addCapsule === 'function') {
            killer.addCapsule();
            killer.score = (killer.score || 0) + 1;

            // Kill streak / High Tide tracking
            killer.killStreak = (killer.killStreak || 0) + 1;
            if (killer.killStreak > (killer.highTide || 0)) {
                killer.highTide = killer.killStreak;
            }
        }
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
                if (checkCollision(p, player)) {
                    if (p.isDecoy) {
                        this.createExplosion(p.x, p.y, 60);
                        this.removeProjectile(p);
                        this.playerDeath(player, p.owner);
                    } else if (p.isMissile || p.isSkinnyMissile) {
                        if (p.isSkinnyMissile) this.detonateAoEProjectile(p);
                        else this.detonateMissile(p);
                        this.removeProjectile(p);
                        this.playerDeath(player, p.owner);
                    } else if (p.aoeRadius > 0) {
                        this.detonateAoEProjectile(p);
                        if (!p.isOrbital) this.removeProjectile(p);
                        this.playerDeath(player, p.owner);
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
        for (let player of this.players) {
            if (!player || player.isDead || player.isEliminated || (player.id !== 1 && player.id !== 2)) continue;

            // Asteroids
            for (let a of this.asteroids) {
                if (!a || a.isDestroyed) continue;
                if (checkCollision(player, a)) {
                    this.playerDeath(player);
                    break;
                }
            }
            if (player.isDead) continue;

            // Hazards
            for (let h of this.hazards) {
                if (!h || h.isDestroyed) continue;
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
            const dist = Math.hypot(a.x - p.x, a.y - p.y);
            if (dist < radius + a.radius) {
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

        // Check players
        for (let player of this.players) {
            if (player.isDead || player === p.owner) continue;
            const dist = Math.hypot(player.x - p.x, player.y - p.y);
            if (dist < radius + player.radius) {
                this.playerDeath(player, p.owner);
            }
        }
    }

    // Missiles detonate with a large area-of-effect blast: any asteroid caught in the blast
    // is destroyed instantly (large asteroids die in a single hit instead of requiring three),
    // and any other player caught in the radius is also killed by the explosion.
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
            const dist = Math.hypot(a.x - missile.x, a.y - missile.y);
            if (dist < radius + a.radius) {
                impactedAsteroids.push(a);
            }
        }

        for (const a of impactedAsteroids) {
            if (!a || a.isDestroyed) continue;
            a.hits = a.maxHits - 1; // Force destruction in one shot regardless of size
            this.hitTarget(a, missile.owner);
        }

        // Catch any nearby players in the blast too
        for (let player of this.players) {
            if (player.isDead || player === missile.owner) continue;
            const dist = Math.hypot(player.x - missile.x, player.y - missile.y);
            if (dist < radius + player.radius) {
                this.playerDeath(player, missile.owner);
            }
        }
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
            this.hud.draw(this.ctx, this.players, this.asteroids, this.camera, this.gameState === 'PVP', this.swapUI);
        }

        this.drawCrosshair();
    }

    drawCrosshair() {
        if (!this.cursorVisible || !this.domCursor) return;
        
        // Sync DOM cursor color with player color
        const p1 = this.players.find(p => p.id === 1);
        if (p1?.aimLockActive && p1.controlMode === 'KEYBOARD') {
            const viewport = { x: 0, y: 0, width: this.gameState === 'PVP' ? DESIGN_WIDTH / 2 : DESIGN_WIDTH, height: DESIGN_HEIGHT };
            const point = this.getPlayerOneCamera().worldToScreen(p1.lockedAimX, p1.lockedAimY, viewport);
            const onScreen = point.x >= viewport.x && point.x <= viewport.x + viewport.width
                && point.y >= viewport.y && point.y <= viewport.y + viewport.height;
            this.domCursor.style.display = onScreen ? 'block' : 'none';
            if (onScreen) {
                const rect = this.canvas.getBoundingClientRect();
                this.domCursor.style.left = `${rect.left + point.x * this.scale}px`;
                this.domCursor.style.top = `${rect.top + point.y * this.scale}px`;
            }
        } else {
            this.domCursor.style.display = 'block';
        }
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
        } else if (this.splashPhase === 'TITLE') {
            if (this.assets.splash) {
                // Fit splash image to screen
                this.ctx.drawImage(this.assets.splash, 0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
            }

            if (this.pressStartVisible) {
                this.ctx.font = 'bold 36px Orbitron';
                this.ctx.fillStyle = '#fff';
                this.ctx.textAlign = 'center';
                this.ctx.shadowBlur = 10;
                this.ctx.shadowColor = '#00ffff';
                this.ctx.fillText('PRESS START', DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
                this.ctx.shadowBlur = 0;
            }
        }
    }

    drawSingleScreen() {
        this.ctx.fillStyle = '#050505';
        this.ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);

        this.drawWorld(this.ctx, this.camera);
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
        
        this.asteroids.forEach(a => a.draw(ctx, this.assets, camera));
        this.hazards.forEach(h => h.draw(ctx, this.assets, camera));
        this.projectiles.forEach(p => p.draw(ctx, this.assets, camera));
        this.players.forEach(p => {
            if (!p.isDead && !p.isEliminated) p.draw(ctx, this.assets, camera);
        });
        this.vfx.forEach(v => v.draw(ctx, this.assets, camera));
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
