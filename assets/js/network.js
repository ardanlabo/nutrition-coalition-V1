// assets/js/network.js — v3.0
// Default: ORG ↔ REGION
// Drill-down: click ORG to spawn its Woredas in a radial layout (click again to collapse)

console.log("NETWORK GRAPH VERSION v3.0");

const MAX_WOREDAS_ON_EXPAND = 30;   // prevent visual overload
const RADIAL_RADIUS = 220;         // pixels-ish in vis coordinates

function rgba(r,g,b,a){ return `rgba(${r},${g},${b},${a})`; }

const COLORS = {
  org: rgba(80,170,255,0.95),
  region: rgba(190,140,255,0.95),
  woreda: rgba(255,120,120,0.75),
  edgeFaint: rgba(255,255,255,0.06),
  edgeHi: rgba(255,255,255,0.55)
};

function safeRegionName(r){
  const s = (r || "").toString().trim();
  return s.length ? s : "Unknown region";
}

function nodeStyle(kind){
  if (kind === "org") {
    return {
      shape: "dot",
      color: { background: COLORS.org, border: rgba(255,255,255,0.40) },
      font: { color: rgba(255,255,255,0.90), size: 12 },
      borderWidth: 1
    };
  }
  if (kind === "region") {
    return {
      shape: "dot",
      color: { background: COLORS.region, border: rgba(255,255,255,0.30) },
      font: { color: rgba(255,255,255,0.90), size: 13 },
      borderWidth: 1
    };
  }
  // woreda
  return {
    shape: "dot",
    color: { background: COLORS.woreda, border: rgba(255,255,255,0.18) },
    font: { color: rgba(255,255,255,0.80), size: 11 },
    borderWidth: 1
  };
}

// Build ORG→WOREDA coverage by traversing ORG→ACTIVITY→WOREDA
function buildOrgToWoredaMap(graphData) {
  const nodesById = new Map(graphData.nodes.map(n => [n.id, n]));
  const out = new Map(); // orgId -> Set(woredaId)

  // adjacency
  const adj = new Map();
  graphData.nodes.forEach(n => adj.set(n.id, []));
  graphData.edges.forEach(e => {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source).push(e.target);
    adj.get(e.target).push(e.source);
  });

  // find orgs
  const orgIds = graphData.nodes.filter(n => n.type === "org").map(n => n.id);
  const isActivity = (id) => (nodesById.get(id)?.type === "activity");
  const isWoreda = (id) => (nodesById.get(id)?.type === "woreda");

  orgIds.forEach(orgId => {
    const woredaSet = new Set();
    const neigh = adj.get(orgId) || [];

    // org neighbors that are activities
    const acts = neigh.filter(isActivity);

    // woredas are neighbors of those activities
    acts.forEach(aid => {
      const aNeigh = adj.get(aid) || [];
      aNeigh.forEach(x => {
        if (isWoreda(x)) woredaSet.add(x);
      });
    });

    out.set(orgId, woredaSet);
  });

  return { out, nodesById };
}

