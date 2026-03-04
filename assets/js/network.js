// assets/js/network.js — v3.1 (Spotlight / site-hero)
// Goal: LOOK GOOD on a website. Not exhaustive analytics.
// Default: show ORGs + REGIONS, but edges are hidden.
// Auto-focus a featured NGO on load (wow). Click NGO to focus.

console.log("NETWORK GRAPH VERSION v3.1");

const DATA_URL = "data/network_4w_demo.json"; // keep your existing filename
const FEATURED_ORG_NAME = "International Organization for Migration"; // will fallback if not found

const MAX_WOREDAS_ON_EXPAND = 26;     // visual budget
const RADIAL_RADIUS = 120;           // compact
const EDGE_FAINT = "rgba(255,255,255,0.03)";
const EDGE_HIDDEN = "rgba(255,255,255,0.00)";
const EDGE_HI = "rgba(255,255,255,0.55)";

function rgba(r,g,b,a){ return `rgba(${r},${g},${b},${a})`; }

const COLORS = {
  org: rgba(80,170,255,0.95),
  region: rgba(190,140,255,0.95),
  woreda: rgba(255,120,120,0.78),

  orgDim: rgba(80,170,255,0.18),
  regionDim: rgba(190,140,255,0.18),
  woredaDim: rgba(255,120,120,0.10),

  border: rgba(255,255,255,0.22),
  borderHi: rgba(255,255,255,0.85),
};

function safe(s){ return (s || "").toString().trim(); }
function safeRegionName(r){ return safe(r) || "Unknown"; }

function setPanel(name, meta){
  const n = document.getElementById("focusName");
  const m = document.getElementById("focusMeta");
  if (n) n.textContent = name || "—";
  if (m) m.textContent = meta || "—";
}

function buildAdj(data){
  const adj = new Map();
  data.nodes.forEach(n => adj.set(n.id, []));
  data.edges.forEach(e => {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source).push(e.target);
    adj.get(e.target).push(e.source);
  });
  return adj;
}

// Build org -> set(woreda) via org->activity->woreda
function buildOrgToWoreda(data){
  const nodesById = new Map(data.nodes.map(n => [n.id, n]));
  const adj = buildAdj(data);

  const isActivity = (id) => nodesById.get(id)?.type === "activity";
  const isWoreda = (id) => nodesById.get(id)?.type === "woreda";

  const orgIds = data.nodes.filter(n => n.type === "org").map(n => n.id);

  const orgToW = new Map();
  orgIds.forEach(orgId => {
    const wset = new Set();
    const neigh = adj.get(orgId) || [];
    const acts = neigh.filter(isActivity);
    acts.forEach(aid => {
      const aNeigh = adj.get(aid) || [];
      aNeigh.forEach(x => { if (isWoreda(x)) wset.add(x); });
    });
    orgToW.set(orgId, wset);
  });

  return { orgToW, nodesById };
}

