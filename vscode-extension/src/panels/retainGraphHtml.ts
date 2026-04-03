import * as vscode from 'vscode';
import { OVERLAY_CSS, OVERLAY_HTML, OVERLAY_JS } from './connectionOverlay';

export function getRetainGraphHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const d3Uri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'd3.min.js')
    );

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Retain Graph Viewer</title>
<style>
:root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, var(--vscode-widget-border, #444));
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border, var(--border));
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --badge-bg: var(--vscode-badge-background, #007acc);
    --badge-fg: var(--vscode-badge-foreground, #fff);
    --danger: #f44747;
    --warn: #cca700;
    --ok: #89d185;
    --purple: #b267e6;
    --blue: #4fc1ff;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family, sans-serif); background: var(--bg); color: var(--fg); font-size: 13px; overflow: hidden; height: 100vh; }

.layout { display: flex; height: 100vh; }
.sidebar { width: 260px; min-width: 200px; border-right: 1px solid var(--border); padding: 12px; overflow-y: auto; flex-shrink: 0; }
.canvas-area { flex: 1; position: relative; }

h2 { font-size: 14px; margin-bottom: 10px; }
.section { margin-bottom: 12px; }
.section-title { font-weight: 600; font-size: 12px; margin-bottom: 6px; opacity: 0.8; }
.row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
input[type="text"], input[type="number"] {
    background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border);
    border-radius: 4px; padding: 4px 8px; font-size: 12px; width: 100%;
}
input[type="number"] { width: 70px; }
button {
    background: var(--btn-bg); color: var(--btn-fg); border: none;
    border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 11px; white-space: nowrap;
}
button:hover { opacity: 0.85; }
button.danger { background: var(--danger); }
button.small { padding: 3px 8px; font-size: 10px; }
.badge { background: var(--badge-bg); color: var(--badge-fg); border-radius: 10px; padding: 1px 7px; font-size: 10px; }
.error { color: var(--danger); font-size: 11px; margin-top: 4px; }
.status { font-size: 11px; opacity: 0.6; margin-top: 4px; }
label { font-size: 11px; display: flex; align-items: center; gap: 4px; cursor: pointer; }
label input[type="checkbox"] { margin: 0; }

.separator { border-top: 1px solid var(--border); margin: 10px 0; }

.detail-panel { font-size: 11px; }
.detail-panel .label { opacity: 0.6; font-size: 10px; }
.detail-panel .value { font-family: monospace; margin-bottom: 4px; word-break: break-all; }
.detail-panel table { width: 100%; border-collapse: collapse; margin-top: 4px; }
.detail-panel th, .detail-panel td { text-align: left; padding: 2px 4px; border-bottom: 1px solid var(--border); font-size: 10px; }
.detail-panel th { font-weight: 600; opacity: 0.7; }

svg { width: 100%; height: 100%; }

.cycle-banner {
    display: none; position: absolute; top: 8px; left: 50%; transform: translateX(-50%);
    background: rgba(244,71,71,0.9); color: #fff; padding: 6px 16px; border-radius: 6px;
    font-size: 12px; z-index: 10; display: flex; align-items: center; gap: 8px;
}
.cycle-banner.visible { display: flex; }
.cycle-banner button { background: rgba(255,255,255,0.2); color: #fff; border: 1px solid rgba(255,255,255,0.3); }

.toolbar {
    position: absolute; bottom: 10px; right: 10px; display: flex; gap: 4px; z-index: 10;
}

.tooltip {
    position: absolute; background: var(--input-bg); border: 1px solid var(--border);
    border-radius: 4px; padding: 4px 8px; font-size: 11px; pointer-events: none;
    z-index: 20; display: none; white-space: nowrap;
}

.node circle { cursor: pointer; stroke-width: 2.5; }
.node text { font-size: 10px; fill: var(--fg); pointer-events: none; }
.link { fill: none; stroke-width: 1.5; marker-end: url(#arrowhead); }
.link-label { font-size: 9px; fill: var(--fg); opacity: 0.7; }

.link.ivar { stroke: var(--blue); }
.link.block_capture { stroke: var(--purple); stroke-dasharray: 5 3; }
.link.associated_object { stroke: var(--warn); stroke-dasharray: 2 4; }
.link.collection_element { stroke: #888; }

@keyframes pulse-ring { 0% { stroke-opacity: 1; } 50% { stroke-opacity: 0.4; } 100% { stroke-opacity: 1; } }
.cycle-node circle { stroke: var(--danger) !important; stroke-width: 3; animation: pulse-ring 1.5s ease-in-out infinite; }
.cycle-edge { stroke: var(--danger) !important; stroke-width: 2.5; }

${OVERLAY_CSS}
</style>
</head>
<body>
${OVERLAY_HTML}

<div class="layout">
  <div class="sidebar">
    <h2>Retain Graph</h2>

    <div class="section">
      <div class="section-title">Target Object</div>
      <input type="text" id="addressInput" placeholder="0x... (object address)" />
      <div class="row" style="margin-top:6px">
        <button onclick="buildGraph()" style="flex:1">Build Graph</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Options</div>
      <label><input type="checkbox" id="optBlocks" checked /> Show Blocks</label>
      <label><input type="checkbox" id="optAssoc" checked /> Show Assoc</label>
      <label><input type="checkbox" id="optCollection" checked /> Show Collection</label>
      <div class="row" style="margin-top:4px">
        <span style="font-size:11px">Max Nodes:</span>
        <input type="number" id="maxNodes" value="200" min="10" max="2000" />
      </div>
      <div class="row">
        <span style="font-size:11px">Max Depth:</span>
        <input type="number" id="maxDepth" value="15" min="1" max="50" />
      </div>
    </div>

    <div class="separator"></div>

    <div class="section detail-panel" id="detailPanel" style="display:none">
      <div class="section-title">Selected Node</div>
      <div class="label">Class</div>
      <div class="value" id="detClass">-</div>
      <div class="label">Address</div>
      <div class="value" id="detAddr">-</div>
      <div class="label">Retain Count</div>
      <div class="value" id="detRC">-</div>
      <div class="label">Instance Size</div>
      <div class="value" id="detSize">-</div>
      <div class="row">
        <button class="small" onclick="expandSelected()">Expand Refs</button>
        <button class="small" onclick="copyAddress()">Copy Address</button>
      </div>
      <div id="detRefs" style="margin-top:6px"></div>
    </div>

    <div id="statusText" class="status"></div>
    <div id="errorText" class="error"></div>
  </div>

  <div class="canvas-area">
    <div class="cycle-banner" id="cycleBanner">
      <span id="cycleText">Found 0 cycle(s)</span>
      <button class="small" onclick="prevCycle()">← Prev</button>
      <button class="small" onclick="nextCycle()">Next →</button>
    </div>
    <div class="tooltip" id="tooltip"></div>
    <svg id="graphSvg"></svg>
    <div class="toolbar">
      <button class="small" onclick="resetZoom()">Reset</button>
      <button class="small" onclick="exportGraph()">Export JSON</button>
    </div>
  </div>
</div>

<script src="${d3Uri}"></script>
<script>
const vscode = acquireVsCodeApi();

let graphData = { nodes: [], edges: [], cycles: [] };
let simulation = null;
let selectedNode = null;
let currentCycleIdx = 0;
let cycleNodeSets = [];

const svg = d3.select('#graphSvg');
const tooltip = d3.select('#tooltip');
let g, linkGroup, nodeGroup, linkLabelGroup;
let zoomBehavior;

function initSvg() {
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    defs.append('marker')
        .attr('id', 'arrowhead')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20).attr('refY', 0)
        .attr('markerWidth', 6).attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', '#888');

    defs.append('marker')
        .attr('id', 'arrowhead-red')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20).attr('refY', 0)
        .attr('markerWidth', 6).attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', 'var(--danger)');

    g = svg.append('g');
    linkGroup = g.append('g').attr('class', 'links');
    linkLabelGroup = g.append('g').attr('class', 'link-labels');
    nodeGroup = g.append('g').attr('class', 'nodes');

    zoomBehavior = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoomBehavior);
}

function buildGraph() {
    const addr = document.getElementById('addressInput').value.trim();
    if (!addr) return;
    const maxNodes = parseInt(document.getElementById('maxNodes').value) || 200;
    const maxDepth = parseInt(document.getElementById('maxDepth').value) || 15;
    document.getElementById('statusText').textContent = 'Building graph...';
    document.getElementById('errorText').textContent = '';
    vscode.postMessage({ command: 'buildGraph', address: addr, maxNodes, maxDepth });
}

function renderGraph(data) {
    graphData = data;
    initSvg();

    if (!data.nodes || data.nodes.length === 0) {
        document.getElementById('statusText').textContent = 'No nodes found.';
        return;
    }

    const showBlocks = document.getElementById('optBlocks').checked;
    const showAssoc = document.getElementById('optAssoc').checked;
    const showCollection = document.getElementById('optCollection').checked;

    const nodes = data.nodes.map(n => ({ ...n }));
    let edges = data.edges.filter(e => {
        if (!showBlocks && e.source === 'block_capture') return false;
        if (!showAssoc && e.source === 'associated_object') return false;
        if (!showCollection && e.source === 'collection_element') return false;
        return true;
    });

    const nodeIds = new Set(nodes.map(n => n.id));
    edges = edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));

    const links = edges.map(e => ({ source: e.from, target: e.to, label: e.label, edgeSource: e.source }));

    cycleNodeSets = (data.cycles || []).map(c => new Set(c));
    const allCycleNodes = new Set();
    const allCycleEdges = new Set();
    for (const cycle of (data.cycles || [])) {
        for (let i = 0; i < cycle.length; i++) {
            allCycleNodes.add(cycle[i]);
            const from = cycle[i];
            const to = cycle[(i + 1) % cycle.length];
            allCycleEdges.add(from + '->' + to);
        }
    }

    if (data.cycles && data.cycles.length > 0) {
        const banner = document.getElementById('cycleBanner');
        banner.classList.add('visible');
        document.getElementById('cycleText').textContent = 'Found ' + data.cycles.length + ' retain cycle(s)';
        currentCycleIdx = 0;
    } else {
        document.getElementById('cycleBanner').classList.remove('visible');
    }

    const w = svg.node().clientWidth || 800;
    const h = svg.node().clientHeight || 600;

    simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(100))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(w / 2, h / 2))
        .force('collision', d3.forceCollide().radius(30));

    const link = linkGroup.selectAll('line')
        .data(links).enter().append('line')
        .attr('class', d => {
            let cls = 'link ' + (d.edgeSource || 'ivar');
            if (allCycleEdges.has(d.source.id + '->' + d.target.id)) cls += ' cycle-edge';
            return cls;
        })
        .attr('marker-end', d => allCycleEdges.has(d.source.id + '->' + d.target.id) ? 'url(#arrowhead-red)' : 'url(#arrowhead)');

    const linkLabel = linkLabelGroup.selectAll('text')
        .data(links).enter().append('text')
        .attr('class', 'link-label')
        .text(d => d.label || '');

    const node = nodeGroup.selectAll('g')
        .data(nodes).enter().append('g')
        .attr('class', d => 'node' + (allCycleNodes.has(d.id) ? ' cycle-node' : ''))
        .call(d3.drag()
            .on('start', dragStart)
            .on('drag', dragging)
            .on('end', dragEnd));

    node.append('circle')
        .attr('r', 12)
        .attr('fill', d => {
            if (d.isBlock) return 'var(--purple)';
            if (allCycleNodes.has(d.id)) return 'rgba(244,71,71,0.15)';
            return 'var(--btn-bg)';
        })
        .attr('stroke', d => allCycleNodes.has(d.id) ? 'var(--danger)' : 'var(--blue)');

    node.append('text')
        .attr('dx', 16).attr('dy', 4)
        .text(d => d.className.length > 20 ? d.className.substring(0, 18) + '…' : d.className);

    node.on('click', (event, d) => selectNode(d))
        .on('dblclick', (event, d) => {
            event.stopPropagation();
            document.getElementById('addressInput').value = d.address;
            vscode.postMessage({ command: 'expandNode', address: d.address });
        })
        .on('mouseover', (event, d) => {
            tooltip.style('display', 'block')
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 10) + 'px')
                .text(d.className + ' ' + d.address);
        })
        .on('mouseout', () => tooltip.style('display', 'none'));

    link.on('mouseover', (event, d) => {
        tooltip.style('display', 'block')
            .style('left', (event.pageX + 10) + 'px')
            .style('top', (event.pageY - 10) + 'px')
            .text((d.edgeSource || 'ref') + ': ' + (d.label || ''));
    }).on('mouseout', () => tooltip.style('display', 'none'));

    simulation.on('tick', () => {
        link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        linkLabel.attr('x', d => (d.source.x + d.target.x) / 2)
                 .attr('y', d => (d.source.y + d.target.y) / 2);
        node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
    });

    document.getElementById('statusText').textContent = nodes.length + ' nodes, ' + links.length + ' edges';
}

