import { CONFIG } from './config.js';

export function setStatus(msg, cls = '') {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
}

export async function fetchPage(url) {
    // 1. Try direct (works if spec headers include CORS, or same origin)
    try {
        const r = await fetch(url, { mode: 'cors' });
        if (r.ok) return r.text();
    } catch (err) {
        console.debug('[graph] direct fetch failed, falling back to proxy:', err);
    }

    // 2. Try via CORS proxy
    if (!CONFIG.corsProxy) throw new Error('No CORS proxy configured and direct fetch failed.');
    const proxyUrl = CONFIG.corsProxy + encodeURIComponent(url);
    const r2 = await fetch(proxyUrl);
    if (!r2.ok) throw new Error(`Proxy returned HTTP ${r2.status} for ${url}`);
    return r2.text();
}
