// -------------------------
// Base map
// -------------------------
const map = L.map('map', { preferCanvas: true }).setView([9, 40], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// -------------------------
// State + UI
// -------------------------
let dataByPcode = {};
let adm3Layer = null;        // choropleth (woreda)
let circlesLayer = L.layerGroup().addTo(map);
let adm1Layer = null;        // regions outline (always visible)
let adm2Layer = null;        // zones outline (visible only when a region is selected)
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

// Choropleth colors (simple classes; stable for comms)
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
// ADM3 styling + tooltip
// -------------------------
function styleAdm3(feature) {
  const pcode = (feature?.properties?.adm3_pcode || "").trim();
  const row = dataByPcode[pcode];

  // Always show outlines so geography remains readable even if filtered/no data
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
// Circles (HR volume)
// -------------------------
function circleRadius(hr) {
  // sqrt scale; tuned to not explode on Ethiopia view
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

  // If selection yields nothing (e.g., due to unmapped pcodes), don't crash UX
  if (has && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [20, 20] });
  }
}

// -------------------------
// ADM1 / ADM2 styling + visibility rules
// -------------------------
function styleAdm1() {
  // Red borders always visible (national view + regional view)
  return {
    fillOpacity: 0,
    weight: 2.6,
    color: "#C00000"
  };
}

function styleAdm2() {
  // Zones borders: only show when a region filter is selected
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
// Legend
// -------------------------
function buildLegend() {
  if (legendControl) map.removeControl(legendControl);

  legendControl = L.control({ position: "bottomright" });
  legendControl.onAdd = function() {
    const div = L.DomUtil.create("div", "legend");
    const grades = [0, 0.1, 0.2, 0.3, 0.5];
    div.innerHTML += `<b>LMRI</b><br>`;
    for (let i = 0; i < grades.length; i++) {
      const from = grades[i];
      const to = grades[i + 1];
      const label = to ? `${Math.round(from*100)}–${Math.round(to*100)}%` : `≥${Math.round(from*100)}%`;
      div.innerHTML += `
        <div>
          <span class="swatch" style="background:${getColor(from + 0.00001)}"></span>
          ${label}
        </div>
      `;
    }
    div.innerHTML += `<div style="margin-top:6px;"><i>Low N → lower opacity</i></div>`;
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
  buildLegend();
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
// Load: ADM3 + CSV now, ADM1/ADM2 later (no crash if missing)
// -------------------------
Promise.all([
  fetch('data/adm3_ethiopia.geojson').then(r => {
    if (!r.ok) throw new Error("Missing: data/adm3_ethiopia.geojson");
    return r.json();
  }),
  fetch('data/lmri_woreda_t2_pcode.csv').then(r => {
    if (!r.ok) throw new Error("Missing: data/lmri_woreda_t2_pcode.csv");
    return r.text();
  }).then(txt => Papa.parse(txt, { header: true, skipEmptyLines: true }).data)
]).then(([adm3, csvData]) => {

  // Build lookup by pcode
  csvData.forEach(row => {
    const p = (row.adm3_pcode || "").trim();
    if (p) dataByPcode[p] = row;
  });

  // Choropleth layer
  adm3Layer = L.geoJSON(adm3, { style: styleAdm3, onEachFeature: onEachAdm3 }).addTo(map);
  map.fitBounds(adm3Layer.getBounds(), { padding: [10, 10] });

  // Filters + legend
  populateRegions();
  buildLegend();
  updateStats();
  rebuildCircles();

  // Try loading ADM1/ADM2 overlays (optional now; you will upload later)
  // They won't break the map if files are absent.
  fetch('data/adm1_ethiopia.geojson')
    .then(r => r.ok ? r.json() : null)
    .then(adm1 => {
      if (!adm1) return;
      adm1Layer = L.geoJSON(adm1, { style: styleAdm1 }).addTo(map); // always visible
    })
    .catch(() => { /* ignore */ });

  fetch('data/adm2_ethiopia.geojson')
    .then(r => r.ok ? r.json() : null)
    .then(adm2 => {
      if (!adm2) return;
      adm2Layer = L.geoJSON(adm2, { style: styleAdm2 }); // NOT added by default
      updateAdm2Visibility(); // show only when region selected
    })
    .catch(() => { /* ignore */ });

}).catch(err => {
  console.error(err);
  alert(err.message);
});