function dragStart(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
}
function dragging(event, d) { d.fx = event.x; d.fy = event.y; }
function dragEnd(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null; d.fy = null;
}

function selectNode(d) {
    selectedNode = d;
    const panel = document.getElementById('detailPanel');
    panel.style.display = '';
    document.getElementById('detClass').textContent = d.className;
    document.getElementById('detAddr').textContent = d.address;
    document.getElementById('detRC').textContent = d.retainCount || '-';
    document.getElementById('detSize').textContent = d.instanceSize ? d.instanceSize + ' bytes' : '-';
    document.getElementById('detRefs').innerHTML = '';

    nodeGroup.selectAll('circle').attr('opacity', 1);
    linkGroup.selectAll('line').attr('opacity', 0.3);

    const connectedLinks = linkGroup.selectAll('line')
        .filter(l => l.source.id === d.id || l.target.id === d.id);
    connectedLinks.attr('opacity', 1);

    const connectedIds = new Set([d.id]);
    connectedLinks.each(l => { connectedIds.add(l.source.id); connectedIds.add(l.target.id); });

    vscode.postMessage({ command: 'getNodeDetail', address: d.address });
}

function expandSelected() {
    if (!selectedNode) return;
    vscode.postMessage({ command: 'expandNode', address: selectedNode.address });
}

