import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';
import { CONFIG, specById, specColor } from './config.js';

const HowlCtor = globalThis.Howl;
const clickSound = HowlCtor
    ? new HowlCtor({ src: ['./assets/audio/click.mp3'], volume: 0.45 })
    : null;
const winSound = HowlCtor
    ? new HowlCtor({ src: ['./assets/audio/60443__jobro__tada1.mp3'], volume: 0.55 })
    : null;

const SOUND_PREF_KEY = 'keri-sound-enabled';
let soundEnabled = true;
let lastTouchStartMs = 0;

function playClickSound() {
    if (!soundEnabled || !clickSound) return;
    clickSound.play();
}

function playWinSound() {
    if (!soundEnabled || !winSound) return;
    winSound.play();
}

function getSavedSoundPreference() {
    try {
        const stored = globalThis.localStorage.getItem(SOUND_PREF_KEY);
        return stored === null ? true : stored === '1';
    } catch {
        return true;
    }
}

export function render({ nodes, links }) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const usePerfLite = links.length > CONFIG.perfModeMaxLinks || nodes.length > CONFIG.perfModeMaxNodes;
    const hideTermLabels = usePerfLite && CONFIG.perfLiteHideTermLabels;

    // Game mode state (mutated by game functions below)
    const gameState = {
        active: false,
        revealed: false,
        startId: null,
        targetId: null,
        currentId: null,
        moves: 0,
        optimalMoves: 0,
        visitedPath: [],
        optimalPath: [],
    };

    const soundToggleBtn = document.getElementById('sound-toggle-btn');
    function setSoundEnabled(enabled) {
        soundEnabled = enabled;
        try {
            globalThis.localStorage.setItem(SOUND_PREF_KEY, enabled ? '1' : '0');
        } catch {
            // ignore storage failures
        }
        if (soundToggleBtn) {
            soundToggleBtn.textContent = enabled ? 'SOUND ON' : 'SOUND OFF';
        }
    }
    setSoundEnabled(getSavedSoundPreference());

    if (soundToggleBtn) {
        soundToggleBtn.addEventListener('click', () => {
            setSoundEnabled(!soundEnabled);
        });
    }

    // Touch devices often emit a synthetic click after touchstart; suppress the duplicate click sound.
    document.addEventListener('touchstart', () => {
        lastTouchStartMs = Date.now();
        playClickSound();
    }, { passive: true, capture: true });

    document.addEventListener('click', () => {
        if (Date.now() - lastTouchStartMs < 450) return;
        playClickSound();
    }, { passive: true, capture: true });

    // Precompute lowercase labels once to avoid repeated per-interaction work.
    for (const node of nodes) node._labelLower = (node.label || '').toLowerCase();

    document.body.classList.toggle('perf-lite', usePerfLite);

    const svg = d3.select('#graph').attr('viewBox', `0 0 ${W} ${H}`);

    // Defs
    const defs = svg.append('defs');

    // Background grid pattern
    const grid = defs.append('pattern')
        .attr('id', 'bg-grid').attr('width', 44).attr('height', 44)
        .attr('patternUnits', 'userSpaceOnUse');
    grid.append('path')
        .attr('d', 'M 44 0 L 0 0 0 44')
        .attr('fill', 'none').attr('stroke', 'rgba(0,255,140,0.045)').attr('stroke-width', 0.5);

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

    // Background
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'url(#bg-grid)');

    // Cluster positions
    const n = CONFIG.specs.length;
    const cRadius = Math.min(W, H) * CONFIG.clusterRadiusFraction;
    const centers = {};
    CONFIG.specs.forEach((s, i) => {
        const angle = (2 * Math.PI * i / n) - Math.PI / 2;
        centers[s.id] = { x: W / 2 + cRadius * Math.cos(angle), y: H / 2 + cRadius * Math.sin(angle) };
    });
    centers.external = { x: W / 2, y: H / 2 };

    // Seed initial positions
    for (const node of nodes) {
        const c = centers[node.specId] || centers.external;
        node.x = c.x + (Math.random() - 0.5) * 60;
        node.y = c.y + (Math.random() - 0.5) * 60;
    }

    // Simulation
    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links)
            .id(d => d.id)
            .distance(l => {
                if (l.type === 'hub') return 95;
                if (l.type === 'internal') return 40;
                if (l.type === 'xref') return 180;
                if (l.type === 'tref') return 130;
                return 130;
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
                const c = centers[node.specId] || centers.external;
                node.vx += (c.x - node.x) * CONFIG.centerStrength * alpha;
                node.vy += (c.y - node.y) * CONFIG.centerStrength * alpha;
            }
        })
        .force('collide', d3.forceCollide().radius(d => d.r + 1.5).strength(0.7).iterations(usePerfLite ? 1 : 2))
        .velocityDecay(CONFIG.simulationVelocityDecay)
        .alphaDecay(CONFIG.simulationAlphaDecay)
        .alphaMin(CONFIG.simulationAlphaMin);

    // Zoom / Pan
    const zoomG = svg.append('g');
    let currentZoomK = 1;

    const zoomBehavior = d3.zoom()
        .scaleExtent([0.04, 8])
        .on('zoom', ev => {
            currentZoomK = ev.transform.k;
            zoomG.attr('transform', ev.transform);
            applyZoomInvariantSizing(currentZoomK);
        });
    svg.call(zoomBehavior);

    function applyZoomInvariantSizing(k = 1) {
        const safeK = Math.max(0.04, k);
        const inv = Math.max(0.65, Math.min(1 / safeK, 4.5));

        const baseRadiusPx = d => {
            if (d.nodeType === 'hub') return 28;
            if (d.nodeType === 'external') return 9;
            return 11;
        };

        const baseFontPx = d => {
            if (d.nodeType === 'hub') return 12;
            if (d.nodeType === 'external') return 10;
            return 12;
        };

        nodeCircleEl
            .attr('r', d => {
                d._renderR = baseRadiusPx(d) * inv;
                return d._renderR;
            });

        labelEl
            .style('font-size', d => `${baseFontPx(d) * inv}px`)
            .attr('dy', d => d.nodeType === 'hub' ? '.35em' : (d._renderR + 10 * inv));
    }

    // Draw links
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
                if (d.type === 'external') return specColor.external;
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
            if (d.type === 'external') return specColor.external;
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

    // Draw nodes
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
            .on('drag', (ev, d) => {
                d.fx = ev.x;
                d.fy = ev.y;
            })
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
            if (gameState.active) {
                gameMoveToNode(d);
                return;
            }
            if (gameState.revealed) return;
            const spec = specById[d.specId];
            if (!spec || !d.slug) return;
            const anchor = `#term:${encodeURIComponent(d.slug)}`;
            const url = `${spec.url.replace(/\/$/, '')}${anchor}`;
            window.open(url, '_blank', 'noopener');
        });
    applyZoomInvariantSizing(currentZoomK);

    // Tooltip
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
            let gameHint = '';
            if (gameState.active && d.nodeType === 'term') {
                if (d.id === gameState.currentId) {
                    gameHint = '<div class="tt-game game-cur">&#x25C9; YOU ARE HERE</div>';
                } else if (d.id === gameState.targetId) {
                    gameHint = '<div class="tt-game game-tgt">&#x25CE; TARGET</div>';
                } else {
                    const cadj = adjacency.get(gameState.currentId);
                    gameHint = cadj?.neighbors.has(d.id)
                        ? '<div class="tt-game game-ok">&rarr; REACHABLE &mdash; click to move</div>'
                        : '<div class="tt-game game-no">&times; NOT CONNECTED</div>';
                }
            }
            tt.innerHTML = `
                            <div class="tt-name">${d.label}</div>
                            <div class="tt-spec">${spec ? spec.fullLabel : d.specId}</div>
                            ${d.slug ? `<div class="tt-slug">${d.slug}</div>` : ''}
                            ${gameHint}
                            `;
            tt.style.display = 'block';
        })
        .on('mousemove', ev => {
            tt.style.left = (ev.clientX + 16) + 'px';
            tt.style.top = (ev.clientY - 8) + 'px';
        })
        .on('mouseleave', () => {
            tt.style.display = 'none';
        })
        .on('click', (ev, d) => {
            ev.stopPropagation();
            if (gameState.active) {
                gameMoveToNode(d);
                return;
            }
            if (gameState.revealed) return;
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
            const rs = l.source._renderR ?? l.source.r ?? 0;
            const rt = l.target._renderR ?? l.target.r ?? 0;
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

    // Search / filter
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
        if (document.getElementById('help-modal')?.getAttribute('aria-hidden') === 'false') {
            closeHelp();
            return;
        }
        if (gameState.active || gameState.revealed) {
            endGame();
            return;
        }
        resetView();
    });

    // Legend
    const legend = document.getElementById('legend');
    legend.style.display = 'block';

    let html = '<div class="leg-head">NODES</div>';
    for (const s of CONFIG.specs) {
        html += `
      <div class="leg-row">
        <div class="leg-dot" style="background:${s.color}22;border:1.5px solid ${s.color};box-shadow:0 0 6px ${s.color}66"></div>
        <span style="color:${s.color}">${s.label}</span>
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

    // Resize
    window.addEventListener('resize', () => {
        svg.attr('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    });

    // GAME MODE - PATH HUNT
    const termNodes = nodes.filter(n => n.nodeType === 'term');
    const termNodeIdSet = new Set(termNodes.map(n => n.id));

    /** BFS shortest path through term nodes only. Returns [id, ...] or null. */
    function bfsPath(fromId, toId) {
        const queue = [[fromId]];
        const visited = new Set([fromId]);
        while (queue.length) {
            const path = queue.shift();
            const cur = path.at(-1);
            if (cur === toId) return path;
            const cadj = adjacency.get(cur);
            if (!cadj) continue;
            for (const nb of cadj.neighbors) {
                if (!visited.has(nb) && termNodeIdSet.has(nb)) {
                    visited.add(nb);
                    queue.push([...path, nb]);
                }
            }
        }
        return null;
    }

    function nodeById(id) {
        return nodes.find(n => n.id === id);
    }

    function applyGameClasses() {
        if (!gameState.active && !gameState.revealed) {
            nodeEl.classed('game-current game-target game-reachable game-visited game-path', false);
            return;
        }
        const cadj = adjacency.get(gameState.currentId);
        const reachable = cadj
            ? new Set([...cadj.neighbors].filter(id => termNodeIdSet.has(id)))
            : new Set();
        nodeEl
            .classed('game-current', d => d.id === gameState.currentId)
            .classed('game-target', d => d.id === gameState.targetId)
            .classed('game-reachable', d =>
                gameState.active
                && d.id !== gameState.currentId
                && d.id !== gameState.targetId
                && reachable.has(d.id))
            .classed('game-visited', d =>
                d.id !== gameState.currentId
                && gameState.visitedPath.includes(d.id))
            .classed('game-path', d =>
                gameState.revealed
                && gameState.optimalPath.includes(d.id));
    }

    function applyGameVisibility() {
        if (!gameState.active && !gameState.revealed) {
            nodeCircleEl.style('opacity', null);
            labelEl.style('opacity', null);
            if (hideTermLabels) labelEl.style('display', d => d.nodeType === 'hub' ? null : 'none');
            if (linkGlowEl) linkGlowEl.style('opacity', null);
            linkEl.style('opacity', null);
            return;
        }
        const cadj = adjacency.get(gameState.currentId);
        const reachable = cadj ? cadj.neighbors : new Set();
        const relevant = new Set([
            gameState.currentId,
            gameState.targetId,
            ...reachable,
            ...gameState.visitedPath,
        ]);
        if (gameState.revealed) {
            for (const id of gameState.optimalPath) relevant.add(id);
        }
        nodeCircleEl.style('opacity', d => relevant.has(d.id) ? 1 : 0.05);
        labelEl.style('opacity', d => relevant.has(d.id) ? 1 : 0.02);
        if (hideTermLabels) {
            labelEl.style('display', d => {
                if (d.nodeType === 'hub') return null;
                return relevant.has(d.id) ? null : 'none';
            });
        }
        if (linkGlowEl) {
            linkGlowEl.style('opacity', l =>
                (relevant.has(l.source.id) && relevant.has(l.target.id)) ? null : 0);
        }
        linkEl.style('opacity', l =>
            (relevant.has(l.source.id) && relevant.has(l.target.id)) ? 0.9 : 0.02);
    }

    function updateGameHUD() {
        const infoEl = document.getElementById('game-info');
        const descEl = document.getElementById('game-desc');
        const fromEl = document.getElementById('game-from');
        const atEl = document.getElementById('game-at');
        const toEl = document.getElementById('game-to');
        const movesEl = document.getElementById('game-moves');
        const optimalEl = document.getElementById('game-optimal');
        const resultEl = document.getElementById('game-result');
        const giveUpBtn = document.getElementById('game-give-up-btn');

        if (!gameState.active && !gameState.revealed) {
            infoEl.style.display = 'none';
            descEl.style.display = '';
            giveUpBtn.style.display = 'none';
            resultEl.textContent = '';
            resultEl.style.color = '';
            return;
        }
        descEl.style.display = 'none';
        infoEl.style.display = '';
        fromEl.textContent = nodeById(gameState.startId)?.label ?? '?';
        toEl.textContent = nodeById(gameState.targetId)?.label ?? '?';
        atEl.textContent = nodeById(gameState.currentId)?.label ?? '?';
        movesEl.textContent = gameState.moves;
        optimalEl.textContent = gameState.revealed ? gameState.optimalMoves : '?';
        giveUpBtn.style.display = gameState.active ? '' : 'none';
    }

    function panToNode(node) {
        if (node.x == null) return;
        const transform = d3.zoomTransform(svg.node());
        const scale = Math.max(transform.k, 1.4);
        const tx = window.innerWidth / 2 - scale * node.x;
        const ty = window.innerHeight / 2 - scale * node.y;
        svg.transition().duration(500)
            .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    }

    function fitNodesInView(nodeIds, padding = 80) {
        const nodesToFit = nodeIds
            .map(id => nodeById(id))
            .filter(n => n && typeof n.x === 'number' && typeof n.y === 'number');
        if (!nodesToFit.length) return;

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const n of nodesToFit) {
            const r = n.r || 0;
            minX = Math.min(minX, n.x - r);
            maxX = Math.max(maxX, n.x + r);
            minY = Math.min(minY, n.y - r);
            maxY = Math.max(maxY, n.y + r);
        }

        const boxW = Math.max(24, maxX - minX);
        const boxH = Math.max(24, maxY - minY);
        const availableW = Math.max(24, window.innerWidth - padding * 2);
        const availableH = Math.max(24, window.innerHeight - padding * 2);
        const scale = Math.min(8, Math.max(0.04, Math.min(availableW / boxW, availableH / boxH)));
        const centerX = minX + boxW / 2;
        const centerY = minY + boxH / 2;
        const tx = window.innerWidth / 2 - scale * centerX;
        const ty = window.innerHeight / 2 - scale * centerY;

        svg.transition().duration(500)
            .call(zoomBehavior.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    }

    function showGameFeedback(msg, color = '#ff4455') {
        const resultEl = document.getElementById('game-result');
        resultEl.textContent = msg;
        resultEl.style.color = color;
        setTimeout(() => {
            if (resultEl.textContent === msg) {
                resultEl.textContent = '';
                resultEl.style.color = '';
            }
        }, 1400);
    }

    function gameMoveToNode(d) {
        if (d.nodeType !== 'term') return;
        if (d.id === gameState.currentId) return;
        const cadj = adjacency.get(gameState.currentId);
        if (!cadj?.neighbors.has(d.id)) {
            showGameFeedback('NOT CONNECTED ✗');
            return;
        }
        gameState.currentId = d.id;
        gameState.moves++;
        gameState.visitedPath.push(d.id);
        applyGameClasses();
        applyGameVisibility();
        updateGameHUD();
        panToNode(d);
        if (d.id === gameState.targetId) gameWon();
    }

    function gameWon() {
        gameState.active = false;
        gameState.revealed = true;
        playWinSound();
        const delta = gameState.moves - gameState.optimalMoves;
        let rating;
        let color;
        if (delta === 0) {
            rating = '&#x2605; OPTIMAL!';
            color = 'var(--accent)';
        } else if (delta <= 2) {
            rating = '&#x25C6; GOOD';
            color = '#ffaa22';
        } else {
            rating = '&#x25C7; DONE';
            color = '#9abfaa';
        }
        const resultEl = document.getElementById('game-result');
        resultEl.innerHTML =
            `${rating}<br><span class="game-score-line">`
            + `${gameState.moves} moves &middot; optimal: ${gameState.optimalMoves}</span>`;
        resultEl.style.color = color;
        applyGameClasses();
        applyGameVisibility();
        updateGameHUD();
    }

    function giveUp() {
        if (!gameState.active) return;
        gameState.active = false;
        gameState.revealed = true;
        const resultEl = document.getElementById('game-result');
        resultEl.style.color = '#cc7733';
        resultEl.innerHTML =
            `GAVE UP<br><span class="game-score-line">`
            + `optimal: ${gameState.optimalMoves} moves</span>`;
        applyGameClasses();
        applyGameVisibility();
        updateGameHUD();
    }

    function endGame() {
        gameState.active = false;
        gameState.revealed = false;
        gameState.startId = null;
        gameState.targetId = null;
        gameState.currentId = null;
        gameState.moves = 0;
        gameState.optimalMoves = 0;
        gameState.visitedPath = [];
        gameState.optimalPath = [];
        applyGameClasses();
        applyGameVisibility();
        updateGameHUD();
    }

    function startGame() {
        if (termNodes.length < 6) {
            document.getElementById('game-result').textContent = 'Not enough terms loaded.';
            return;
        }
        endGame();

        // BFS from a random start; find a target 3-8 hops away
        let attempts = 0;
        let optPath = null;
        let startNode;
        let targetNode;
        while (attempts++ < 80 && !optPath) {
            startNode = termNodes[Math.floor(Math.random() * termNodes.length)];

            // Collect BFS distances from startNode through term nodes
            const dist = new Map([[startNode.id, 0]]);
            const bfsQ = [startNode.id];
            let qi = 0;
            while (qi < bfsQ.length) {
                const cur = bfsQ[qi++];
                const cadj = adjacency.get(cur);
                if (!cadj) continue;
                for (const nb of cadj.neighbors) {
                    if (!dist.has(nb) && termNodeIdSet.has(nb)) {
                        dist.set(nb, dist.get(cur) + 1);
                        bfsQ.push(nb);
                    }
                }
            }

            const candidates = [...dist.entries()]
                .filter(([, d]) => d >= 3 && d <= 8)
                .map(([id]) => id);
            if (!candidates.length) continue;

            const targetId = candidates[Math.floor(Math.random() * candidates.length)];
            targetNode = nodeById(targetId);
            optPath = bfsPath(startNode.id, targetId);
        }

        if (!optPath) {
            document.getElementById('game-result').textContent =
                'Could not find a valid path - try again.';
            return;
        }

        Object.assign(gameState, {
            active: true,
            revealed: false,
            startId: startNode.id,
            targetId: targetNode.id,
            currentId: startNode.id,
            moves: 0,
            optimalMoves: optPath.length - 1,
            visitedPath: [startNode.id],
            optimalPath: optPath,
        });

        resetSelection();
        applyGameClasses();
        applyGameVisibility();
        updateGameHUD();
        const startReachable = [...(adjacency.get(startNode.id)?.neighbors || [])]
            .filter(id => termNodeIdSet.has(id));
        fitNodesInView([startNode.id, targetNode.id, ...startReachable]);
    }

    function openHelp() {
        const helpModal = document.getElementById('help-modal');
        if (!helpModal) return;
        helpModal.setAttribute('aria-hidden', 'false');
    }

    function closeHelp() {
        const helpModal = document.getElementById('help-modal');
        if (!helpModal) return;
        helpModal.setAttribute('aria-hidden', 'true');
    }

    document.getElementById('game-start-btn').addEventListener('click', startGame);
    document.getElementById('game-give-up-btn').addEventListener('click', giveUp);
    document.getElementById('game-help-btn').addEventListener('click', openHelp);
    document.getElementById('help-close-btn').addEventListener('click', closeHelp);
    document.getElementById('help-modal').addEventListener('click', ev => {
        if (ev.target === ev.currentTarget) closeHelp();
    });
}
