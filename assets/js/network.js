// assets/js/network.js — v2.0 (vis-network, robust)
console.log("NETWORK GRAPH VERSION v2.0 (vis-network)");

function colorByCategory(cat){
  if (cat === "org") return "rgba(80,170,255,0.92)";
  if (cat === "activity") return "rgba(110,230,160,0.92)";
  return "rgba(255,120,120,0.92)";
}

(async function main(){
  const container = document.getElementById("network");
  if (!container) return;

  const res = await fetch("data/network_4w_demo.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load JSON");
  const data = await res.json();

  // Convert nodes
  const nodes = data.nodes.map((n) => {
    const cat = n.type || "woreda";
    return {
      id: n.id,
      label: n.label || n.id,
      group: cat,
      value: n.size || 8,
      color: {
        background: colorByCategory(cat),
        border: "rgba(255,255,255,0.35)",
        highlight: {
          background: colorByCategory(cat),
          border: "rgba(255,255,255,0.8)"
        },
        hover: {
          background: colorByCategory(cat),
          border: "rgba(255,255,255,0.8)"
        }
      },
      font: { color: "rgba(255,255,255,0.85)", size: 12 },
    };
  });

  // Convert edges
  const edges = data.edges.map((e) => ({
    from: e.source,
    to: e.target,
    color: { color: "rgba(255,255,255,0.12)", highlight: "rgba(255,255,255,0.35)" },
    width: 1,
    smooth: { type: "continuous" }  // curves => prettier
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
    physics: {
      enabled: false // IMPORTANT: we do a clean layered layout instead of chaotic physics
    },
    layout: {
      improvedLayout: true
    },
    groups: {
      org: { shape: "dot" },
      activity: { shape: "dot" },
      woreda: { shape: "dot" }
    }
  };

  const network = new vis.Network(container, { nodes: visNodes, edges: visEdges }, options);

  // Layered layout: org -> activity -> woreda
  const orgs = nodes.filter(n => n.group === "org").map(n => n.id).sort();
  const acts = nodes.filter(n => n.group === "activity").map(n => n.id).sort();
  const wors = nodes.filter(n => n.group === "woreda").map(n => n.id).sort();

  function setColumn(ids, x, spacing){
    ids.forEach((id, i) => {
      const y = (i - ids.length/2) * spacing;
      network.moveNode(id, x, y);
    });
  }

  // columns
  setColumn(orgs, -600, 50);
  setColumn(acts, 0, 70);
  setColumn(wors, 600, 28);

  // Fit nicely
  network.fit({ animation: { duration: 600, easingFunction: "easeInOutQuad" } });

  console.log("vis-network ready v2.0");
})();
