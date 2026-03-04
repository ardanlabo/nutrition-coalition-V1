// assets/js/network.js — v1.2
// UMD, stable, layered layout (ORG → ACTIVITY → WOREDA), readable

console.log("NETWORK GRAPH VERSION v1.2");

// --- Colors ---
function nodeFill(category) {
  if (category === "org") return "rgba(80,170,255,0.92)";
  if (category === "activity") return "rgba(110,230,160,0.92)";
  return "rgba(255,120,120,0.92)";
}

function edgeStroke(edgeType) {
  if (edgeType === "org_activity") return "rgba(255,255,255,0.18)";
  return "rgba(255,255,255,0.10)";
}

// --- Layout: 3 columns / layers ---
function runLayeredLayout(graph) {
  const orgs = [];
  const acts = [];
  const wors = [];

  graph.forEachNode((node, attrs) => {
    if (attrs.category === "org") orgs.push(node);
    else if (attrs.category === "activity") acts.push(node);
    else wors.push(node);
  });

  // Sort for stability (prevents random reshuffles)
  orgs.sort();
  acts.sort();
  wors.sort();

  // Column x positions
  const xOrg = -3.2;
  const xAct = 0.0;
  const xWor = 3.2;

  // Vertical spacing (tune if needed)
  const spacingOrg = 0.55;
  const spacingAct = 0.70;
  const spacingWor = 0.30;

  // Center each column vertically
  orgs.forEach((node, i) => {
    graph.setNodeAttribute(node, "x", xOrg);
    graph.setNodeAttribute(node, "y", (i - orgs.length / 2) * spacingOrg);
  });

  acts.forEach((node, i) => {
    graph.setNodeAttribute(node, "x", xAct);
    graph.setNodeAttribute(node, "y", (i - acts.length / 2) * spacingAct);
  });

  wors.forEach((node, i) => {
    graph.setNodeAttribute(node, "x", xWor);
    graph.setNodeAttribute(node, "y", (i - wors.length / 2) * spacingWor);
  });

  // Small jitter to avoid perfect overlaps
  graph.forEachNode((node) => {
    const x = graph.getNodeAttribute(node, "x");
    const y = graph.getNodeAttribute(node, "y");
    graph.setNodeAttribute(node, "x", x + (Math.random() - 0.5) * 0.08);
    graph.setNodeAttribute(node, "y", y + (Math.random() - 0.5) * 0.08);
  });
}

(async function main() {
  const container = document.getElementById("network");
  if (!container) {
    console.error("Missing #network container");
    return;
  }

  const res = await fetch("data/network_4w_demo.json", { cache: "no-store" });
  if (!res.ok) {
    console.error("Failed to load data/network_4w_demo.json", res.status);
    return;
  }
  const data = await res.json();

  const graph = new graphology.Graph();

  // Nodes
  data.nodes.forEach((n) => {
    const category = n.type || "woreda"; // org/activity/woreda from JSON

    graph.addNode(n.id, {
      label: n.label || n.id,

      // Sigma rendering program (must be valid)
      type: "circle",

      // Our category
      category,

      // Visuals
      color: nodeFill(category),
      size: n.size || 8,

      // Init pos (will be overridden by layered layout)
      x: 0,
      y: 0,

      // Optional meta
      Region: n.Region || "",
      Zone: n.Zone || "",
      adm3_pcode: n.adm3_pcode || "",

      labelColor: "rgba(255,255,255,0.85)",
      labelSize: 10
    });
  });

  // Edges
  data.edges.forEach((e, i) => {
    const edgeId = e.id || `e_${i}`;
    if (!graph.hasEdge(e.source, e.target) && !graph.hasEdge(e.target, e.source)) {
      graph.addEdgeWithKey(edgeId, e.source, e.target, {
        edgeType: e.type || "link",
        color: edgeStroke(e.type),
        size: 1
      });
    }
  });

  // Layout (structured and readable)
  runLayeredLayout(graph);

  // Renderer
  const renderer = new Sigma(graph, container, {
    renderEdgeLabels: false,
    labelRenderedSizeThreshold: 9999
  });

  // Default camera
  renderer.getCamera().setState({ ratio: 1 });

  // Hover highlight neighbors
  const dimNode = "rgba(255,255,255,0.10)";
  const dimEdge = "rgba(255,255,255,0.03)";

  // Save original colors
  graph.forEachNode((node, attrs) => graph.setNodeAttribute(node, "origColor", attrs.color));
  graph.forEachEdge((edge, attrs) => graph.setEdgeAttribute(edge, "origColor", attrs.color));

  function resetStyles() {
    graph.forEachNode((n) => graph.setNodeAttribute(n, "color", graph.getNodeAttribute(n, "origColor")));
    graph.forEachEdge((e) => graph.setEdgeAttribute(e, "color", graph.getEdgeAttribute(e, "origColor")));
    renderer.refresh();
  }

  renderer.on("enterNode", ({ node }) => {
    const neighbors = new Set(graph.neighbors(node));
    neighbors.add(node);

    graph.forEachNode((n) => {
      if (!neighbors.has(n)) graph.setNodeAttribute(n, "color", dimNode);
      else graph.setNodeAttribute(n, "color", graph.getNodeAttribute(n, "origColor"));
    });

    graph.forEachEdge((e, attrs, s, t) => {
      if (!(neighbors.has(s) && neighbors.has(t))) graph.setEdgeAttribute(e, "color", dimEdge);
      else graph.setEdgeAttribute(e, "color", graph.getEdgeAttribute(e, "origColor"));
    });

    renderer.refresh();
  });

  renderer.on("leaveNode", () => resetStyles());

  // Labels only when zoomed
  function updateLabelThreshold() {
    const ratio = renderer.getCamera().getState().ratio;
    const threshold = ratio < 1.25 ? 0 : 9999;
    renderer.setSetting("labelRenderedSizeThreshold", threshold);
  }

  renderer.getCamera().on("updated", updateLabelThreshold);
  updateLabelThreshold();

  console.log("Network graph ready v1.2");
})();
