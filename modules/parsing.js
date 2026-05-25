import { CONFIG } from './config.js';

/** Clean up the messy text content of a <dt> into a human label. */
function cleanLabel(raw) {
    return raw
        .replace(/\s+/g, ' ')
        .replace(/[①②③]+/g, '')
        .replace(/\[Link to[^\]]*\]/gi, '')
        .replace(/^[§\s.0-9]+/, '')
        .trim();
}

/**
 * Extract a slug from a <dt> element.
 * Spec-Up-T typically puts id="term:slug" on the dt or a child anchor.
 */
function slugFromDt(dt) {
    const raw = dt.id
        || dt.querySelector('[id]')?.id
        || dt.querySelector('[name]')?.getAttribute('name')
        || '';
    return raw.replace(/^term:/, '') || null;
}

/**
 * Derive a slug from the visible label text.
 * Handles patterns like:
 *   "Autonomic identifier (AID, autonomic-identifier)"  -> "autonomic-identifier"
 *   "Attribute ( attribute)"                            -> "attribute"
 *   "Key-state"                                         -> "key-state"
 */
function deriveSlug(label) {
    // Prefer parenthesised explicit slug at end: "... (foo, the-slug)"
    const m = label.match(/\(\s*(?:[^,)]+,\s*)?([a-z][a-z0-9-]{1,60})\s*\)\s*$/i);
    if (m) return m[1].toLowerCase();
    // Fallback: kebab-case from whole label
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/, '').slice(0, 60);
}

/**
 * Determine what kind of link an href represents within a spec page.
 * Returns null to ignore, or {type, specId ?, slug ?, externalLabel ? }
 */
function classifyHref(href, currentSpec) {
    if (!href || href.startsWith('javascript') || href.startsWith('mailto')) return null;

    // Same-page anchor
    if (href.startsWith('#')) {
        const frag = href.slice(1);
        if (!frag.startsWith('term:') && !frag.includes('-')) return null;
        const slug = frag.replace(/^term:/, '');
        return slug ? { type: 'internal', specId: currentSpec.id, slug } : null;
    }

    let url;
    try {
        url = new URL(href);
    } catch {
        return null;
    }

    const hash = url.hash || '';
    const slug = hash.startsWith('#term:') ? hash.slice(6) : '';
    const base = (url.origin + url.pathname).replace(/\/$/, '');

    // Check against configured specs
    for (const s of CONFIG.specs) {
        const specBase = s.url.replace(/\/$/, '');
        if (base === specBase || base.startsWith(specBase + '/')) {
            if (!slug) return null;
            return {
                type: s.id === currentSpec.id ? 'internal' : 'xref',
                specId: s.id,
                slug,
            };
        }
    }

    // External link that references a term in some glossary
    if (slug) {
        const parts = url.pathname.split('/').filter(Boolean);
        const repo = parts[0] || url.hostname;
        return { type: 'external', externalLabel: repo, slug };
    }

    return null;
}

/** Parse one spec page's HTML, returning {terms, rawLinks}. */
export function parsePage(html, spec) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const terms = [];
    const rawLinks = [];

    // Locate the terms <dl>
    let dl = doc.querySelector('dl.terms-and-definitions-list');
    if (!dl) {
        // Fallback: find any <dl> inside an element whose id contains "terms"
        for (const el of doc.querySelectorAll('[id*="term"],[id*="definition"]')) {
            dl = el.querySelector('dl');
            if (dl) break;
        }
    }
    if (!dl) {
        console.warn(`[graph] No terms DL found for ${spec.id}`);
        return { terms, rawLinks };
    }

    const dts = [...dl.querySelectorAll(':scope > dt')];
    console.log(`[graph] ${spec.id}: ${dts.length} <dt> elements found`);

    for (const dt of dts) {
        const rawText = dt.textContent || '';
        const label = cleanLabel(rawText);
        if (!label || label.length < 2) continue;

        const slug = slugFromDt(dt) || deriveSlug(label);
        const termId = `${spec.id}::${slug}`;
        terms.push({ id: termId, label, slug, specId: spec.id });

        // Collect <a href> links from the following <dd>(s)
        let sib = dt.nextElementSibling;
        while (sib && sib.tagName === 'DD') {
            for (const a of sib.querySelectorAll('a[href]')) {
                const cl = classifyHref(a.getAttribute('href'), spec);
                if (cl) rawLinks.push({ fromId: termId, cl });
            }
            sib = sib.nextElementSibling;
        }
    }

    // Extract xref tref links from embedded allXTrefs data.
    for (const script of doc.querySelectorAll('script:not([src])')) {
        const text = (script.textContent || '').trim();
        if (!text.includes('"xtrefs"')) continue;
        try {
            // Content is: const allXTrefs = {...};
            const eqIdx = text.indexOf('=');
            if (eqIdx === -1) break;
            const jsonStr = text.slice(eqIdx + 1).trim().replace(/;\s*$/, '');
            const xtData = JSON.parse(jsonStr);
            let trefCount = 0;
            for (const xt of (xtData.xtrefs || [])) {
                const hasTref = (xt.sourceFiles || []).some(f => f.type === 'tref');
                if (!hasTref) continue;
                const slug = xt.term;
                if (!slug) continue;
                const ghPageUrl = (xt.ghPageUrl || '').replace(/\/$/, '');
                for (const s of CONFIG.specs) {
                    if (s.id === spec.id) continue;
                    if (ghPageUrl === s.url.replace(/\/$/, '')) {
                        rawLinks.push({
                            fromId: `${spec.id}::${slug}`,
                            cl: { type: 'tref', specId: s.id, slug },
                        });
                        trefCount++;
                        break;
                    }
                }
            }
            console.log(`[graph] ${spec.id}: ${trefCount} tref xref links extracted from allXTrefs`);
        } catch (e) {
            console.warn(`[graph] Failed to parse allXTrefs for ${spec.id}:`, e);
        }
        break;
    }

    return { terms, rawLinks };
}