function copyAddress() {
    if (!selectedNode) return;
    const ta = document.createElement('textarea');
    ta.value = selectedNode.address;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
}

function prevCycle() {
    if (cycleNodeSets.length === 0) return;
    currentCycleIdx = (currentCycleIdx - 1 + cycleNodeSets.length) % cycleNodeSets.length;
    focusCycle(currentCycleIdx);
}
function nextCycle() {
    if (cycleNodeSets.length === 0) return;
    currentCycleIdx = (currentCycleIdx + 1) % cycleNodeSets.length;
    focusCycle(currentCycleIdx);
}

function focusCycle(idx) {
    const cycleSet = cycleNodeSets[idx];
    if (!cycleSet || !graphData.nodes) return;
    const cycleNodes = graphData.nodes.filter(n => cycleSet.has(n.id));
    if (cycleNodes.length === 0) return;

    const cx = cycleNodes.reduce((s, n) => s + (n.x || 0), 0) / cycleNodes.length;
    const cy = cycleNodes.reduce((s, n) => s + (n.y || 0), 0) / cycleNodes.length;
    const w = svg.node().clientWidth || 800;
    const h = svg.node().clientHeight || 600;

    svg.transition().duration(500).call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(w / 2 - cx, h / 2 - cy)
    );
}

function resetZoom() {
    svg.transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity);
    linkGroup.selectAll('line').attr('opacity', 1);
    nodeGroup.selectAll('circle').attr('opacity', 1);
}