(async function main(){
  const container = document.getElementById("network");
  if (!container) return;

  const res = await fetch(DATA_URL, { cache:"no-store" });
  if (!res.ok) throw new Error("Failed to load " + DATA_URL);
  const data = await res.json();

  const { orgToW, nodesById } = buildOrgToWoreda(data);

  // Regions from woreda metadata
  const regionToWoredas = new Map();
  data.nodes.forEach(n => {
    if (n.type !== "woreda") return;
    const r = safeRegionName(n.Region);
    if (!regionToWoredas.has(r)) regionToWoredas.set(r, new Set());
    regionToWoredas.get(r).add(n.id);
  });

  const regions = Array.from(regionToWoredas.keys()).sort();

  // Sort orgs by coverage (for featured fallback)
  const orgNodes = data.nodes
    .filter(n => n.type === "org")
    .map(n => ({
      id: n.id,
      label: n.label || n.id,
      cov: (orgToW.get(n.id)?.size || 0)
    }))
    .sort((a,b)=> b.cov - a.cov || a.label.localeCompare(b.label));

  let featuredOrgId = orgNodes.find(o => o.label === FEATURED_ORG_NAME)?.id || orgNodes[0]?.id;

  // --- Base nodes (ORG + REGION only) ---
  const baseNodes = [];

  orgNodes.forEach(o => {
    baseNodes.push({
      id: o.id,
      kind: "org",
      label: o.label,
      value: Math.min(26, 12 + Math.sqrt(Math.max(o.cov,1))*2.2),
      shape: "dot",
      color: { background: COLORS.org, border: COLORS.border },
      font: { color: rgba(255,255,255,0.90), size: 12 },
      borderWidth: 1,
      title: `${o.label} — ${o.cov} woredas (demo)`
    });
  });

  regions.forEach(r => {
    const size = regionToWoredas.get(r)?.size || 1;
    baseNodes.push({
      id: `REGION::${r}`,
      kind: "region",
      label: r,
      value: Math.min(24, 10 + Math.sqrt(size)*2.0),
      shape: "dot",
      color: { background: COLORS.region, border: COLORS.border },
      font: { color: rgba(255,255,255,0.90), size: 13 },
      borderWidth: 1,
      title: `${r} — ${size} woredas (demo)`
    });
  });

  // --- Base edges ORG -> REGION (we create all but keep them hidden until focus) ---
  const baseEdges = [];
  const MIN_WOREDAS_PER_REGION_LINK = 2; // remove noise

  orgNodes.forEach(org => {
    const wset = orgToW.get(org.id) || new Set();
    const counts = new Map();

    wset.forEach(wid => {
      const wn = nodesById.get(wid);
      const r = safeRegionName(wn?.Region);
      counts.set(r, (counts.get(r) || 0) + 1);
    });

    counts.forEach((c, r) => {
      if (c < MIN_WOREDAS_PER_REGION_LINK) return;

      baseEdges.push({
        id: `E::${org.id}::REGION::${r}`,
        from: org.id,
        to: `REGION::${r}`,
        width: Math.min(6, 1 + Math.log(1 + c)),
        smooth: { type:"continuous" },

        // start hidden
        color: { color: EDGE_HIDDEN, highlight: EDGE_HI }
      });
    });
  });

  const visNodes = new vis.DataSet(baseNodes);
  const visEdges = new vis.DataSet(baseEdges);

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

  // --- Base layout: ORGs left, REGIONS right ---
  function setColumn(ids, x, spacing){
    ids.forEach((id,i)=>{
      const y = (i - ids.length/2) * spacing;
      network.moveNode(id, x, y);
      visNodes.update({ id, fixed: { x:true, y:false } }); // lock X only, looks natural
    });
  }

  const orgIds = orgNodes.map(o => o.id);
  const regIds = regions.map(r => `REGION::${r}`);

  setColumn(orgIds, -520, 72);
  setColumn(regIds, 520, 64);

  network.fit({ animation:{ duration: 450, easingFunction:"easeInOutQuad" } });

  // --- Drilldown nodes for focused org ---
  const expanded = new Map(); // orgId -> spawned woreda node ids

  function removeDrill(orgId){
    const spawned = expanded.get(orgId);
    if (!spawned) return;

    const eids = spawned.map(wid => `E::DRILL::${orgId}::${wid}`);
    visEdges.remove(eids);
    visNodes.remove(spawned);

    expanded.delete(orgId);
  }

  function addDrill(orgId){
    const wset = orgToW.get(orgId);
    if (!wset || wset.size === 0) return;

    const woredaIds = Array.from(wset).slice(0, MAX_WOREDAS_ON_EXPAND);

    const pos = network.getPositions([orgId])[orgId] || { x:-520, y:0 };

    const spawned = [];

    woredaIds.forEach((wid, idx) => {
      const wn = nodesById.get(wid);
      const label = safe(wn?.label) || safe(wn?.id) || wid;
      const region = safeRegionName(wn?.Region);
      const zone = safe(wn?.Zone);
      const pcode = safe(wn?.adm3_pcode);

      const ang = (2*Math.PI*idx)/woredaIds.length;
      const x = pos.x + Math.cos(ang) * RADIAL_RADIUS;
      const y = pos.y + Math.sin(ang) * (RADIAL_RADIUS * 0.70);

      const vId = `W::${orgId}::${wid}`;
      spawned.push(vId);

      visNodes.add({
        id: vId,
        kind: "woreda",
        label: "", // keep clean, tooltip only
        title: `${label}${zone ? " · "+zone : ""} · ${region}${pcode ? " · "+pcode : ""}`,
        value: 3,
        shape: "dot",
        color: { background: COLORS.woreda, border: rgba(255,255,255,0.14) },
        font: { color: rgba(255,255,255,0.80), size: 11 },
        borderWidth: 1,
        x, y,
        fixed: { x:true, y:true }
      });

      visEdges.add({
        id: `E::DRILL::${orgId}::${vId}`,
        from: orgId,
        to: vId,
        width: 1,
        smooth: { type:"continuous" },
        color: { color: rgba(255,255,255,0.16), highlight: EDGE_HI }
      });
    });

    expanded.set(orgId, spawned);
  }

  // --- Spotlight focus ---
  let focusedOrg = null;

  function dimAll(){
    // dim nodes
    const updates = [];
    visNodes.forEach(n => {
      if (n.kind === "org"){
        updates.push({ id:n.id, color:{ background: COLORS.orgDim, border: rgba(255,255,255,0.10) }, font:{ color: rgba(255,255,255,0.35) } });
      } else if (n.kind === "region"){
        updates.push({ id:n.id, color:{ background: COLORS.regionDim, border: rgba(255,255,255,0.10) }, font:{ color: rgba(255,255,255,0.35) } });
      } else {
        updates.push({ id:n.id, color:{ background: COLORS.woredaDim, border: rgba(255,255,255,0.10) } });
      }
    });
    visNodes.update(updates);

    // hide base edges
    const eUpdates = [];
    visEdges.forEach(e => {
      if ((e.id || "").startsWith("E::DRILL::")) return;
      eUpdates.push({ id:e.id, color:{ color: EDGE_HIDDEN, highlight: EDGE_HI } });
    });
    visEdges.update(eUpdates);
  }

  function focusOrg(orgId){
    // clear previous drill
    if (focusedOrg && focusedOrg !== orgId) removeDrill(focusedOrg);

    focusedOrg = orgId;

    dimAll();

    // highlight focused org node
    visNodes.update({
      id: orgId,
      color: { background: COLORS.org, border: COLORS.borderHi },
      font: { color: rgba(255,255,255,0.95), size: 12 }
    });

    // show only its ORG->REGION edges (and brighten connected regions)
    const showEdges = [];
    const brightenRegions = [];

    visEdges.forEach(e => {
      if ((e.id || "").startsWith(`E::${orgId}::REGION::`)){
        showEdges.push({ id:e.id, color:{ color: EDGE_FAINT, highlight: EDGE_HI } });
        brightenRegions.push(e.to);
      }
    });

    visEdges.update(showEdges);

    // brighten connected regions
    brightenRegions.forEach(rid => {
      visNodes.update({
        id: rid,
        color: { background: COLORS.region, border: COLORS.border },
        font: { color: rgba(255,255,255,0.92), size: 13 }
      });
    });

    // drill-down woredas for wow
    addDrill(orgId);

    const orgLabel = visNodes.get(orgId)?.label || orgId;
    const cov = orgToW.get(orgId)?.size || 0;
    setPanel(orgLabel, `${cov} woredas in dataset · Links shown only for this NGO · Hover nodes for tooltips`);

    network.fit({ animation:{ duration: 420, easingFunction:"easeInOutQuad" } });
  }

  function resetView(){
    if (focusedOrg) removeDrill(focusedOrg);
    focusedOrg = null;

    // restore base node colors
    const updates = [];
    visNodes.forEach(n => {
      if (n.kind === "org"){
        updates.push({ id:n.id, color:{ background: COLORS.org, border: COLORS.border }, font:{ color: rgba(255,255,255,0.90), size:12 } });
      } else if (n.kind === "region"){
        updates.push({ id:n.id, color:{ background: COLORS.region, border: COLORS.border }, font:{ color: rgba(255,255,255,0.90), size:13 } });
      }
    });
    visNodes.update(updates);

    // hide all base edges again (clean homepage)
    const eUpdates = [];
    visEdges.forEach(e => {
      if ((e.id || "").startsWith("E::DRILL::")) return;
      eUpdates.push({ id:e.id, color:{ color: EDGE_HIDDEN, highlight: EDGE_HI } });
    });
    visEdges.update(eUpdates);

    setPanel("Overview", "Click an NGO to focus. This view is intentionally minimal for a clean website visual.");

    network.fit({ animation:{ duration: 420, easingFunction:"easeInOutQuad" } });
  }

  // interactions
  network.on("click", (params) => {
    if (!params.nodes || params.nodes.length === 0) return;
    const nodeId = params.nodes[0];
    const node = visNodes.get(nodeId);
    if (!node || node.kind !== "org") return;

    if (focusedOrg === nodeId){
      resetView();
      // immediately focus featured again? no: leave overview clean
    } else {
      focusOrg(nodeId);
    }
  });

  const resetBtn = document.getElementById("resetBtn");
  if (resetBtn) resetBtn.addEventListener("click", resetView);

  // Start: clean overview, then auto-focus featured for wow
  resetView();
  if (featuredOrgId) {
    // small delay so it feels intentional
    setTimeout(() => focusOrg(featuredOrgId), 350);
  }

  console.log("Network ready v3.1 (Spotlight)");
})();
