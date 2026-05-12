
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
    hubCharge: -1200,   // repulsion of hub (spec-center) nodes
    termCharge: -90,     // repulsion of term nodes
    externalCharge: -200,    // repulsion of external-glossary nodes
    centerStrength: 0.06,    // how strongly nodes are pulled toward their cluster
    clusterRadiusFraction: 0.27,  // fraction of min(W,H) for hub positions
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
                type: s.id === currentSpec.id ? 'internal' : 'cross-spec',
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
        nodes.push({ id: hubId(s), label: s.label, fullLabel: s.fullLabel, specId: s.id, nodeType: 'hub', r: 24 });
    }

    // ── Term nodes ───────────────────────────────────────────────────────────
    for (const t of allTerms) {
        nodes.push({ ...t, nodeType: 'term', r: 5.5 });
    }

    // ── Hub → term edges (keep clusters together) ────────────────────────────
    for (const t of allTerms) {
        links.push({ source: hubId(specById[t.specId]), target: t.id, type: 'hub' });
    }

    // ── Resolve raw links ────────────────────────────────────────────────────
    const extNodes = new Map();   // externalLabel → nodeId
    const edgeSet = new Set();   // deduplicate

    function addEdge(src, tgt, type) {
        if (src === tgt) return;
        const key = `${src}→${tgt}`;
        if (edgeSet.has(key)) return;
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
            addEdge(fromId, targetId, cl.type);
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
            .attr('fill', 'currentColor');
    }
    makeArrow('arrow-hub');
    makeArrow('arrow-internal');
    makeArrow('arrow-cross-spec');
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
                if (l.type === 'cross-spec') return 180;
                return 130;  // external
            })
            .strength(l => {
                if (l.type === 'hub') return 0.04;
                if (l.type === 'internal') return 0.35;
                if (l.type === 'cross-spec') return 0.18;
                return 0.08;
            })
        )
        .force('charge', d3.forceManyBody().strength(d => {
            if (d.nodeType === 'hub') return CONFIG.hubCharge;
            if (d.nodeType === 'external') return CONFIG.externalCharge;
            return CONFIG.termCharge;
        }))
        .force('cluster', alpha => {
            for (const node of nodes) {
                const c = centers[node.specId] || centers['external'];
                node.vx += (c.x - node.x) * CONFIG.centerStrength * alpha;
                node.vy += (c.y - node.y) * CONFIG.centerStrength * alpha;
            }
        })
        .force('collide', d3.forceCollide().radius(d => d.r + 1.5).strength(0.7))
        .alphaDecay(0.007);

    // ── Zoom / Pan ───────────────────────────────────────────────────────────
    const zoomG = svg.append('g');
    svg.call(d3.zoom()
        .scaleExtent([0.04, 8])
        .on('zoom', ev => zoomG.attr('transform', ev.transform))
    );

    // ── Draw links ───────────────────────────────────────────────────────────
    const linkLayer = zoomG.append('g').attr('class', 'links-layer');

    const linkEl = linkLayer.selectAll('line')
        .data(links)
        .join('line')
        .attr('class', d => `link ${d.type}`)
        .attr('stroke', d => {
            if (d.type === 'hub') return specColor[d.source.specId] || '#fff';
            if (d.type === 'external') return specColor['external'];
            if (d.type === 'cross-spec') return specColor[d.source.specId] || '#fff';
            return specColor[d.source.specId] || '#fff';
        })
        .attr('marker-end', d => {
            const markerType = d.type === 'hub' ? 'hub' : d.type === 'external' ? 'external' : d.type === 'cross-spec' ? 'cross-spec' : 'internal';
            return `url(#arrow-${markerType})`;
        })
        .style('color', d => {
            if (d.type === 'hub') return specColor[d.source.specId] || '#fff';
            if (d.type === 'external') return specColor['external'];
            if (d.type === 'cross-spec') return specColor[d.source.specId] || '#fff';
            return specColor[d.source.specId] || '#fff';
        });

    // ── Draw nodes ───────────────────────────────────────────────────────────
    const nodeLayer = zoomG.append('g').attr('class', 'nodes-layer');

    const nodeEl = nodeLayer.selectAll('g')
        .data(nodes)
        .join('g')
        .attr('class', d => `node ${d.nodeType}`)
        .call(d3.drag()
            .on('start', (ev, d) => { if (!ev.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
            .on('drag', (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
            .on('end', (ev, d) => { if (!ev.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
        );

    // Circles
    nodeEl.append('circle')
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
            if (d.nodeType === 'hub') return 'url(#glow-lg)';
            if (d.nodeType === 'external') return null;
            return 'url(#glow-sm)';
        });

    // Labels
    nodeEl.append('text')
        .attr('dy', d => d.r + 11)
        .attr('text-anchor', 'middle')
        .attr('fill', d => {
            if (d.nodeType === 'hub') return specColor[d.specId];
            if (d.nodeType === 'external') return '#7a5028';
            return '#8aaa9a';
        })
        .attr('filter', d => d.nodeType === 'hub' ? 'url(#glow-md)' : null)
        .style('cursor', d => d.nodeType === 'term' ? 'pointer' : null)
        .text(d => {
            if (d.nodeType === 'hub') return d.label;
            if (d.nodeType === 'external') return d.label.slice(0, 22);
            return d.label.length > 30 ? d.label.slice(0, 28) + '…' : d.label;
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
    let activeNeighborIds = new Set();
    let activeLinkKeys = new Set();

    const linkKey = l => `${l.source.id}→${l.target.id}`;
    const resetSelection = () => {
        activeSelection = null;
        activeNeighborIds.clear();
        activeLinkKeys.clear();
        nodeEl.select('circle').style('opacity', null);
        nodeEl.select('text').style('opacity', null);
        linkEl.style('opacity', null);
    };
    const setSelection = node => {
        activeSelection = node.id;
        activeNeighborIds = new Set([node.id]);
        activeLinkKeys = new Set();
        for (const l of links) {
            if (l.source.id === node.id) {
                activeNeighborIds.add(l.target.id);
                activeLinkKeys.add(linkKey(l));
            }
            if (l.target.id === node.id) {
                activeNeighborIds.add(l.source.id);
                activeLinkKeys.add(linkKey(l));
            }
        }
        nodeEl.select('circle').style('opacity', d => activeNeighborIds.has(d.id) ? 1 : 0.06);
        nodeEl.select('text').style('opacity', d => activeNeighborIds.has(d.id) ? 1 : 0.04);
        linkEl.style('opacity', l => activeLinkKeys.has(linkKey(l)) ? 1 : 0.06);
    };

    nodeEl
        .on('mouseenter', (ev, d) => {
            const spec = specById[d.specId];
            tt.innerHTML = `
                            <div class="tt-name">${d.label}</div>
                            <div class="tt-spec">${spec ? spec.fullLabel : d.specId}</div>
                            ${d.slug ? `<div class="tt-slug">slug: ${d.slug}</div>` : ''}
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
                resetSelection();
            } else {
                setSelection(d);
            }
        });

    svg.on('click', ev => {
        if (ev.target === svg.node()) resetSelection();
    });

    // ── Tick ─────────────────────────────────────────────────────────────────
    simulation.on('tick', () => {
        linkEl
            .attr('x1', d => {
                const dx = d.target.x - d.source.x;
                const dy = d.target.y - d.source.y;
                const dist = Math.hypot(dx, dy) || 1;
                const r = d.source.r || 0;
                return d.source.x + (dx / dist) * r;
            })
            .attr('y1', d => {
                const dx = d.target.x - d.source.x;
                const dy = d.target.y - d.source.y;
                const dist = Math.hypot(dx, dy) || 1;
                const r = d.source.r || 0;
                return d.source.y + (dy / dist) * r;
            })
            .attr('x2', d => {
                const dx = d.target.x - d.source.x;
                const dy = d.target.y - d.source.y;
                const dist = Math.hypot(dx, dy) || 1;
                const r = d.target.r || 0;
                return d.target.x - (dx / dist) * r;
            })
            .attr('y2', d => {
                const dx = d.target.x - d.source.x;
                const dy = d.target.y - d.source.y;
                const dist = Math.hypot(dx, dy) || 1;
                const r = d.target.r || 0;
                return d.target.y - (dy / dist) * r;
            });
        nodeEl.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // ── Search / filter ──────────────────────────────────────────────────────
    document.getElementById('search-input').addEventListener('input', function () {
        const q = this.value.toLowerCase().trim();
        nodeEl.select('circle').attr('opacity', d => {
            if (!q || d.nodeType === 'hub') return 1;
            return d.label.toLowerCase().includes(q) ? 1 : 0.06;
        });
        nodeEl.select('text').attr('opacity', d => {
            if (!q || d.nodeType === 'hub') return 1;
            return d.label.toLowerCase().includes(q) ? 1 : 0.04;
        });
        linkEl.attr('opacity', !q ? null : 0.06);
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
        <span style="color:var(--text-dim)">· term</span>
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
                                <span style="color:var(--text-dim)">intra-spec</span>
                            </div>
                            <div class="leg-row">
                                <div class="leg-dash" style="background:#ccc;opacity:.6;background: repeating-linear-gradient(90deg,#ccc 0,#ccc 4px,transparent 4px,transparent 7px)"></div>
                                <span style="color:var(--text-dim)">cross-spec</span>
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
