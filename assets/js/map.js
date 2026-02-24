// -------------------------
// Base map
// -------------------------
const map = L.map('map', {
  preferCanvas: true,
  scrollWheelZoom: false,
  doubleClickZoom: false,
  touchZoom: false
}).setView([9, 40], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// -------------------------
// Panes (deterministic z-order + pointer-events control)
// -------------------------
map.createPane("adm3Pane");
map.getPane("adm3Pane").style.zIndex = 400;
map.getPane("adm3Pane").style.pointerEvents = "auto"; // allow hover on woredas

map.createPane("adm2Pane");
map.getPane("adm2Pane").style.zIndex = 500;
map.getPane("adm2Pane").style.pointerEvents = "none"; // never block hover

map.createPane("adm1Pane");
map.getPane("adm1Pane").style.zIndex = 600;
map.getPane("adm1Pane").style.pointerEvents = "none"; // never block hover

// -------------------------
// State + UI
// -------------------------
let dataByPcode = {};

let adm3Layer = null;          // choropleth (woreda)
let circlesLayer = L.layerGroup().addTo(map);

let adm1HaloLayer = null;      // white halo
let adm1RedLayer = null;       // red region outline
let adm2Layer = null;          // grey zone outline

let adm1Geo = null;
let adm2Geo = null;

// Legend
let legendControl = null;

const ui = {
  metric: document.getElementById('metric'),
  region: document.getElementById('region'),
  zone: document.getElementById('zone'),
  showCircles: document.getElementById('showCircles'),
  stats: document.getElementById('stats')
};

const state = {
  metric: "nosupport", // "nosupport" | "support"
  region: "",
  zone: "",
  showCircles: true
};

// -------------------------
// Helpers
// -------------------------
function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function getMetricFields() {
  if (state.metric === "support") {
    return { lmri: "LMRI_Support", n: "Facilities_Support", hr: "HR_Support" };
  }
  return { lmri: "LMRI_NoSupport", n: "Facilities_NoSupport", hr: "HR_NoSupport" };
}

function passesFilter(row) {
  if (!row) return false;
  if (state.region && row.Region !== state.region) return false;
  if (state.zone && row.Zone !== state.zone) return false;
  return true;
}

function getColor(v) {
  if (v >= 0.5) return "#800026";
  if (v >= 0.3) return "#BD0026";
  if (v >= 0.2) return "#E31A1C";
  if (v >= 0.1) return "#FC4E2A";
  if (v > 0)   return "#FD8D3C";
  return "#FFEDA0";
}

// -------------------------
// Tooltip builder (full info)
// -------------------------
function buildTooltipHTML(row) {
  const { lmri, n, hr } = getMetricFields();
  const lmriVal = safeNum(row[lmri]);
  const nVal = safeNum(row[n]);
  const hrVal = safeNum(row[hr]);

  const deltaVal = safeNum(row.Delta);
  const lmriSupport = safeNum(row.LMRI_Support);
  const lmriNoSupport = safeNum(row.LMRI_NoSupport);

  return `
    <b>${row.Woreda}</b><br>
    Region: ${row.Region}<br>
    Zone: ${row.Zone}<br>
    P-code: ${row.adm3_pcode}<br>
    <hr style="margin:6px 0;border:none;border-top:1px solid #eee;">
    <b>Selected metric</b><br>
    LMRI: ${lmriVal === null ? "—" : (lmriVal * 100).toFixed(1) + "%"}<br>
    Facilities: ${nVal === null ? "—" : nVal}<br>
    HR count: ${hrVal === null ? "—" : hrVal}<br>
    <hr style="margin:6px 0;border:none;border-top:1px solid #eee;">
    <b>Comparison</b><br>
    LMRI (No support): ${lmriNoSupport === null ? "—" : (lmriNoSupport * 100).toFixed(1) + "%"}<br>
    LMRI (Support): ${lmriSupport === null ? "—" : (lmriSupport * 100).toFixed(1) + "%"}<br>
    Delta (Sup - NoSup): ${deltaVal === null ? "—" : (deltaVal * 100).toFixed(1) + "%"}<br>
    ${(safeNum(row.LowN_Flag) === 1) ? "<br><i>Low N caution (opacity reduced)</i>" : ""}
  `;
}

// -------------------------
// ADM3 (woreda) style
// -------------------------
function styleAdm3(feature) {
  const pcode = (feature?.properties?.adm3_pcode || "").trim();
  const row = dataByPcode[pcode];

  // Hide polygons without data (clean map)
  if (!row) return { fillOpacity: 0, weight: 0 };

  // Drill-down: hide outside selected region/zone
  if (state.region && row.Region !== state.region) return { fillOpacity: 0, weight: 0 };
  if (state.zone && row.Zone !== state.zone) return { fillOpacity: 0, weight: 0 };

  const { lmri, n } = getMetricFields();
  const v = safeNum(row[lmri]) ?? 0;

  const nVal = safeNum(row[n]) ?? 0;
  const lowN = (safeNum(row.LowN_Flag) === 1) || (nVal > 0 && nVal < 5);
  const opacity = lowN ? 0.30 : 0.70;

  // Borders: black when region selected, subtle when national
  const borderColor = state.region ? "#000" : "#444";
  const borderWeight = state.region ? 0.9 : 0.35;

  return {
    fillColor: getColor(v),
    color: borderColor,
    weight: borderWeight,
    fillOpacity: opacity
  };
}

function onEachAdm3(feature, layer) {
  const pcode = (feature?.properties?.adm3_pcode || "").trim();
  const row = dataByPcode[pcode];
  if (!row) return;

  // Native Leaflet tooltip on polygons
  layer.bindTooltip(buildTooltipHTML(row), {
    sticky: true,
    direction: "auto",
    opacity: 0.95
  });

  // highlight on hover + refresh tooltip content (if metric changes)
  layer.on("mouseover", () => {
    if (!passesFilter(row)) return;
    layer.setTooltipContent(buildTooltipHTML(row));
    layer.setStyle({ weight: state.region ? 1.4 : 0.8 });
  });

  layer.on("mouseout", () => {
    if (adm3Layer) adm3Layer.resetStyle(layer);
  });
}

// -------------------------
// Circles (HR volume)
// -------------------------
function circleRadius(hr) {
  const x = Math.max(0, Number(hr) || 0);
  return 2500 * Math.sqrt(x); // meters
}

function rebuildCircles() {
  circlesLayer.clearLayers();
  if (!state.showCircles || !adm3Layer) return;

  const { hr } = getMetricFields();

  adm3Layer.eachLayer(layer => {
    const pcode = (layer.feature?.properties?.adm3_pcode || "").trim();
    const row = dataByPcode[pcode];
    if (!row) return;
    if (!passesFilter(row)) return;

    const hrVal = safeNum(row[hr]);
    if (!hrVal || hrVal <= 0) return;

    const center = layer.getBounds().getCenter();
    const marker = L.circle(center, {
      radius: circleRadius(hrVal),
      weight: 1,
      color: "#111",
      fillOpacity: 0.15
    });

    marker.bindTooltip(`<b>${row.Woreda}</b><br>HR: ${hrVal}`, { sticky: true });
    circlesLayer.addLayer(marker);
  });
}

// -------------------------
// Stats + FitBounds
// -------------------------
function updateStats() {
  const { n, hr } = getMetricFields();
  let totalN = 0;
  let totalHR = 0;
  let shown = 0;

  Object.values(dataByPcode).forEach(row => {
    if (!passesFilter(row)) return;
    shown++;
    totalN += Number(row[n]) || 0;
    totalHR += Number(row[hr]) || 0;
  });

  ui.stats.innerHTML = `
    <b>Visible woredas:</b> ${shown}<br>
    <b>Total facilities:</b> ${totalN}<br>
    <b>Total HR:</b> ${totalHR}
  `;
}

function fitToSelection() {
  if (!adm3Layer) return;

  const bounds = L.latLngBounds([]);
  let has = false;

  adm3Layer.eachLayer(layer => {
    const pcode = (layer.feature?.properties?.adm3_pcode || "").trim();
    const row = dataByPcode[pcode];
    if (!row) return;
    if (!passesFilter(row)) return;

    bounds.extend(layer.getBounds());
    has = true;
  });

  if (has && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [20, 20] });
  }
}

