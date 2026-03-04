// assets/js/network.js
import Graph from "https://unpkg.com/graphology@0.25.4/dist/graphology.esm.min.js";
import Sigma from "https://unpkg.com/sigma@2.4.0/build/sigma.esm.min.js";
import FA2 from "https://unpkg.com/graphology-layout-forceatlas2@0.10.1/dist/graphology-layout-forceatlas2.esm.min.js";

const container = document.getElementById("network");
if (!container) throw new Error("Missing #network container");

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
const res = await fetch("data/network_4w_demo.json", { cache: "no-store" });
if (!res.ok) throw new Error(`Failed to load JSON (${res.status})`);
const data = await res.json();

// ---- Build graph ----
const graph = new Graph();

data.nodes.forEach((n) => {
  graph.addNode(n.id, {
    label: n.label || n.id,
    size: n.size || 8,
    color: colorByType(n.type),
    type: n.type,
    x: Math.random(),
    y: Math.random(),
    Region: n.Region || "",
    Zone: n.Zone || "",
    adm3_pcode: n.adm3_pcode || ""
  });
});

data.edges.forEach((e) => {
  // Avoid duplicates (undirected-like)
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

// ---- Hover: highlight neighbors ----
renderer.on("enterNode", ({ node }) => {
  const neighbors = new Set(graph.neighbors(node));
  neighbors.add(node);

  graph.forEachNode((n) => graph.setNodeAttribute(n, "hidden", !neighbors.has(n)));
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

// ---- Subtle autopan ----
let t = 0;
function animate() {
  t += 0.0025;
  const cam = renderer.getCamera();
  const state = cam.getState();
  cam.setState(
    { angle: 0, ratio: state.ratio, x: Math.sin(t) * 0.03, y: Math.cos(t) * 0.03 },
    { duration: 80 }
  );
  requestAnimationFrame(animate);
}
animate();
