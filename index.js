
'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG  ─── add / remove specs here
// ═══════════════════════════════════════════════════════════════════════════════
const CONFIG = {
    specs: [
        {
            id: 'keri',
            label: 'KERI',
            fullLabel: 'Key Event Receipt Infrastructure',
            url: 'https://trustoverip.github.io/kswg-keri-specification/',
            color: '#00ff8c',   // neon green
        },
        {
            id: 'acdc',
            label: 'ACDC',
            fullLabel: 'Authentic Chained Data Containers',
            url: 'https://trustoverip.github.io/kswg-acdc-specification/',
            color: '#00b4ff',   // neon blue
        },
        {
            id: 'cesr',
            label: 'CESR',
            fullLabel: 'Composable Event Streaming Representation',
            url: 'https://trustoverip.github.io/kswg-cesr-specification/',
            color: '#ff8800',   // neon orange
        },
        {
            id: 'kerisuite',
            label: 'KERI Suite',
            fullLabel: 'KERI Suite',
            url: 'https://trustoverip.github.io/kerisuite-glossary/',
            color: '#cc44ff',
        },
        // {
        //     id: 'toip-glossary',
        //     label: 'ToIP Glossary',
        //     fullLabel: 'Trust over IP Glossary',
        //     url: 'https://glossary.trustoverip.org/',
        //     color: '#cc44ff',
        // },
        // ── add extra specs below ─────────────────────────────────────────────────
        // {
        //   id:        'oobi',
        //   label:     'OOBI',
        //   fullLabel: 'Out-of-Band Introduction',
        //   url:       'https://trustoverip.github.io/kswg-oobi-specification/',
        //   color:     '#cc44ff',
        // },
    ],

    // CORS proxy used when direct fetch fails (leave '' to disable).
    // Format: prefix + encodeURIComponent(targetUrl)
    corsProxy: 'https://api.allorigins.win/raw?url=',

    // ── Physics tuning ──────────────────────────────────────────────────────────
    hubCharge: -3000,   // repulsion of hub (spec-center) nodes; min: -3000, max: -200 (was -1200)
    termCharge: -2400,    // repulsion of term nodes; min: -400, max: -20 (was -90)
    externalCharge: -600,    // repulsion of external-glossary nodes; min: -600, max: -40 (was -200)
    centerStrength: 0,    // pull toward cluster center; min: 0.00, max: 0.20 (was 0.06)
    clusterRadiusFraction: 0.38,  // fraction of min(W,H) for hub positions; min: 0.10, max: 0.50 (was 0.27)

    // Simulation settling controls (higher values settle faster).
    simulationVelocityDecay: 0.82, // damping per tick; min: 0.10, max: 1.00; default in d3 is 0.4 (was 0.8)
    simulationAlphaDecay: 0.06,    // cooling rate; min: 0.001, max: 0.100; default in d3 is 0.007 (was 0.08)
    simulationAlphaMin: 0.02,      // stop threshold; min: 0.001, max: 0.100; default in d3 is 0.001 (was 0.08)

    // Auto-lite mode to keep interaction fluid on large graphs.
    perfModeMaxLinks: 700,
    perfModeMaxNodes: 350,
    perfLiteHideTermLabels: false,
    perfLiteDisableArrows: false,
};

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════
const specById = Object.fromEntries(CONFIG.specs.map(s => [s.id, s]));
const specColor = { ...Object.fromEntries(CONFIG.specs.map(s => [s.id, s.color])), external: '#7a5520' };

function setStatus(msg, cls = '') {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
}

