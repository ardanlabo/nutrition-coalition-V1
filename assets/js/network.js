// assets/js/network.js
import Graph from "https://esm.sh/graphology";
import Sigma from "https://esm.sh/sigma";
import FA2 from "https://esm.sh/graphology-layout-forceatlas2";

const container = document.getElementById("network");

// ---- Helpers ----
function colorByType(t) {
  if (t === "org") return "rgba(80,170,255,0.95)";
  if (t === "activity") return "rgba(110,230,160,0.95)";
  return "rgba(255,120,120,0.95)"; // woreda
}

function edgeColorByType(t) {
  if (t === "org_activity") return "rgba(255,255,255,0.22)";
  return "rgba(255,255,255,0.14)"; // activity_woreda
}

// ---- Load data ----
const res = await fetch("data/network_4w_demo.json");
if (!res.ok) throw new Error("Failed to load data/network_4w_demo.json");
const data = await res.json();

// ---- Build graph ----
const graph = new Graph();

data.nodes.forEach((n) => {
  graph.addNode(n.id, {
    label: n.label || n.id,
    size: n.size || 8,
    color: colorByType(n.type),
    type: n.type,
    // random initial positions for layout
    x: Math.random(),
    y: Math.random(),
    // tooltip meta (optional)
    Region: n.Region || "",
    Zone: n.Zone || "",
    adm3_pcode: n.adm3_pcode || ""
  });
});

data.edges.forEach((e) => {
  if (!graph.hasEdge(e.source, e.target) && !graph.hasEdge(e.target, e.source)) {
    graph.addEdge(e.source, e.target, {
      type: e.type,
      weight: e.weight || 1,
      color: edgeColorByType(e.type),
      size: 1
    });
  }
});

// ---- Layout (Kumu-like clustering) ----
const settings = FA2.inferSettings(graph);
FA2.assign(graph, { settings, iterations: 160 });

// ---- Render ----
const renderer = new Sigma(graph, container, {
  renderEdgeLabels: false,
  minCameraRatio: 0.2,
  maxCameraRatio: 4
});

// ---- Hover highlight neighbors ----
renderer.on("enterNode", ({ node }) => {
  const neighbors = new Set(graph.neighbors(node));
  neighbors.add(node);

  graph.forEachNode((n) => {
    graph.setNodeAttribute(n, "hidden", !neighbors.has(n));
  });

  graph.forEachEdge((e, attrs, s, t) => {
    graph.setEdgeAttribute(e, "hidden", !(neighbors.has(s) && neighbors.has(t)));
  });

  renderer.refresh();
});

renderer.on("leaveNode", () => {
  graph.forEachNode((n) => graph.setNodeAttribute(n, "hidden", false));
  graph.forEachEdge((e) => graph.setEdgeAttribute(e, "hidden", false));
  renderer.refresh();
});

// ---- Subtle autopan (wow without gimmick) ----
let t = 0;
function animate() {
  t += 0.0025;
  const cam = renderer.getCamera();
  const state = cam.getState();
  cam.setState(
    {
      angle: 0,
      ratio: state.ratio,
      x: Math.sin(t) * 0.03,
      y: Math.cos(t) * 0.03
    },
    { duration: 80 }
  );
  requestAnimationFrame(animate);
}
animate();
