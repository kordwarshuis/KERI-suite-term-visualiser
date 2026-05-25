import { CONFIG } from './config.js';
import { fetchPage, setStatus } from './utils.js';
import { parsePage } from './parsing.js';
import { buildGraphData } from './graph-data.js';
import { render } from './renderer.js';

export async function main() {
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

    setStatus('Building graph…');
    const graphData = buildGraphData(allTerms, allRawLinks);
    const termCount = allTerms.length;
    const edgeCount = graphData.links.filter(l => l.type !== 'hub').length;

    console.log(`[graph] ${graphData.nodes.length} nodes, ${graphData.links.length} links (${edgeCount} semantic edges)`);
    setStatus('Rendering…');
    render(graphData);
    setStatus(`${termCount} terms · ${edgeCount} edges`, 'ok');
}
