// assets/js/network.js (UMD, stable, drag-friendly, readable)

console.log("NETWORK.JS LOADED v5");

function runSimpleForceLayout(graph, iterations = 220) {
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
    // repulsion (O(n^2) OK for ~100 nodes)
    for (let i = 0; i < nodes.length; i++) {
      const ni = nodes[i];
      const xi = graph.getNodeAttribute(ni, "x");
      const yi = graph.getNodeAttribute(ni, "y");

      for (let j = i + 1; j < nodes.length; j++) {
        const nj = nodes[j];
        const xj = graph.getNodeAttribute(nj, "x");
        const yj = graph.getNodeAttribute(nj, "y");

        const dx = xi - xj;
        const dy = yi - yj;
        const d2 = dx * dx + dy * dy + 0.01;

        const f = repulsion / d2;

        vx[ni] += dx * f;
        vy[ni] += dy * f;
        vx[nj] -= dx * f;
        vy[nj] -= dy * f;
      }
    }

    // attraction on edges
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

function nodeFill(category) {
  if (category === "org") return "rgba(80,170,255,0.92)";
  if (category === "activity") return "rgba(110,230,160,0.92)";
  return "rgba(255,120,120,0.92)"; // woreda
}

function edgeStroke(edgeType) {
  if (edgeType === "org_activity") return "rgba(255,255,255,0.22)";
  return "rgba(255,255,255,0.12)";
}

(async function main() {
  const container = document.getElementById("network");
  if (!container) {
    console.error("Missing #network container");
    return;
  }

  // Load data
  const res = await fetch("data/network_4w_demo.json", { cache: "no-store" });
  if (!res.ok) {
    console.error("Failed to load data/network_4w_demo.json", res.status);
    return;
  }
  const data = await res.json();

  // Build graph
  const graph = new graphology.Graph();

  data.nodes.forEach((n) => {
    const category = n.type || "woreda"; // org/activity/woreda from JSON

    graph.addNode(n.id, {
      label: n.label || n.id,

      // Sigma program type MUST be a valid sigma node program:
      type: "circle",

      // Our domain category:
      category,

      // Visuals:
      color: nodeFill(category),
      size: n.size || 8,

      // Layout init:
      x: (Math.random() - 0.5) * 10,
      y: (Math.random() - 0.5) * 10,

      // keep original metadata if needed later
      Region: n.Region || "",
      Zone: n.Zone || "",
      adm3_pcode: n.adm3_pcode || "",

      // label control:
      labelColor: "rgba(255,255,255,0.85)",
      labelSize: 10
    });
  });

  data.edges.forEach((e, i) => {
    const edgeId = e.id || `e_${i}`;
    if (!graph.hasEdge(e.source, e.target) && !graph.hasEdge(e.target, e.source)) {
      graph.addEdgeWithKey(edgeId, e.source, e.target, {
        type: e.type || "link",
        color: edgeStroke(e.type),
        size: 1
      });
    }
  });

  // Layout (static positions computed once)
  runSimpleForceLayout(graph, 220);

  // Renderer
  const renderer = new Sigma(graph, container, {
    renderEdgeLabels: false,
    // keep labels off by default (we'll show them based on zoom)
    labelRenderedSizeThreshold: 9999
  });

  // Camera defaults (drag/pan enabled by default in sigma)
  renderer.getCamera().setState({ ratio: 1 });

  // --- Better readability: hover highlight neighbors ---
  const dimNode = "rgba(255,255,255,0.10)";
  const dimEdge = "rgba(255,255,255,0.03)";

  // store originals
  graph.forEachNode((n, attrs) => {
    graph.setNodeAttribute(n, "origColor", attrs.color);
  });
  graph.forEachEdge((e, attrs) => {
    graph.setEdgeAttribute(e, "origColor", attrs.color);
  });

  function resetStyles() {
    graph.forEachNode((n) => {
      graph.setNodeAttribute(n, "color", graph.getNodeAttribute(n, "origColor"));
    });
    graph.forEachEdge((e) => {
      graph.setEdgeAttribute(e, "color", graph.getEdgeAttribute(e, "origColor"));
    });
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

  // --- Labels only when zoomed in (otherwise illegible) ---
  function updateLabelThreshold() {
    const ratio = renderer.getCamera().getState().ratio;
    // smaller ratio = zoomed in
    // when zoomed in, allow labels; when zoomed out, hide
    const threshold = ratio < 1.2 ? 0 : 9999;
    renderer.setSetting("labelRenderedSizeThreshold", threshold);
  }

  renderer.getCamera().on("updated", updateLabelThreshold);
  updateLabelThreshold();

  console.log("Network graph ready.");
})();
