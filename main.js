import { Game } from './game.js';

// Aggressive suppression for extension-related noise in the console
const SILENCED_PATTERNS = ['MetaMask', 'inpage.js', 'chrome-extension'];

const originalWarn = console.warn;
console.warn = (...args) => {
    const msg = args.join(' ');
    if (SILENCED_PATTERNS.some(p => msg.includes(p))) return;
    originalWarn(...args);
};

const originalError = console.error;
console.error = (...args) => {
    const msg = args.join(' ');
    if (SILENCED_PATTERNS.some(p => msg.includes(p))) return;
    originalError(...args);
};

window.addEventListener('error', (event) => {
    if (event.message && SILENCED_PATTERNS.some(p => event.message.includes(p))) {
        event.stopImmediatePropagation();
    }
}, true);

window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.message && SILENCED_PATTERNS.some(p => event.reason.message.includes(p))) {
        event.stopImmediatePropagation();
    }
}, true);

window.addEventListener('load', () => {
    const game = new Game('game-container');
    game.start();

    // Progress logging
    if (window.ProgressLogger) {
        window.ProgressLogger.logProgress('game_started');
    }
});
