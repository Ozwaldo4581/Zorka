export class AudioManager {
    constructor() {
        this.ctx = null;
        this.buffers = {};
        this.isUnlocked = false;
        this.pendingBGMName = null;
        this.musicVolumeLevel = 2;
        this.sfxVolumeLevel = 5;
        
        this.assetPaths = {
            'laser_fire': 'assets/audio/laser_fire.mp3',
            'explosion': 'assets/audio/explosion.mp3',
            'space_ambient': 'assets/audio/space_ambient.mp3',
            'shield_hit': 'assets/audio/explosion.mp3', // Fallback for shield hit
            'thrust': 'assets/audio/laser_fire.mp3', // Placeholder, choosing a short action sound for thrust pulse
            'nes_music': 'assets/audio/nes_space_music.mp3',
            'nes_music_dark': 'assets/audio/nes_space_music_dark.mp3', // Darker, more serious title screen variant
            'nes_music_intro': 'assets/audio/nes_music_intro.mp3', // Authentic retro NES-style intro/title theme
            'nes_music_epic': 'assets/audio/epic-sci-fi-nes-theme.mp3' // Serious, epic space-themed intro theme
        };
    }

    clampVolumeLevel(level) {
        const numericLevel = Number(level);
        if (!Number.isFinite(numericLevel)) return 0;
        return Math.max(0, Math.min(5, Math.round(numericLevel)));
    }

    volumeLevelToGain(level) {
        return this.clampVolumeLevel(level) / 5;
    }

    setMusicVolumeLevel(level) {
        this.musicVolumeLevel = this.clampVolumeLevel(level);
        if (this.bgm) this.bgm.volume = this.volumeLevelToGain(this.musicVolumeLevel);
    }

    setSfxVolumeLevel(level) {
        this.sfxVolumeLevel = this.clampVolumeLevel(level);
    }

    getMusicVolumeLevel() {
        return this.musicVolumeLevel;
    }

    getSfxVolumeLevel() {
        return this.sfxVolumeLevel;
    }

    async unlock() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            
            // Load all sounds
            for (const [name, path] of Object.entries(this.assetPaths)) {
                this.loadBuffer(name, path);
            }
        }
        
        if (this.ctx.state === 'suspended') {
            try {
                await this.ctx.resume();
            } catch (e) {
                return; // Still no interaction
            }
        }
        
        this.isUnlocked = true;

        // If BGM was blocked, try starting it now that we have interaction
        if (this.pendingBGMName) {
            this.startBGM(this.pendingBGMName);
            this.pendingBGMName = null;
        }
    }

    async loadBuffer(name, path) {
        try {
            const response = await fetch(path);
            const arrayBuffer = await response.arrayBuffer();
            this.buffers[name] = await this.ctx.decodeAudioData(arrayBuffer);
        } catch (e) {
            console.warn(`Failed to load sound: ${name}`, e);
        }
    }

    async stopBGM() {
        this.bgmToken = (this.bgmToken || 0) + 1; // Invalidate any in-flight play() call
        this.pendingBGMName = null;
        if (this.bgm) {
            const bgm = this.bgm;
            this.bgm = null;
            try {
                bgm.pause();
                bgm.currentTime = 0;
            } catch (e) { /* ignore */ }
        }
    }

    async startBGM(name = 'space_ambient') {
        this.bgmToken = (this.bgmToken || 0) + 1;
        const token = this.bgmToken;

        if (this.bgm) {
            const oldBgm = this.bgm;
            this.bgm = null;
            try { oldBgm.pause(); } catch (e) { /* ignore */ }
        }

        const bgm = new Audio(this.assetPaths[name]);
        bgm.loop = true;
        bgm.volume = this.volumeLevelToGain(this.musicVolumeLevel);
        this.bgm = bgm;

        try {
            await bgm.play();
            // If stopBGM/startBGM was called again while this play() was pending, discard it
            if (token !== this.bgmToken) {
                bgm.pause();
            }
            this.pendingBGMName = null;
        } catch (e) {
            // Silence NotAllowedError as it's expected without interaction
            if (e.name === 'NotAllowedError') {
                this.pendingBGMName = name;
            } else if (e.name !== 'AbortError') {
                console.warn('BGM play failed:', e);
            }
        }
    }

    play(name, volumeScale = 1) {
        if (!this.isUnlocked || !this.buffers[name]) return;
        
        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers[name];
        
        const gainNode = this.ctx.createGain();
        let volume = 0.6;
        if (name === 'laser_fire') volume = 0.15;
        if (name === 'explosion') volume = 0.5;
        if (name === 'thrust') volume = 0.05; // Very subtle for recurring thruster noise
        
        gainNode.gain.value = Math.max(0, Math.min(1, volume * volumeScale * this.volumeLevelToGain(this.sfxVolumeLevel)));
        
        source.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        source.start(0);
    }

    playSpatial(name, x, y, cameras, worldWidth, worldHeight) {
        if (!this.isUnlocked || !this.buffers[name]) return;

        // Check visibility in any camera
        let visible = false;
        let pannedX = 0; // Average panning
        let count = 0;

        cameras.forEach(cam => {
            if (cam.isPointOnScreen(x, y)) {
                visible = true;
                // Calculate panning: -1 (left) to 1 (right)
                // x is world coord. cam.x is world center of camera.
                const relativeX = x - cam.x;
                // Assuming DESIGN_WIDTH is the viewport width
                const pan = Math.max(-1, Math.min(1, relativeX / (1920 / 2)));
                pannedX += pan;
                count++;
            }
        });

        if (!visible) return;

        const avgPan = pannedX / count;
        
        const source = this.ctx.createBufferSource();
        source.buffer = this.buffers[name];
        
        const gainNode = this.ctx.createGain();
        let volume = 0.6;
        if (name === 'laser_fire') volume = 0.15;
        if (name === 'explosion') volume = 0.5;
        if (name === 'thrust') volume = 0.05;
        gainNode.gain.value = volume * this.volumeLevelToGain(this.sfxVolumeLevel);

        const panner = this.ctx.createStereoPanner();
        panner.pan.value = avgPan;

        source.connect(gainNode);
        gainNode.connect(panner);
        panner.connect(this.ctx.destination);
        
        source.start(0);
    }

    playSpatialUnwrapped(name, x, y, cameras) {
        // Camera transforms already encode room visibility; unlike wrapped-mode
        // callers, no alternate world copies or global dimensions are supplied.
        this.playSpatial(name, x, y, cameras);
    }
}
