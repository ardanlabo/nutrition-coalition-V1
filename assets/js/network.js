// assets/js/network.js — v2.2
console.log("NETWORK GRAPH VERSION v2.2");

function colorByCategory(cat) {
  if (cat === "org") return "rgba(80,170,255,0.95)";
  if (cat === "activity") return "rgba(110,230,160,0.95)";
  return "rgba(255,120,120,0.75)";
}

(async function main() {

  const container = document.getElementById("network");
  if (!container) return;

  const res = await fetch("data/network_4w_demo.json",{cache:"no-store"});
  const data = await res.json();

  const nodes = data.nodes.map(n => {

    const cat = n.type || "woreda";

    return {

      id: n.id,

      // ONLY label NGO + Activity
      label: cat === "woreda" ? "" : (n.label || n.id),

      title: n.label || n.id, // hover tooltip

      group: cat,

      value: cat === "woreda" ? 3 : (n.size || 8),

      color:{
        background: colorByCategory(cat),
        border:"rgba(255,255,255,0.35)"
      },

      font:{color:"rgba(255,255,255,0.9)",size:12}

    };

  });

  const edges = data.edges.map((e,i)=>({

    id:e.id || "edge_"+i,
    from:e.source,
    to:e.target,

    width:1,

    color:{color:"rgba(255,255,255,0.02)"},

    smooth:{type:"continuous"}

  }));

  const visNodes = new vis.DataSet(nodes);
  const visEdges = new vis.DataSet(edges);

  const options = {

    autoResize:true,

    interaction:{
      hover:true,
      tooltipDelay:120,
      hideEdgesOnDrag:true
    },

    physics:{enabled:false},

    layout:{improvedLayout:false},

    groups:{
      org:{shape:"dot",size:18},
      activity:{shape:"dot",size:16},
      woreda:{shape:"dot",size:5}
    }

  };

  const network = new vis.Network(container,{nodes:visNodes,edges:visEdges},options);

  // LAYERED LAYOUT

  const orgs = nodes.filter(n=>n.group==="org").map(n=>n.id).sort();
  const acts = nodes.filter(n=>n.group==="activity").map(n=>n.id).sort();
  const wors = nodes.filter(n=>n.group==="woreda").map(n=>n.id).sort();

  function setColumn(ids,x,spacing){

    ids.forEach((id,i)=>{

      const y=(i-ids.length/2)*spacing;

      network.moveNode(id,x,y);

      visNodes.update({id,fixed:{x:true,y:true}});

    });

  }

  setColumn(orgs,-650,60);
  setColumn(acts,0,80);
  setColumn(wors,650,30);

  network.fit({animation:{duration:500}});

  // EDGE HIGHLIGHT

  function dimEdges(alpha){

    visEdges.forEach(e=>{
      visEdges.update({id:e.id,color:{color:"rgba(255,255,255,"+alpha+")"}});
    });

  }

  dimEdges(0.02);

  network.on("hoverNode",params=>{

    const connected = network.getConnectedEdges(params.node);

    dimEdges(0.01);

    connected.forEach(edge=>{
      visEdges.update({
        id:edge,
        color:{color:"rgba(255,255,255,0.5)"}
      });
    });

  });

  network.on("blurNode",()=>{

    dimEdges(0.02);

  });

})();