// -------------------------
// ADM1 / ADM2 overlays
// -------------------------
function styleAdm1Halo() { return { fillOpacity: 0, weight: 6.0, color: "#FFFFFF" }; }
function styleAdm1Red()  { return { fillOpacity: 0, weight: 2.8, color: "#C00000" }; }
function styleAdm2Grey() { return { fillOpacity: 0, weight: 1.6, color: "#888" }; }

function regionMatch(props) {
  const r = state.region;
  if (!r) return true;

  const cand =
    props?.adm1_name ||
    props?.ADM1_EN ||
    props?.admin1Name ||
    props?.NAME_1 ||
    props?.REGION ||
    "";

  return String(cand).trim() === r;
}

function rebuildAdminOverlays() {
  if (adm1HaloLayer && map.hasLayer(adm1HaloLayer)) map.removeLayer(adm1HaloLayer);
  if (adm1RedLayer && map.hasLayer(adm1RedLayer)) map.removeLayer(adm1RedLayer);
  if (adm2Layer && map.hasLayer(adm2Layer)) map.removeLayer(adm2Layer);

  if (adm1Geo) {
    const filterFn = f => (state.region ? regionMatch(f.properties) : true);

    adm1HaloLayer = L.geoJSON(adm1Geo, {
      pane: "adm1Pane",
      interactive: false,
      filter: filterFn,
      style: styleAdm1Halo
    }).addTo(map);

    adm1RedLayer = L.geoJSON(adm1Geo, {
      pane: "adm1Pane",
      interactive: false,
      filter: filterFn,
      style: styleAdm1Red
    }).addTo(map);
  }

  if (adm2Geo && state.region) {
    adm2Layer = L.geoJSON(adm2Geo, {
      pane: "adm2Pane",
      interactive: false,
      filter: f => regionMatch(f.properties),
      style: styleAdm2Grey
    }).addTo(map);
  } else {
    adm2Layer = null;
  }
}

