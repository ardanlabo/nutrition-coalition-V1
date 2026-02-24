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
// State + UI
// -------------------------
let dataByPcode = {};

let adm3Layer = null;          // Choropleth layer (woreda)
let circlesLayer = L.layerGroup().addTo(map);

let adm1Layer = null;          // Regions outline (red)
let adm2Layer = null;          // Zones outline (grey)

let adm1Geo = null;            // Stored GeoJSON for rebuild
let adm2Geo = null;

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
// Tooltip builder (always works)
// -------------------------
function buildTooltipHTML(row) {
  const { lmri, n, hr } = getMetricFields();

  const lmriVal = safeNum(row[lmri]);
  const nVal = safeNum(row[n]);
  const hrVal = safeNum(row[hr]);

  return `
    <b>${row.Woreda}</b><br>
    Region: ${row.Region}<br>
    Zone: ${row.Zone}<br>
    P-code: ${row.adm3_pcode}<br>
    LMRI: ${lmriVal === null ? "—" : (lmriVal * 100).toFixed(1) + "%"}<br>
    Facilities: ${nVal === null ? "—" : nVal}<br>
    HR count: ${hrVal === null ? "—" : hrVal}<br>
    ${(safeNum(row.LowN_Flag) === 1) ? "<i>Low N caution</i>" : ""}
  `;
}

// -------------------------
// ADM3 (woreda) styling
// Colors: based on LMRI
// Borders:
// - National view: thin dark grey
// - Region selected: black and stronger
// Visibility:
// - If region selected, hide everything outside region
// - If zone selected, hide everything outside zone
// - If no data row, hide completely (clean map)
// -------------------------
function styleAdm3(feature) {
  const pcode = (feature?.properties?.adm3_pcode || "").trim();
  const row = dataByPcode[pcode];

  // Clean map: hide polygons without data row
  if (!row) return { fillOpacity: 0, weight: 0 };

  // Drill-down: hide other regions when region selected
  if (state.region && row.Region !== state.region) {
    return { fillOpacity: 0, weight: 0 };
  }

  // Drill-down: hide other zones when zone selected
  if (state.zone && row.Zone !== state.zone) {
    return { fillOpacity: 0, weight: 0 };
  }

  const { lmri, n } = getMetricFields();
  const v = safeNum(row[lmri]) ?? 0;

  const nVal = safeNum(row[n]) ?? 0;
  const lowN = (safeNum(row.LowN_Flag) === 1) || (nVal > 0 && nVal < 5);
  const opacity = lowN ? 0.30 : 0.70;

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

  // Bind tooltip once (empty), then update content on hover (stable)
  layer.bindTooltip("", { sticky: true, direction: "auto", opacity: 0.95 });

  layer.on("mouseover", () => {
    // only show tooltip if polygon is currently visible under filters
    if (!passesFilter(row)) {
      layer.closeTooltip();
      return;
    }
    layer.setTooltipContent(buildTooltipHTML(row));
    layer.openTooltip();
    layer.setStyle({ weight: state.region ? 1.4 : 0.8 });
  });

  layer.on("mouseout", () => {
    if (adm3Layer) adm3Layer.resetStyle(layer);
  });
}

// -------------------------
// Circles (HR volume)
// Only for visible features (filters applied)
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
// ADM1 / ADM2 overlays rebuild
// Colors required:
// - ADM1 red always, but ONLY selected region when region filter active
// - ADM2 grey only when region selected (and only inside that region)
// -------------------------
function styleAdm1() {
  return { fillOpacity: 0, weight: 2.6, color: "#C00000" }; // red
}
function styleAdm2() {
  return { fillOpacity: 0, weight: 1.6, color: "#888" }; // grey
}

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
  if (adm1Layer && map.hasLayer(adm1Layer)) map.removeLayer(adm1Layer);
  if (adm2Layer && map.hasLayer(adm2Layer)) map.removeLayer(adm2Layer);

  if (adm1Geo) {
    adm1Layer = L.geoJSON(adm1Geo, {
      filter: f => (state.region ? regionMatch(f.properties) : true),
      style: styleAdm1
    }).addTo(map);
  }

  if (adm2Geo && state.region) {
    adm2Layer = L.geoJSON(adm2Geo, {
      filter: f => regionMatch(f.properties),
      style: styleAdm2
    }).addTo(map);
  } else {
    adm2Layer = null;
  }
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
// Apply all changes
// -------------------------
function applyAll() {
  if (adm3Layer) adm3Layer.setStyle(styleAdm3);
  rebuildAdminOverlays();
  rebuildCircles();
  updateStats();
  fitToSelection();
}

// -------------------------
// UI events
// -------------------------
ui.metric.addEventListener("change", () => {
  state.metric = ui.metric.value;
  // tooltips auto-refresh on hover because we rebuild content on mouseover
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

  // ADM3 choropleth
  adm3Layer = L.geoJSON(adm3Geo, { style: styleAdm3, onEachFeature: onEachAdm3 }).addTo(map);

  // Filters
  populateRegions();

  // Overlays (ADM1 red always; ADM2 grey only when region selected)
  rebuildAdminOverlays();

  // Initial view
  updateStats();
  map.fitBounds(adm3Layer.getBounds(), { padding: [10, 10] });
  rebuildCircles();

}).catch(err => {
  console.error(err);
  alert(err.message);
});
