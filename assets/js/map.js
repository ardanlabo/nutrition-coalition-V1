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
let adm3Layer = null;
let circlesLayer = L.layerGroup().addTo(map);
let adm1Layer = null;
let adm2Layer = null;
let legendControl = null;

const ui = {
  metric: document.getElementById('metric'),
  region: document.getElementById('region'),
  zone: document.getElementById('zone'),
  showCircles: document.getElementById('showCircles'),
  stats: document.getElementById('stats')
};

const state = {
  metric: "nosupport",
  region: "",
  zone: "",
  showCircles: true
};

// -------------------------
// Helpers
// -------------------------
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

function safeNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// -------------------------
// ADM3 styling
// -------------------------
function styleAdm3(feature) {
  const pcode = (feature?.properties?.adm3_pcode || "").trim();
  const row = dataByPcode[pcode];

  if (!row || !passesFilter(row)) {
    return { fillOpacity: 0, weight: 0.5, color: "#777" };
  }

  const { lmri, n } = getMetricFields();
  const v = safeNum(row[lmri]) ?? 0;

  const nVal = safeNum(row[n]) ?? 0;
  const lowN = (safeNum(row.LowN_Flag) === 1) || (nVal > 0 && nVal < 5);
  const opacity = lowN ? 0.30 : 0.70;

  return {
    fillColor: getColor(v),
    weight: 0.7,
    color: "#333",
    fillOpacity: opacity
  };
}

function onEachAdm3(feature, layer) {
  const pcode = (feature?.properties?.adm3_pcode || "").trim();
  const row = dataByPcode[pcode];
  if (!row) return;

  layer.on('mouseover', () => layer.setStyle({ weight: 1.2 }));
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
// Circles
// -------------------------
function circleRadius(hr) {
  const x = Math.max(0, Number(hr) || 0);
  return 2500 * Math.sqrt(x);
}

function rebuildCircles() {
  circlesLayer.clearLayers();
  if (!state.showCircles || !adm3Layer) return;

  const { hr } = getMetricFields();

  adm3Layer.eachLayer(layer => {
    const pcode = (layer.feature?.properties?.adm3_pcode || "").trim();
    const row = dataByPcode[pcode];
    if (!row || !passesFilter(row)) return;

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
    if (!row || !passesFilter(row)) return;
    bounds.extend(layer.getBounds());
    has = true;
  });

  if (has && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [20, 20] });
  }
}

// -------------------------
// ADM1 / ADM2
// -------------------------
function styleAdm1() {
  return {
    fillOpacity: 0,
    weight: 2.6,
    color: "#C00000"
  };
}

function styleAdm2() {
  return {
    fillOpacity: 0,
    weight: 2.0,
    color: "#111"
  };
}

function updateAdm2Visibility() {
  if (!adm2Layer) return;
  const shouldShow = Boolean(state.region);
  const isShown = map.hasLayer(adm2Layer);

  if (shouldShow && !isShown) adm2Layer.addTo(map);
  if (!shouldShow && isShown) map.removeLayer(adm2Layer);
}

// -------------------------
// Apply changes
// -------------------------
function applyAll() {
  if (adm3Layer) adm3Layer.setStyle(styleAdm3);
  updateAdm2Visibility();
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
  fetch('data/adm3_ethiopia.geojson').then(r => r.json()),
  fetch('data/lmri_woreda_t2_pcode.csv').then(r => r.text())
    .then(txt => Papa.parse(txt, { header: true, skipEmptyLines: true }).data)
]).then(([adm3, csvData]) => {

  csvData.forEach(row => {
    const p = (row.adm3_pcode || "").trim();
    if (p) dataByPcode[p] = row;
  });

  adm3Layer = L.geoJSON(adm3, { style: styleAdm3, onEachFeature: onEachAdm3 }).addTo(map);
  map.fitBounds(adm3Layer.getBounds());

}).catch(err => {
  console.error(err);
  alert(err.message);
});
