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

let adm1Layer = null;          // Regions outline
let adm2Layer = null;          // Zones outline

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
// ADM3 (woreda) styling
// - national: light boundaries (not too busy)
// - region selected: ONLY selected region visible, boundaries black
// -------------------------
function styleAdm3(feature) {
  const pcode = (feature?.properties?.adm3_pcode || "").trim();
  const row = dataByPcode[pcode];

  // No data row => hide completely (clean map)
  if (!row) return { fillOpacity: 0, weight: 0 };

  // If a region is selected, hide EVERYTHING outside it (no borders, no fill)
  if (state.region && row.Region !== state.region) {
    return { fillOpacity: 0, weight: 0 };
  }

  // If zone selected, hide everything outside that zone too
  if (state.zone && row.Zone !== state.zone) {
    return { fillOpacity: 0, weight: 0 };
  }

  const { lmri, n } = getMetricFields();
  const v = safeNum(row[lmri]) ?? 0;

  const nVal = safeNum(row[n]) ?? 0;
  const lowN = (safeNum(row.LowN_Flag) === 1) || (nVal > 0 && nVal < 5);
  const opacity = lowN ? 0.30 : 0.70;

  // Borders color logic:
  // - If region selected => black borders (woreda)
  // - Else (national) => lighter borders (avoid clutter)
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

  layer.on('mouseover', () => layer.setStyle({ weight: state.region ? 1.4 : 0.8 }));
  layer.on('mouseout', () => adm3Layer && adm3Layer.resetStyle(layer));

  layer.bindTooltip(() => {
    if (!passesFilter(row)) return "";

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
  }, { sticky: true });
}

// -------------------------
// Circles (HR volume)
// Only visible for features currently visible (filters applied)
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

    // Must pass current filters AND be inside selected region if region is set
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
// - National: show ALL ADM1 red
// - Region selected: show ONLY selected ADM1 red, show ADM2 grey (only that region)
// -------------------------
function styleAdm1() {
  return { fillOpacity: 0, weight: 2.6, color: "#C00000" }; // red
}
function styleAdm2() {
  return { fillOpacity: 0, weight: 1.6, color: "#888" }; // grey
}

function regionMatch(props) {
  // We try to match common naming conventions across OCHA layers
  // Prefer adm1_name if present.
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
  // Remove existing layers
  if (adm1Layer && map.hasLayer(adm1Layer)) map.removeLayer(adm1Layer);
  if (adm2Layer && map.hasLayer(adm2Layer)) map.removeLayer(adm2Layer);

  // ADM1: always visible, but filtered to selected region if region is set
  if (adm1Geo) {
    adm1Layer = L.geoJSON(adm1Geo, {
      filter: f => state.region ? regionMatch(f.properties) : true,
      style: styleAdm1
    }).addTo(map);
  }

  // ADM2: ONLY visible when a region is selected; also filtered to that region
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
// Apply changes
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
  fetch('data/adm1_ethiopia.geojson').then(r => r.ok ? r.json() : null),
  fetch('data/adm2_ethiopia.geojson').then(r => r.ok ? r.json() : null),
  fetch('data/lmri_woreda_t2_pcode.csv').then(r => {
    if (!r.ok) throw new Error("Missing: data/lmri_woreda_t2_pcode.csv");
    return r.text();
  }).then(txt => Papa.parse(txt, { header: true, skipEmptyLines: true }).data)
]).then(([adm3Geo, a1, a2, csvData]) => {

  adm1Geo = a1;
  adm2Geo = a2;

  // Build lookup by pcode
  csvData.forEach(row => {
    const p = (row.adm3_pcode || "").trim();
    if (p) dataByPcode[p] = row;
  });

  // Woreda layer
  adm3Layer = L.geoJSON(adm3Geo, { style: styleAdm3, onEachFeature: onEachAdm3 }).addTo(map);

  // Populate filters
  populateRegions();

  // Build overlays + initial view
  rebuildAdminOverlays();
  updateStats();
  map.fitBounds(adm3Layer.getBounds(), { padding: [10, 10] });
  rebuildCircles();

}).catch(err => {
  console.error(err);
  alert(err.message);
});