// -------------------------
// Legend (fixed classes, professional, stable)
// -------------------------
function createLegend() {
  if (legendControl) map.removeControl(legendControl);

  legendControl = L.control({ position: "bottomright" });

  legendControl.onAdd = function () {
    const div = L.DomUtil.create("div", "legend");

    // Inline styles (stable; no dependency)
    div.style.background = "white";
    div.style.padding = "10px 12px";
    div.style.fontSize = "12px";
    div.style.lineHeight = "16px";
    div.style.borderRadius = "8px";
    div.style.boxShadow = "0 2px 10px rgba(0,0,0,0.15)";
    div.style.minWidth = "190px";

    const metricLabel = state.metric === "support"
      ? "LMRI (Supported)"
      : "LMRI (No Support)";

    const row = (color, label) => `
      <div style="display:flex;align-items:center;margin:3px 0;">
        <span style="width:12px;height:12px;background:${color};border:1px solid #999;margin-right:8px;"></span>
        <span>${label}</span>
      </div>
    `;

    div.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;">${metricLabel}</div>
      ${row("#800026", "≥ 50%")}
      ${row("#BD0026", "30–49%")}
      ${row("#E31A1C", "20–29%")}
      ${row("#FC4E2A", "10–19%")}
      ${row("#FD8D3C", "1–9%")}
      ${row("#FFEDA0", "0%")}
      <div style="border-top:1px solid #eee;margin:8px 0;"></div>
      <div>⭕ Circle size = HR count</div>
      <div style="opacity:0.7;">Low N = reduced opacity</div>
    `;

    return div;
  };

  legendControl.addTo(map);
}

// -------------------------
// Filters population
// -------------------------
function populateRegions() {
  const regions = Array.from(new Set(Object.values(dataByPcode).map(r => r.Region))).sort();
  regions.forEach(r => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    ui.region.appendChild(opt);
  });
}

function populateZonesForRegion(region) {
  ui.zone.innerHTML = `<option value="">All</option>`;
  if (!region) {
    ui.zone.disabled = true;
    return;
  }

  const zones = Array.from(new Set(
    Object.values(dataByPcode).filter(r => r.Region === region).map(r => r.Zone)
  )).sort();

  zones.forEach(z => {
    const opt = document.createElement("option");
    opt.value = z;
    opt.textContent = z;
    ui.zone.appendChild(opt);
  });
  ui.zone.disabled = false;
}

// -------------------------
// Apply changes
// -------------------------
function applyAll() {
  if (adm3Layer) adm3Layer.setStyle(styleAdm3);
  rebuildAdminOverlays();
  rebuildCircles();
  updateStats();
  fitToSelection();
  // legend text depends on metric
  createLegend();
}

// -------------------------
// UI events
// -------------------------
ui.metric.addEventListener("change", () => {
  state.metric = ui.metric.value;
  applyAll();
});

ui.region.addEventListener("change", () => {
  state.region = ui.region.value;
  state.zone = "";
  ui.zone.value = "";
  populateZonesForRegion(state.region);
  applyAll();
});

ui.zone.addEventListener("change", () => {
  state.zone = ui.zone.value;
  applyAll();
});

ui.showCircles.addEventListener("change", () => {
  state.showCircles = ui.showCircles.checked;
  rebuildCircles();
});

// -------------------------
// Load data
// -------------------------
Promise.all([
  fetch('data/adm3_ethiopia.geojson').then(r => {
    if (!r.ok) throw new Error("Missing: data/adm3_ethiopia.geojson");
    return r.json();
  }),
  fetch('data/adm1_ethiopia.geojson').then(r => (r.ok ? r.json() : null)),
  fetch('data/adm2_ethiopia.geojson').then(r => (r.ok ? r.json() : null)),
  fetch('data/lmri_woreda_t2_pcode.csv').then(r => {
    if (!r.ok) throw new Error("Missing: data/lmri_woreda_t2_pcode.csv");
    return r.text();
  }).then(txt => Papa.parse(txt, { header: true, skipEmptyLines: true }).data)
]).then(([adm3Geo, a1, a2, csvData]) => {

  adm1Geo = a1;
  adm2Geo = a2;

  csvData.forEach(row => {
    const p = (row.adm3_pcode || "").trim();
    if (p) dataByPcode[p] = row;
  });

  // ADM3 choropleth (interactive)
  adm3Layer = L.geoJSON(adm3Geo, {
    pane: "adm3Pane",
    interactive: true,
    style: styleAdm3,
    onEachFeature: onEachAdm3
  }).addTo(map);

  // Filters
  populateRegions();

  // Overlays + legend
  rebuildAdminOverlays();
  createLegend();

  // Initial view
  updateStats();
  map.fitBounds(adm3Layer.getBounds(), { padding: [10, 10] });
  rebuildCircles();

}).catch(err => {
  console.error(err);
  alert(err.message);
});
