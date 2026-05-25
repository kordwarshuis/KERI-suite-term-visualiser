import { CONFIG } from './config.js';

export function buildGraphData(allTerms, allRawLinks) {
    const nodes = [];
    const links = [];

    // Term lookup: "specId::slug" -> nodeId
    const termIndex = new Map();
    for (const t of allTerms) {
        termIndex.set(`${t.specId}::${t.slug}`, t.id);
        termIndex.set(`${t.specId}::${t.slug.replace(/_/g, '-').toLowerCase()}`, t.id);
    }

    // Hub nodes (one per spec)
    const hubId = s => `hub::${s.id}`;
    for (const s of CONFIG.specs) {
        nodes.push({ id: hubId(s), label: s.label, fullLabel: s.fullLabel, specId: s.id, nodeType: 'hub', r: 34 });
    }

    // Term nodes
    for (const t of allTerms) {
        nodes.push({ ...t, nodeType: 'term', r: 5.5 });
    }

    // Resolve raw links
    const extNodes = new Map();
    const edgeSet = new Set();

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
            const targetId = termIndex.get(key)
                || termIndex.get(`${cl.specId}::${cl.slug.replace(/_/g, '-').toLowerCase()}`);
            if (!targetId) continue;
            // Resolve fromId to the actual node id — xtrefs slugs may differ from slugFromDt.
            const srcId = termIndex.get(fromId)
                || termIndex.get(fromId.replace(/_/g, '-').toLowerCase());
            if (!srcId) continue;
            addEdge(srcId, targetId, cl.type);
        }
    }

    return { nodes, links };
}