(async function main() {
  const container = document.getElementById("network");
  if (!container) return;

  const res = await fetch("data/network_4w_demo.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load data/network_4w_demo.json");
  const data = await res.json();

  const { out: orgToWoreda, nodesById } = buildOrgToWoredaMap(data);

  // --- Build REGION nodes from woreda metadata ---
  const regionToWoredas = new Map(); // regionName -> Set(woredaId)
  data.nodes.forEach(n => {
    if (n.type !== "woreda") return;
    const region = safeRegionName(n.Region);
    if (!regionToWoredas.has(region)) regionToWoredas.set(region, new Set());
    regionToWoredas.get(region).add(n.id);
  });

  const regions = Array.from(regionToWoredas.keys()).sort();

  // --- Create vis datasets (ONLY ORGs + REGIONS by default) ---
  const baseNodes = [];
  const baseEdges = [];

  // ORG nodes
  const orgNodes = data.nodes.filter(n => n.type === "org").sort((a,b)=>a.label.localeCompare(b.label));
  orgNodes.forEach((n) => {
    baseNodes.push({
      id: n.id,
      label: n.label || n.id,
      kind: "org",
      ...nodeStyle("org"),
      value: 14,
      title: n.label || n.id
    });
  });

  // REGION nodes
  regions.forEach((r) => {
    const size = regionToWoredas.get(r)?.size || 1;
    baseNodes.push({
      id: `REGION::${r}`,
      label: r,
      kind: "region",
      ...nodeStyle("region"),
      value: Math.min(22, 10 + Math.sqrt(size) * 2),
      title: `${r} — ${size} woredas (demo)`
    });
  });

  // ORG -> REGION edges weighted by number of woredas in that region for that org
  orgNodes.forEach((org) => {
    const wset = orgToWoreda.get(org.id) || new Set();

    // count per region
    const counts = new Map();
    wset.forEach(wid => {
      const wn = nodesById.get(wid);
      const r = safeRegionName(wn?.Region);
      counts.set(r, (counts.get(r) || 0) + 1);
    });

    counts.forEach((c, r) => {
      // skip tiny links to reduce clutter (demo tuning)
      if (c < 1) return;

      baseEdges.push({
        id: `E::${org.id}::REGION::${r}`,
        from: org.id,
        to: `REGION::${r}`,
        width: Math.min(6, 1 + Math.log(1 + c)),
        color: { color: COLORS.edgeFaint, highlight: COLORS.edgeHi },
        smooth: { type: "continuous" }
      });
    });
  });

  const visNodes = new vis.DataSet(baseNodes);
  const visEdges = new vis.DataSet(baseEdges);

  // --- Network options ---
  const options = {
    autoResize: true,
    interaction: {
      hover: true,
      tooltipDelay: 120,
      hideEdgesOnDrag: true
    },
    physics: { enabled: false },
    layout: { improvedLayout: false }
  };

  const network = new vis.Network(container, { nodes: visNodes, edges: visEdges }, options);

  // --- Layout ORGs left, REGIONS right (stable) ---
  function layoutBase() {
    const orgIds = orgNodes.map(o => o.id);
    const regIds = regions.map(r => `REGION::${r}`);

    function setColumn(ids, x, spacing) {
      ids.forEach((id, i) => {
        const y = (i - ids.length / 2) * spacing;
        network.moveNode(id, x, y);
        // lock X, let Y breathe slightly (more natural)
        visNodes.update({ id, fixed: { x: true, y: false } });
      });
    }

    setColumn(orgIds, -520, 70);
    setColumn(regIds, 520, 55);

    network.fit({ animation: { duration: 450, easingFunction: "easeInOutQuad" } });
  }

  layoutBase();

  // --- Drilldown state: expanded orgs -> their spawned woreda node ids ---
  const expanded = new Map(); // orgId -> array of spawned woreda vis ids

  function collapseOrg(orgId) {
    const spawned = expanded.get(orgId);
    if (!spawned) return;

    // remove woreda edges & nodes created for this org
    const edgeIdsToRemove = [];
    spawned.forEach(wNodeId => {
      edgeIdsToRemove.push(`E::DRILL::${orgId}::${wNodeId}`);
    });

    visEdges.remove(edgeIdsToRemove);
    visNodes.remove(spawned);

    expanded.delete(orgId);
  }

  function expandOrg(orgId) {
    const wset = orgToWoreda.get(orgId);
    if (!wset || wset.size === 0) return;

    // limit to avoid a mess (demo tuning)
    const woredaIds = Array.from(wset).slice(0, MAX_WOREDAS_ON_EXPAND);

    // get org position as center for radial layout
    const orgPos = network.getPositions([orgId])[orgId] || { x: -520, y: 0 };

    const spawnedNodeIds = [];

    woredaIds.forEach((wid, idx) => {
      const wn = nodesById.get(wid);
      const label = wn?.label || wn?.id || wid;
      const region = safeRegionName(wn?.Region);

      const angle = (2 * Math.PI * idx) / woredaIds.length;
      const x = orgPos.x + Math.cos(angle) * RADIAL_RADIUS;
      const y = orgPos.y + Math.sin(angle) * (RADIAL_RADIUS * 0.65);

      const vNodeId = `W::${orgId}::${wid}`; // unique per org drilldown
      spawnedNodeIds.push(vNodeId);

      visNodes.add({
        id: vNodeId,
        label: "",                   // no label (clean)
        title: `${label} (${region})`,
        kind: "woreda",
        ...nodeStyle("woreda"),
        value: 6,
        x, y,
        fixed: { x: true, y: true }  // keep radial ring stable
      });

      visEdges.add({
        id: `E::DRILL::${orgId}::${vNodeId}`,
        from: orgId,
        to: vNodeId,
        width: 1,
        color: { color: rgba(255,255,255,0.18), highlight: COLORS.edgeHi },
        smooth: { type: "continuous" }
      });
    });

    expanded.set(orgId, spawnedNodeIds);

    network.fit({ animation: { duration: 350, easingFunction: "easeInOutQuad" } });
  }

  // --- Edge fading + highlight ---
  function setAllEdges(alpha) {
    const col = `rgba(255,255,255,${alpha})`;
    const updates = [];
    visEdges.forEach((edge) => {
      updates.push({ id: edge.id, color: { color: col, highlight: COLORS.edgeHi } });
    });
    visEdges.update(updates);
  }

  setAllEdges(0.05);

  network.on("hoverNode", function (params) {
    const connected = network.getConnectedEdges(params.node);
    setAllEdges(0.02);
    visEdges.update(connected.map(id => ({ id, color: { color: COLORS.edgeHi, highlight: COLORS.edgeHi } })));
  });

  network.on("blurNode", function () {
    setAllEdges(0.05);
  });

  // --- Click behaviour: toggle drilldown on ORG nodes only ---
  network.on("click", function (params) {
    if (!params.nodes || params.nodes.length === 0) return;
    const nodeId = params.nodes[0];
    const node = visNodes.get(nodeId);
    if (!node) return;

    if (node.kind !== "org") return;

    if (expanded.has(nodeId)) {
      collapseOrg(nodeId);
    } else {
      expandOrg(nodeId);
    }
  });

  console.log("Network ready v3.0 (ORG↔REGION + drilldown woredas on click)");
})();
