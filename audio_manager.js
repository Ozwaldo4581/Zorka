export const DEFAULT_MUSIC_VOLUME_LEVEL = 2;
export const DEFAULT_SFX_VOLUME_LEVEL = 2;

const MUSIC_GAIN_LIMIT = 1;
const COMBAT_DRUM_GAIN = 0.55;
const COMBAT_FADE_IN_SECONDS = 0.45;
const COMBAT_TIER_FADE_SECONDS = 0.35;
const COMBAT_FADE_OUT_SECONDS = 1.75;

export class AudioManager {
    constructor() {
        this.ctx = null;
        this.buffers = {};
        this.isUnlocked = false;
        this.pendingBGMName = null;
        this.pendingGameplayMusic = false;
        this.gameplayMusic = null;
        this.musicVolumeLevel = DEFAULT_MUSIC_VOLUME_LEVEL;
        this.sfxVolumeLevel = DEFAULT_SFX_VOLUME_LEVEL;
        
        this.assetPaths = {
            'laser_fire': 'assets/audio/laser_fire.mp3',
            'explosion': 'assets/audio/explosion.mp3',
            'space_ambient': 'assets/audio/space_ambient.mp3',
            'shield_hit': 'assets/audio/explosion.mp3', // Fallback for shield hit
            'thrust': 'assets/audio/laser_fire.mp3', // Placeholder, choosing a short action sound for thrust pulse
            'nes_music': 'assets/audio/nes_space_music.mp3',
            'nes_music_dark': 'assets/audio/nes_space_music_dark.mp3', // Darker, more serious title screen variant
            'nes_music_intro': 'assets/audio/nes_music_intro.mp3', // Authentic retro NES-style intro/title theme
            'nes_music_epic': 'assets/audio/epic-sci-fi-nes-theme.mp3', // Serious, epic space-themed intro theme
            'gameplay_music': 'assets/audio/audio [music].mp3',
            'gameplay_drums': 'assets/audio/audio [drums].mp3'
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
        if (this.gameplayMusic?.masterGain) {
            this.gameplayMusic.masterGain.gain.value = this.volumeLevelToGain(this.musicVolumeLevel);
            this.setGameplayMusicMix(this.gameplayMusic.intensity, this.gameplayMusic.drumsActive, true);
        }
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
        this.tryStartGameplayMusic();
    }

    async loadBuffer(name, path) {
        try {
            const response = await fetch(path);
            const arrayBuffer = await response.arrayBuffer();
            this.buffers[name] = await this.ctx.decodeAudioData(arrayBuffer);
            this.tryStartGameplayMusic();
        } catch (e) {
            console.warn(`Failed to load sound: ${name}`, e);
        }
    }

    async stopBGM() {
        this.bgmToken = (this.bgmToken || 0) + 1; // Invalidate any in-flight play() call
        this.pendingBGMName = null;
        this.stopGameplayMusic();
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
        this.stopGameplayMusic();
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

    startGameplayMusic() {
        if (this.gameplayMusic) return;
        this.bgmToken = (this.bgmToken || 0) + 1;
        this.pendingBGMName = null;
        this.pendingGameplayMusic = true;
        if (this.bgm) {
            try { this.bgm.pause(); } catch (e) { /* ignore */ }
            this.bgm = null;
        }
        this.tryStartGameplayMusic();
    }

    tryStartGameplayMusic() {
        if (!this.pendingGameplayMusic || this.gameplayMusic || !this.isUnlocked || !this.ctx
            || !this.buffers.gameplay_music || !this.buffers.gameplay_drums) return;

        const mainSource = this.ctx.createBufferSource();
        const drumSource = this.ctx.createBufferSource();
        const mainGain = this.ctx.createGain();
        const drumGain = this.ctx.createGain();
        const masterGain = this.ctx.createGain();
        mainSource.buffer = this.buffers.gameplay_music;
        drumSource.buffer = this.buffers.gameplay_drums;
        mainSource.loop = true;
        drumSource.loop = true;
        mainGain.gain.value = 1;
        drumGain.gain.value = 0;
        masterGain.gain.value = this.volumeLevelToGain(this.musicVolumeLevel);
        mainSource.connect(mainGain);
        drumSource.connect(drumGain);
        mainGain.connect(masterGain);
        drumGain.connect(masterGain);
        masterGain.connect(this.ctx.destination);

        this.gameplayMusic = {
            mainSource, drumSource, mainGain, drumGain, masterGain,
            intensity: 1, drumsActive: false
        };
        this.pendingGameplayMusic = false;
        const startTime = this.ctx.currentTime + 0.05;
        mainSource.start(startTime);
        drumSource.start(startTime);
    }

    setGameplayMusicMix(intensity = 1, drumsActive = false, immediate = false) {
        const music = this.gameplayMusic;
        if (!music) return;
        const previousDrumsActive = music.drumsActive;
        const safeIntensity = Math.max(1, Math.min(1.45, Number(intensity) || 1));
        const masterGain = this.volumeLevelToGain(this.musicVolumeLevel);
        const mainTarget = masterGain > 0
            ? Math.min(safeIntensity, MUSIC_GAIN_LIMIT / masterGain)
            : safeIntensity;
        const drumTarget = drumsActive ? COMBAT_DRUM_GAIN : 0;
        const fadeSeconds = immediate ? 0
            : !drumsActive ? COMBAT_FADE_OUT_SECONDS
                : previousDrumsActive ? COMBAT_TIER_FADE_SECONDS : COMBAT_FADE_IN_SECONDS;
        const now = this.ctx.currentTime;
        for (const [gainParam, target] of [[music.mainGain.gain, mainTarget], [music.drumGain.gain, drumTarget]]) {
            gainParam.cancelScheduledValues(now);
            gainParam.setValueAtTime(gainParam.value, now);
            gainParam.linearRampToValueAtTime(target, now + fadeSeconds);
        }
        music.intensity = safeIntensity;
        music.drumsActive = Boolean(drumsActive);
    }

    stopGameplayMusic() {
        this.pendingGameplayMusic = false;
        const music = this.gameplayMusic;
        this.gameplayMusic = null;
        if (!music) return;
        for (const source of [music.mainSource, music.drumSource]) {
            try { source.stop(); } catch (e) { /* ignore */ }
            try { source.disconnect(); } catch (e) { /* ignore */ }
        }
        for (const node of [music.mainGain, music.drumGain, music.masterGain]) {
            try { node.disconnect(); } catch (e) { /* ignore */ }
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
