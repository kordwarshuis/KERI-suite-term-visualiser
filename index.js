
import { main } from './modules/main.js';

const welcomeModal = document.getElementById('welcome-modal');
const welcomeOkBtn = document.getElementById('welcome-ok-btn');

welcomeOkBtn.addEventListener('click', () => {
    welcomeModal.setAttribute('aria-hidden', 'true');
    // This click is a user gesture — resume the AudioContext so Howler sounds play.
    if (globalThis.Howler && globalThis.Howler.ctx) {
        globalThis.Howler.ctx.resume();
    }
    main();
}, { once: true });
