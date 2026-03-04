// assets/js/network.js — v2.1 (vis-network)
// Cleaner visuals: faint edges by default, highlight on hover, hide woreda labels
console.log("NETWORK GRAPH VERSION v2.1 (vis-network)");

function colorByCategory(cat) {
  if (cat === "org") return "rgba(80,170,255,0.92)";
  if (cat === "activity") return "rgba(110,230,160,0.92)";
  return "rgba(255,120,120,0.92)";
}

(async function main() {
  const container = document.getElementById("network");
  if (!container) return;

  const res = await fetch("data/network_4w_demo.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load JSON");
  const data = await res.json();

  // --- Nodes ---
  const nodes = data.nodes.map((n) => {
    const cat = n.type || "woreda";

    return {
      id: n.id,

      // Hide woreda labels by default (massive readability win)
      label: cat === "woreda" ? "" : (n.label || n.id),

      group: cat,
      value: n.size || 8,

      color: {
        background: colorByCategory(cat),
        border: "rgba(255,255,255,0.35)",
        highlight: {
          background: colorByCategory(cat),
          border: "rgba(255,255,255,0.85)"
        },
        hover: {
          background: colorByCategory(cat),
          border: "rgba(255,255,255,0.85)"
        }
      },

      font: { color: "rgba(255,255,255,0.85)", size: 12 }
    };
  });

  // --- Edges ---
  // IMPORTANT: we add explicit ids so we can update them on hover
  const edges = data.edges.map((e, i) => ({
    id: e.id || `edge_${i}`,
    from: e.source,
    to: e.target,
    width: 1,

    // faint by default
    color: { color: "rgba(255,255,255,0.03)" },

    smooth: { type: "continuous" }
  }));

  const visNodes = new vis.DataSet(nodes);
  const visEdges = new vis.DataSet(edges);

  const options = {
    autoResize: true,

    interaction: {
      hover: true,
      tooltipDelay: 120,
      hideEdgesOnDrag: true
    },

    physics: { enabled: false },

    layout: {
      improvedLayout: false
    },

    groups: {
      org: { shape: "dot" },
      activity: { shape: "dot" },
      woreda: { shape: "dot" }
    }
  };

  const network = new vis.Network(container, { nodes: visNodes, edges: visEdges }, options);

  // --- Layered layout: org -> activity -> woreda ---
  const orgs = nodes.filter((n) => n.group === "org").map((n) => n.id).sort();
  const acts = nodes.filter((n) => n.group === "activity").map((n) => n.id).sort();
  const wors = nodes.filter((n) => n.group === "woreda").map((n) => n.id).sort();

  function setColumn(ids, x, spacing) {
    ids.forEach((id, i) => {
      const y = (i - ids.length / 2) * spacing;
      network.moveNode(id, x, y);
      visNodes.update({ id, fixed: { x: true, y: true } });
    });
  }

  setColumn(orgs, -650, 55);
  setColumn(acts, 0, 75);
  setColumn(wors, 650, 30);

  // Fit nicely
  network.fit({ animation: { duration: 500, easingFunction: "easeInOutQuad" } });

  // --- Hover highlight edges ---
  function setAllEdges(alpha) {
    const col = `rgba(255,255,255,${alpha})`;
    const updates = [];
    visEdges.forEach((edge) => {
      updates.push({ id: edge.id, color: { color: col } });
    });
    visEdges.update(updates);
  }

  // default faint edges
  setAllEdges(0.03);

  network.on("hoverNode", function (params) {
    const connected = network.getConnectedEdges(params.node);

    // dim all first
    setAllEdges(0.02);

    // highlight connected
    const updates = connected.map((edgeId) => ({
      id: edgeId,
      color: { color: "rgba(255,255,255,0.45)" }
    }));
    visEdges.update(updates);
  });

  network.on("blurNode", function () {
    setAllEdges(0.03);
  });

  console.log("vis-network ready v2.1");
})();