async function fetchPage(url) {
    // 1. Try direct (works if spec headers include CORS, or same origin)
    try {
        const r = await fetch(url, { mode: 'cors' });
        if (r.ok) return r.text();
    } catch (_) { /* fall through */ }

    // 2. Try via CORS proxy
    if (!CONFIG.corsProxy) throw new Error('No CORS proxy configured and direct fetch failed.');
    const proxyUrl = CONFIG.corsProxy + encodeURIComponent(url);
    const r2 = await fetch(proxyUrl);
    if (!r2.ok) throw new Error(`Proxy returned HTTP ${r2.status} for ${url}`);
    return r2.text();
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARSING
// ═══════════════════════════════════════════════════════════════════════════════

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
 *   "Autonomic identifier (AID, autonomic-identifier)"  → "autonomic-identifier"
 *   "Attribute ( attribute)"                            → "attribute"
 *   "Key-state"                                         → "key-state"
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
        if (!frag.startsWith('term:') && !frag.includes('-')) return null; // nav anchor, skip
        const slug = frag.replace(/^term:/, '');
        return slug ? { type: 'internal', specId: currentSpec.id, slug } : null;
    }

    let url;
    try { url = new URL(href); } catch { return null; }

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
function parsePage(html, spec) {
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

    // ── Extract xref tref links from embedded allXTrefs data ──────────
    // Spec-Up-T embeds an `allXTrefs` JSON object in an inline <script> tag.
    // Each entry with sourceFiles[].type === "tref" means the term in THIS spec
    // is borrowed from an external spec (ghPageUrl), creating a xref link.
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
        break; // only one allXTrefs script tag
    }

    return { terms, rawLinks };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRAPH DATA BUILDER
// ═══════════════════════════════════════════════════════════════════════════════
function buildGraphData(allTerms, allRawLinks) {
    const nodes = [];
    const links = [];

    // Term lookup: "specId::slug" → nodeId
    const termIndex = new Map();
    for (const t of allTerms) {
        termIndex.set(`${t.specId}::${t.slug}`, t.id);
        termIndex.set(`${t.specId}::${t.slug.replace(/_/g, '-').toLowerCase()}`, t.id);
    }

    // ── Hub nodes (one per spec) ─────────────────────────────────────────────
    const hubId = s => `hub::${s.id}`;
    for (const s of CONFIG.specs) {
        nodes.push({ id: hubId(s), label: s.label, fullLabel: s.fullLabel, specId: s.id, nodeType: 'hub', r: 34 });
    }

    // ── Term nodes ───────────────────────────────────────────────────────────
    for (const t of allTerms) {
        nodes.push({ ...t, nodeType: 'term', r: 5.5 });
    }

    // ── Hub nodes are created for clustering and annotation only.
    //     We do not add per-term hub edges to save edge count.

    // ── Resolve raw links ────────────────────────────────────────────────────
    const extNodes = new Map();   // externalLabel → nodeId
    const edgeSet = new Set();   // deduplicate

    function edgePriority(type) {
        if (type === 'tref') return 3;
        if (type === 'xref') return 2;
        if (type === 'internal') return 1;
        return 0;
    }

    function addEdge(src, tgt, type) {
        if (src === tgt) return;
        const key = `${src}→${tgt}`;
        if (edgeSet.has(key)) {
            const existing = links.find(l => l.source === src && l.target === tgt);
            if (existing && edgePriority(type) > edgePriority(existing.type)) {
                existing.type = type;
            }
            return;
        }
        edgeSet.add(key);
        links.push({ source: src, target: tgt, type });
    }

    for (const { fromId, cl } of allRawLinks) {
        if (cl.type === 'external') {
            const lbl = cl.externalLabel;
            if (!extNodes.has(lbl)) {
                const extId = `external::${lbl}`;
                extNodes.set(lbl, extId);
                nodes.push({ id: extId, label: lbl, specId: 'external', nodeType: 'external', r: 9 });
            }
            addEdge(fromId, extNodes.get(lbl), 'external');
        } else {
            const key = `${cl.specId}::${cl.slug}`;
            let targetId = termIndex.get(key)
                || termIndex.get(`${cl.specId}::${cl.slug.replace(/_/g, '-').toLowerCase()}`);
            if (!targetId) continue;
            // Resolve fromId to the actual node id — xtrefs slugs may differ from slugFromDt
            const srcId = termIndex.get(fromId)
                || termIndex.get(fromId.replace(/_/g, '-').toLowerCase());
            if (!srcId) continue;
            addEdge(srcId, targetId, cl.type);
        }
    }

    return { nodes, links };
}

