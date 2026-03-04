// assets/js/network.js
// Version UMD compatible with sigma + graphology CDN

function runSimpleForceLayout(graph, iterations = 240) {
  const nodes = graph.nodes();

  // init positions
  nodes.forEach((n) => {
    const a = graph.getNodeAttributes(n);
    if (typeof a.x !== "number") graph.setNodeAttribute(n, "x", (Math.random() - 0.5) * 10);
    if (typeof a.y !== "number") graph.setNodeAttribute(n, "y", (Math.random() - 0.5) * 10);
  });

  const repulsion = 0.02;
  const attraction = 0.01;
  const damping = 0.85;

  const vx = {};
  const vy = {};
  nodes.forEach((n) => {
    vx[n] = 0;
    vy[n] = 0;
  });

  for (let it = 0; it < iterations; it++) {

    // repulsion
    for (let i = 0; i < nodes.length; i++) {
      const ni = nodes[i];
      const xi = graph.getNodeAttribute(ni, "x");
      const yi = graph.getNodeAttribute(ni, "y");

      for (let j = i + 1; j < nodes.length; j++) {
        const nj = nodes[j];
        const xj = graph.getNodeAttribute(nj, "x");
        const yj = graph.getNodeAttribute(nj, "y");

        let dx = xi - xj;
        let dy = yi - yj;
        let d2 = dx * dx + dy * dy + 0.01;

        let f = repulsion / d2;

        vx[ni] += dx * f;
        vy[ni] += dy * f;
        vx[nj] -= dx * f;
        vy[nj] -= dy * f;
      }
    }

    // attraction along edges
    graph.forEachEdge((e, attr, s, t) => {
      const xs = graph.getNodeAttribute(s, "x");
      const ys = graph.getNodeAttribute(s, "y");
      const xt = graph.getNodeAttribute(t, "x");
      const yt = graph.getNodeAttribute(t, "y");

      const dx = xt - xs;
      const dy = yt - ys;

      vx[s] += dx * attraction;
      vy[s] += dy * attraction;
      vx[t] -= dx * attraction;
      vy[t] -= dy * attraction;
    });

    // integrate
    nodes.forEach((n) => {
      let x = graph.getNodeAttribute(n, "x");
      let y = graph.getNodeAttribute(n, "y");

      vx[n] *= damping;
      vy[n] *= damping;

      x += vx[n];
      y += vy[n];

      graph.setNodeAttribute(n, "x", x);
      graph.setNodeAttribute(n, "y", y);
    });
  }
}

function colorByType(t) {
  if (t === "org") return "rgba(80,170,255,0.95)";
  if (t === "activity") return "rgba(110,230,160,0.95)";
  return "rgba(255,120,120,0.95)";
}

function edgeColorByType(t) {
  if (t === "org_activity") return "rgba(255,255,255,0.22)";
  return "rgba(255,255,255,0.14)";
}

(async function main() {

  const container = document.getElementById("network");
  if (!container) {
    console.error("Network container not found");
    return;
  }

  const res = await fetch("data/network_4w_demo.json", { cache: "no-store" });

  if (!res.ok) {
    console.error("Failed to load JSON");
    return;
  }

  const data = await res.json();

  // Graphology global (UMD)
  const graph = new graphology.Graph();

  data.nodes.forEach((n) => {

    graph.addNode(n.id, {
      label: n.label || n.id,
      size: n.size || 8,
      color: colorByType(n.type),

      // IMPORTANT: we store category, NOT type
      category: n.type,

      x: (Math.random() - 0.5) * 10,
      y: (Math.random() - 0.5) * 10
    });

  });

  data.edges.forEach((e, i) => {

    const edgeId = e.id || "e" + i;

    if (!graph.hasEdge(e.source, e.target) && !graph.hasEdge(e.target, e.source)) {

      graph.addEdgeWithKey(edgeId, e.source, e.target, {
        size: 1,
        color: edgeColorByType(e.type)
      });

    }

  });

  // Layout
  runSimpleForceLayout(graph, 220);

  // Sigma global (UMD)
  const renderer = new Sigma(graph, container);

  // Subtle camera animation
  let t = 0;

  function animate() {

    t += 0.0025;

    const cam = renderer.getCamera();
    const state = cam.getState();

    cam.setState({
      angle: 0,
      ratio: state.ratio,
      x: Math.sin(t) * 0.03,
      y: Math.cos(t) * 0.03
    }, { duration: 80 });

    requestAnimationFrame(animate);
  }

  animate();

})();