function exportGraph() {
    vscode.postMessage({ command: 'exportGraph', data: graphData });
}

function renderNodeDetail(data) {
    if (!data || data.error) return;
    const container = document.getElementById('detRefs');
    let html = '';

    if (data.ivars && data.ivars.length) {
        html += '<div class="section-title" style="margin-top:6px">Strong Ivars</div>';
        html += '<table><tr><th>Name</th><th>Class</th></tr>';
        for (const iv of data.ivars) {
            html += '<tr><td>' + esc(iv.name || '?') + '</td><td>' + esc(iv.className) + '</td></tr>';
        }
        html += '</table>';
    }

    if (data.blockCaptures && data.blockCaptures.length) {
        html += '<div class="section-title" style="margin-top:6px">Block Captures</div>';
        html += '<table><tr><th>Index</th><th>Class</th></tr>';
        for (const bc of data.blockCaptures) {
            html += '<tr><td>' + (bc.index || '?') + '</td><td>' + esc(bc.className) + '</td></tr>';
        }
        html += '</table>';
    }

    if (data.assocObjects && data.assocObjects.length) {
        html += '<div class="section-title" style="margin-top:6px">Associated Objects</div>';
        html += '<table><tr><th>Key</th><th>Class</th></tr>';
        for (const ao of data.assocObjects) {
            html += '<tr><td>' + esc(ao.key) + '</td><td>' + esc(ao.className) + '</td></tr>';
        }
        html += '</table>';
    }

    container.innerHTML = html;
}

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.command) {
        case 'graphData':
            renderGraph(msg.data);
            break;
        case 'nodeDetail':
            renderNodeDetail(msg.data);
            break;
        case 'nodeExpanded':
            document.getElementById('statusText').textContent = 'Expanded ' + (msg.refs || []).length + ' refs';
            break;
        case 'error':
            document.getElementById('errorText').textContent = msg.text;
            document.getElementById('statusText').textContent = '';
            break;
        case 'setAddress':
            document.getElementById('addressInput').value = msg.address;
            break;
    }
});

initSvg();

${OVERLAY_JS}
</script>
</body>
</html>`;
}