// ═══════════════════════════════════════════════════════════════════════════════
// D3 RENDERER
// ═══════════════════════════════════════════════════════════════════════════════
function render({ nodes, links }) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const usePerfLite = links.length > CONFIG.perfModeMaxLinks || nodes.length > CONFIG.perfModeMaxNodes;
    const hideTermLabels = usePerfLite && CONFIG.perfLiteHideTermLabels;

    // Precompute lowercase labels once to avoid repeated per-interaction work.
    for (const node of nodes) node._labelLower = (node.label || '').toLowerCase();

    document.body.classList.toggle('perf-lite', usePerfLite);

    const svg = d3.select('#graph').attr('viewBox', `0 0 ${W} ${H}`);

    // ── Defs ─────────────────────────────────────────────────────────────────
    const defs = svg.append('defs');

    // Background grid pattern
    const grid = defs.append('pattern')
        .attr('id', 'bg-grid').attr('width', 44).attr('height', 44)
        .attr('patternUnits', 'userSpaceOnUse');
    grid.append('path')
        .attr('d', 'M 44 0 L 0 0 0 44')
        .attr('fill', 'none').attr('stroke', 'rgba(0,255,140,0.045)').attr('stroke-width', .5);

    // Glow filters
    function makeGlow(id, stdDev) {
        const f = defs.append('filter').attr('id', id);
        f.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', stdDev).attr('result', 'blur');
        const m = f.append('feMerge');
        m.append('feMergeNode').attr('in', 'blur');
        m.append('feMergeNode').attr('in', 'SourceGraphic');
    }
    makeGlow('glow-sm', 2.5);
    makeGlow('glow-md', 5);
    makeGlow('glow-lg', 10);

    function makeArrow(id) {
        defs.append('marker')
            .attr('id', id)
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 9)
            .attr('refY', 5)
            .attr('markerUnits', 'strokeWidth')
            .attr('markerWidth', 7)
            .attr('markerHeight', 7)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M 0 0 L 10 5 L 0 10 z')
            .attr('fill', 'context-stroke')
            .attr('stroke', 'context-stroke');
    }
    makeArrow('arrow-hub');
    makeArrow('arrow-internal');
    makeArrow('arrow-xref');
    makeArrow('arrow-tref');
    makeArrow('arrow-external');

    // ── Background ───────────────────────────────────────────────────────────
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'url(#bg-grid)');

    // ── Cluster positions ─────────────────────────────────────────────────────
    const n = CONFIG.specs.length;
    const cRadius = Math.min(W, H) * CONFIG.clusterRadiusFraction;
    const centers = {};
    CONFIG.specs.forEach((s, i) => {
        const angle = (2 * Math.PI * i / n) - Math.PI / 2;
        centers[s.id] = { x: W / 2 + cRadius * Math.cos(angle), y: H / 2 + cRadius * Math.sin(angle) };
    });
    centers['external'] = { x: W / 2, y: H / 2 };   // external drifts to periphery naturally

    // Seed initial positions
    for (const node of nodes) {
        const c = centers[node.specId] || centers['external'];
        node.x = c.x + (Math.random() - 0.5) * 60;
        node.y = c.y + (Math.random() - 0.5) * 60;
    }

    // ── Simulation ───────────────────────────────────────────────────────────
    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links)
            .id(d => d.id)
            .distance(l => {
                if (l.type === 'hub') return 95;
                if (l.type === 'internal') return 40;
                if (l.type === 'xref') return 180;
                if (l.type === 'tref') return 130;
                return 130;  // external
            })
            .strength(l => {
                if (l.type === 'hub') return 0.04;
                if (l.type === 'internal') return 0.35;
                if (l.type === 'xref') return 0.18;
                if (l.type === 'tref') return 0.22;
                return 0.08;
            })
        )
        .force('charge', d3.forceManyBody()
            .strength(d => {
                if (d.nodeType === 'hub') return CONFIG.hubCharge;
                if (d.nodeType === 'external') return CONFIG.externalCharge;
                return CONFIG.termCharge;
            })
            .distanceMax(Math.min(W, H) * 0.55)
            .theta(1)
        )
        .force('cluster', alpha => {
            for (const node of nodes) {
                const c = centers[node.specId] || centers['external'];
                node.vx += (c.x - node.x) * CONFIG.centerStrength * alpha;
                node.vy += (c.y - node.y) * CONFIG.centerStrength * alpha;
            }
        })
        .force('collide', d3.forceCollide().radius(d => d.r + 1.5).strength(0.7).iterations(usePerfLite ? 1 : 2))
        .velocityDecay(CONFIG.simulationVelocityDecay)
        .alphaDecay(CONFIG.simulationAlphaDecay)
        .alphaMin(CONFIG.simulationAlphaMin);

    // ── Zoom / Pan ───────────────────────────────────────────────────────────
    const zoomG = svg.append('g');
    const zoomBehavior = d3.zoom()
        .scaleExtent([0.04, 8])
        .on('zoom', ev => zoomG.attr('transform', ev.transform));
    svg.call(zoomBehavior);

    // ── Draw links ───────────────────────────────────────────────────────────
    const linkLayer = zoomG.append('g').attr('class', 'links-layer');

    let linkGlowEl = null;
    if (!usePerfLite) {
        linkGlowEl = linkLayer.selectAll('line.link-glow')
            .data(links)
            .join('line')
            .attr('class', d => `link link-glow ${d.type}`)
            .attr('pointer-events', 'none')
            .attr('stroke', d => {
                if (d.type === 'tref') return '#ffe066';
                if (d.type === 'xref') return specColor[d.source.specId] || '#fff';
                if (d.type === 'external') return specColor['external'];
                if (d.type === 'hub') return specColor[d.source.specId] || '#fff';
                return specColor[d.source.specId] || '#fff';
            })
            .attr('stroke-width', d => {
                if (d.type === 'tref') return 7;
                if (d.type === 'xref') return 6;
                if (d.type === 'hub') return 5;
                if (d.type === 'external') return 5;
                return 4.5;
            })
            .attr('opacity', d => {
                if (d.type === 'tref') return 0.28;
                if (d.type === 'xref') return 0.18;
                if (d.type === 'hub') return 0.12;
                if (d.type === 'external') return 0.12;
                return 0.14;
            })
            .attr('filter', d => {
                if (d.type === 'tref' || d.type === 'xref') return 'url(#glow-md)';
                return 'url(#glow-sm)';
            });
    }

    const linkEl = linkLayer.selectAll('line')
        .data(links)
        .join('line')
        .attr('class', d => `link ${d.type}`)
        .attr('stroke', d => {
            if (d.type === 'hub') return specColor[d.source.specId] || '#fff';
            if (d.type === 'external') return specColor['external'];
            if (d.type === 'xref') return specColor[d.source.specId] || '#fff';
            if (d.type === 'tref') return '#ffe066';
            return specColor[d.source.specId] || '#fff';
        })
        .attr('marker-end', d => {
            if (usePerfLite && CONFIG.perfLiteDisableArrows) return null;
            let markerType = 'internal';
            if (d.type === 'hub') markerType = 'hub';
            else if (d.type === 'external') markerType = 'external';
            else if (d.type === 'xref') markerType = 'xref';
            else if (d.type === 'tref') markerType = 'tref';
            return `url(#arrow-${markerType})`;
        });

    // ── Draw nodes ───────────────────────────────────────────────────────────
    const nodeLayer = zoomG.append('g').attr('class', 'nodes-layer');

    const nodeEl = nodeLayer.selectAll('g')
        .data(nodes)
        .join('g')
        .attr('class', d => `node ${d.nodeType}`)
        .call(d3.drag()
            .on('start', (ev, d) => { 
                if (!ev.active) simulation.alphaTarget(0.3).restart(); 
                d.fx = d.x; 
                d.fy = d.y;
                linkEl.style('opacity', 0).style('pointer-events', 'none');
            })
            .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
            .on('end', (ev, d) => { 
                if (!ev.active) simulation.alphaTarget(0); 
                if (pinnedNode !== d) {
                    d.fx = null; 
                    d.fy = null;
                }
                linkEl.style('opacity', null).style('pointer-events', null);
            })
        );

    // Circles
    const nodeCircleEl = nodeEl.append('circle')
        .attr('r', d => d.r)
        .attr('fill', d => {
            const c = specColor[d.specId] || '#888';
            if (d.nodeType === 'hub') return c + '28';
            if (d.nodeType === 'external') return '#2a1808';
            return c + '18';
        })
        .attr('stroke', d => specColor[d.specId] || '#888')
        .attr('stroke-width', d => d.nodeType === 'hub' ? 2 : 1)
        .attr('filter', d => {
            if (usePerfLite) return null;
            if (d.nodeType === 'hub') return 'url(#glow-lg)';
            if (d.nodeType === 'external') return null;
            return 'url(#glow-sm)';
        });

    // Labels
    const labelEl = nodeEl.append('text')
        .attr('dy', d => d.nodeType === 'hub' ? '.35em' : d.r + 11)
        .attr('text-anchor', 'middle')
        .attr('fill', d => {
            if (d.nodeType === 'hub') return '#ffffff';
            if (d.nodeType === 'external') return '#7a5028';
            return '#8aaa9a';
        })
        .attr('filter', d => {
            if (usePerfLite) return null;
            return d.nodeType === 'hub' ? 'url(#glow-md)' : null;
        })
        .style('cursor', d => d.nodeType === 'term' ? 'pointer' : null);

    // Keep node drag/selection state stable when interacting with labels.
    labelEl
        .on('mousedown', ev => ev.stopPropagation())
        .on('click', ev => ev.stopPropagation());

    labelEl
        .filter(d => d.nodeType === 'hub')
        .each(function (d) {
            const txt = d3.select(this);
            txt.text(null);
            const words = d.label.split(/\s+/).filter(Boolean);
            if (words.length <= 1) {
                txt.append('tspan').attr('x', 0).attr('dy', 0).text(d.label);
            } else {
                txt.append('tspan').attr('x', 0).attr('dy', '-0.5em').text(words[0]);
                txt.append('tspan').attr('x', 0).attr('dy', '1.05em').text(words.slice(1).join(' '));
            }
        });

    labelEl
        .filter(d => d.nodeType !== 'hub')
        .text(d => {
            if (d.nodeType === 'external') return d.label.slice(0, 22);
            return d.label.length > 30 ? d.label.slice(0, 28) + '…' : d.label;
        })
        .style('display', d => {
            if (!hideTermLabels) return null;
            return d.nodeType === 'hub' ? null : 'none';
        })
        .on('click', (ev, d) => {
            if (d.nodeType !== 'term') return;
            ev.stopPropagation();
            const spec = specById[d.specId];
            if (!spec || !d.slug) return;
            const anchor = `#term:${encodeURIComponent(d.slug)}`;
            const url = `${spec.url.replace(/\/$/, '')}${anchor}`;
            window.open(url, '_blank', 'noopener');
        });

    // ── Tooltip ──────────────────────────────────────────────────────────────
    const tt = document.getElementById('tooltip');
    let activeSelection = null;
    let activeSpecFilter = null;
    let activeSearchQuery = '';
    let isSearchTyping = false;
    let activeNeighborIds = new Set();
    let activeLinkKeys = new Set();
    let pinnedNode = null;
    const adjacency = new Map(nodes.map(n => [n.id, { neighbors: new Set([n.id]), linkKeys: new Set() }]));

    const releasePinnedNode = () => {
        if (!pinnedNode) return;
        pinnedNode.fx = null;
        pinnedNode.fy = null;
        pinnedNode = null;
    };

    const pinNode = d => {
        if (pinnedNode === d) return;
        releasePinnedNode();
        pinnedNode = d;
        d.fx = d.x;
        d.fy = d.y;
    };

    const isNodeVisible = d => {
        if (activeSpecFilter && d.nodeType !== 'hub' && d.specId !== activeSpecFilter) return false;
        return !activeSearchQuery || d.nodeType === 'hub' || d._labelLower.includes(activeSearchQuery);
    };

    const linkKey = l => `${l.source.id}→${l.target.id}`;
    for (const l of links) {
        const key = linkKey(l);
        const sourceEntry = adjacency.get(l.source.id);
        const targetEntry = adjacency.get(l.target.id);
        if (!sourceEntry || !targetEntry) continue;
        sourceEntry.neighbors.add(l.target.id);
        sourceEntry.linkKeys.add(key);
        targetEntry.neighbors.add(l.source.id);
        targetEntry.linkKeys.add(key);
    }

    const resetSelection = () => {
        activeSelection = null;
        activeSpecFilter = null;
        activeNeighborIds.clear();
        activeLinkKeys.clear();
        releasePinnedNode();
        nodeCircleEl.style('opacity', null);
        labelEl.style('opacity', null);
        if (hideTermLabels) {
            labelEl.style('display', d => d.nodeType === 'hub' ? null : 'none');
        }
        if (linkGlowEl) linkGlowEl.style('opacity', null);
        linkEl.style('opacity', null);
    };
    const applyVisibility = () => {
        nodeCircleEl.style('opacity', d => {
            if (!isNodeVisible(d)) return 0.04;
            if (activeSpecFilter && d.nodeType !== 'hub') return 1;
            if (activeSelection && (d.nodeType === 'hub' || activeNeighborIds.has(d.id))) return 1;
            return 1;
        });
        labelEl.style('opacity', d => {
            if (!isNodeVisible(d)) return 0.02;
            if (activeSpecFilter && d.nodeType !== 'hub') return 1;
            if (activeSelection && (d.nodeType === 'hub' || activeNeighborIds.has(d.id))) return 1;
            return 1;
        });
        if (hideTermLabels) {
            labelEl.style('display', d => {
                if (d.nodeType === 'hub') return null;
                if (!isNodeVisible(d)) return 'none';
                if (activeSearchQuery) return null;
                if (activeSelection) return activeNeighborIds.has(d.id) ? null : 'none';
                return 'none';
            });
        }
        if (isSearchTyping && !activeSelection && !activeSpecFilter) {
            if (linkGlowEl) linkGlowEl.style('opacity', 0);
            linkEl.style('opacity', 0);
            return;
        }
        if (activeSpecFilter) {
            if (linkGlowEl) {
                linkGlowEl.style('opacity', l => {
                    const sourceSpec = l.source.specId;
                    const targetSpec = l.target.specId;
                    return (sourceSpec === activeSpecFilter && targetSpec === activeSpecFilter) ? null : 0.03;
                });
            }
            linkEl.style('opacity', l => {
                const sourceSpec = l.source.specId;
                const targetSpec = l.target.specId;
                return (sourceSpec === activeSpecFilter && targetSpec === activeSpecFilter) ? 1 : 0.04;
            });
            return;
        }
        if (activeSelection) {
            if (linkGlowEl) linkGlowEl.style('opacity', l => activeLinkKeys.has(linkKey(l)) ? null : 0.03);
            linkEl.style('opacity', l => activeLinkKeys.has(linkKey(l)) ? 1 : 0.06);
            return;
        }
        if (linkGlowEl) linkGlowEl.style('opacity', null);
        linkEl.style('opacity', null);
    };
    const setSelection = node => {
        activeSelection = node.id;
        const adjacent = adjacency.get(node.id);
        activeNeighborIds = adjacent ? new Set(adjacent.neighbors) : new Set([node.id]);
        activeLinkKeys = adjacent ? new Set(adjacent.linkKeys) : new Set();
        activeSpecFilter = node.nodeType === 'hub' ? node.specId : null;
        pinNode(node);
        applyVisibility();
    };

    nodeEl
        .on('mouseenter', (ev, d) => {
            const spec = specById[d.specId];
            tt.innerHTML = `
                            <div class="tt-name">${d.label}</div>
                            <div class="tt-spec">${spec ? spec.fullLabel : d.specId}</div>
                            ${d.slug ? `<div class="tt-slug">${d.slug}</div>` : ''}
                            `;
            tt.style.display = 'block';
        })
        .on('mousemove', ev => {
            tt.style.left = (ev.clientX + 16) + 'px';
            tt.style.top = (ev.clientY - 8) + 'px';
        })
        .on('mouseleave', () => { tt.style.display = 'none'; })
        .on('click', (ev, d) => {
            ev.stopPropagation();
            if (activeSelection === d.id) {
                resetView();
            } else {
                setSelection(d);
            }
        });

    svg.on('click', ev => {
        if (ev.target === svg.node()) resetSelection();
    });

    const renderPositions = () => {
        for (const l of links) {
            const dx = l.target.x - l.source.x;
            const dy = l.target.y - l.source.y;
            const dist = Math.hypot(dx, dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;
            const rs = l.source.r || 0;
            const rt = l.target.r || 0;
            l._x1 = l.source.x + ux * rs;
            l._y1 = l.source.y + uy * rs;
            l._x2 = l.target.x - ux * rt;
            l._y2 = l.target.y - uy * rt;
        }

        if (linkGlowEl) {
            linkGlowEl
                .attr('x1', d => d._x1)
                .attr('y1', d => d._y1)
                .attr('x2', d => d._x2)
                .attr('y2', d => d._y2);
        }

        linkEl
            .attr('x1', d => d._x1)
            .attr('y1', d => d._y1)
            .attr('x2', d => d._x2)
            .attr('y2', d => d._y2);
        nodeEl.attr('transform', d => `translate(${d.x},${d.y})`);
    };

    // Throttle DOM writes to the browser paint loop.
    let framePending = false;
    simulation.on('tick', () => {
        if (framePending) return;
        framePending = true;
        requestAnimationFrame(() => {
            framePending = false;
            renderPositions();
        });
    });
    renderPositions();

    // ── Search / filter ──────────────────────────────────────────────────────
    const searchInput = document.getElementById('search-input');
    let searchDebounce = null;
    searchInput.addEventListener('input', function () {
        const nextQuery = this.value.toLowerCase().trim();
        isSearchTyping = nextQuery.length > 0;
        if (nextQuery === activeSearchQuery) {
            applyVisibility();
            return;
        }
        if (searchDebounce) clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            activeSearchQuery = nextQuery;
            applyVisibility();
        }, 100);
        applyVisibility();
    });

    const resetView = () => {
        // Clear search-driven attribute opacity state.
        searchInput.value = '';
        activeSearchQuery = '';
        isSearchTyping = false;
        // Clear selection-driven style opacity state.
        resetSelection();
        tt.style.display = 'none';
        applyVisibility();
        // Reset pan/zoom to the initial viewport transform.
        svg.transition().duration(220).call(zoomBehavior.transform, d3.zoomIdentity);
    };

    document.addEventListener('keydown', ev => {
        if (ev.key !== 'Escape') return;
        ev.preventDefault();
        resetView();
    });

    // ── Legend ───────────────────────────────────────────────────────────────
    const legend = document.getElementById('legend');
    legend.style.display = 'block';

    let html = '<div class="leg-head">NODES</div>';
    for (const s of CONFIG.specs) {
        html += `
      <div class="leg-row">
        <div class="leg-dot" style="background:${s.color}22;border:1.5px solid ${s.color};box-shadow:0 0 6px ${s.color}66"></div>
        <span style="color:${s.color}">${s.label}</span>
        <!-- <span style="color:var(--text-dim)">· term</span> -->
      </div>`;
    }
    html += `
                            <div class="leg-row">
                                <div class="leg-dot" style="background:#2a1808;border:1px dashed #7a5520"></div>
                                <span style="color:#7a5520">external glossary</span>
                            </div>
                            <div class="leg-head">EDGES</div>
                            <div class="leg-row">
                                <div class="leg-dash" style="background:#8aaa9a;opacity:.35"></div>
                                <span style="color:var(--text-dim)">ref</span>
                            </div>
                            <div class="leg-row">
                                <div class="leg-dash" style="background:#ffe066;opacity:.85"></div>
                                <span style="color:#ffe066">tref</span>
                            </div>
                            <div class="leg-row">
                                <div class="leg-dash" style="background:#ccc;opacity:.6;background: repeating-linear-gradient(90deg,#ccc 0,#ccc 4px,transparent 4px,transparent 7px)"></div>
                                <span style="color:var(--text-dim)">xref</span>
                            </div>
                            <div class="leg-row">
                                <div class="leg-dash" style="background: repeating-linear-gradient(90deg,#7a5520 0,#7a5520 2px,transparent 2px,transparent 6px)"></div>
                                <span style="color:var(--text-dim)">→ external</span>
                            </div>`;
    legend.innerHTML = html;

    // ── Resize ───────────────────────────────────────────────────────────────
    window.addEventListener('resize', () => {
        svg.attr('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
    const allTerms = [];
    const allRawLinks = [];

    for (const spec of CONFIG.specs) {
        setStatus(`Fetching ${spec.label}…`);
        try {
            const html = await fetchPage(spec.url);
            const { terms, rawLinks } = parsePage(html, spec);
            console.log(`[graph] ${spec.id}: ${terms.length} terms, ${rawLinks.length} raw links`);
            allTerms.push(...terms);
            allRawLinks.push(...rawLinks);
        } catch (err) {
            console.error(`[graph] Failed to load ${spec.id}:`, err);
            setStatus(`⚠ Failed to load ${spec.label}: ${err.message}`, 'warn');
        }
    }

    if (allTerms.length === 0) {
        setStatus('⚠ No terms loaded. Check browser console.', 'err');
        return;
    }

    setStatus(`Building graph…`);
    const graphData = buildGraphData(allTerms, allRawLinks);
    const termCount = allTerms.length;
    const edgeCount = graphData.links.filter(l => l.type !== 'hub').length;

    console.log(`[graph] ${graphData.nodes.length} nodes, ${graphData.links.length} links (${edgeCount} semantic edges)`);
    setStatus('Rendering…');
    render(graphData);
    setStatus(`${termCount} terms · ${edgeCount} edges`, 'ok');
}

main();
