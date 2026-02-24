const map = L.map('map').setView([9, 40], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let dataByPcode = {};
let geoLayer = null;
let circlesLayer = L.layerGroup().addTo(map);

const ui = {
  metric: document.getElementById('metric'),
  region: document.getElementById('region'),
  zone: document.getElementById('zone'),
  showCircles: document.getElementById('showCircles'),
  stats: document.getElementById('stats')
};

const state = {
  metric: "nosupport",  // "nosupport" | "support"
  region: "",
  zone: "",
  showCircles: true
};

function getMetricFields() {
  // metric -> fields in CSV
  if (state.metric === "support") {
    return {
      lmri: "LMRI_Support",
      n: "Facilities_Support",
      hr: "HR_Support"
    };
  }
  return {
    lmri: "LMRI_NoSupport",
    n: "Facilities_NoSupport",
    hr: "HR_NoSupport"
  };
}

function getColor(v) {
  if (v >= 0.5) return "#800026";
  if (v >= 0.3) return "#BD0026";
  if (v >= 0.2) return "#E31A1C";
  if (v >= 0.1) return "#FC4E2A";
  if (v > 0)   return "#FD8D3C";
  return "#FFEDA0";
}

function passesFilter(row) {
  if (!row) return false;
  if (state.region && row.Region !== state.region) return false;
  if (state.zone && row.Zone !== state.zone) return false;
  return true;
}

function style(feature) {
  const pcode = (feature?.properties?.adm3_pcode || "").trim();
  const row = dataByPcode[pcode];

  // Always show outlines so user sees geography, even when filtered out
  if (!row || !passesFilter(row)) {
    return { fillOpacity: 0, weight: 0.5, color: "#777" };
  }

  const { lmri, n } = getMetricFields();
  const v = Number(row[lmri]);
  const lowN = Number(row.LowN_Flag) === 1 || Number(row[n]) < 5;
  const opacity = lowN ? 0.3 : 0.7;

  return {
    fillColor: getColor(isFinite(v) ? v : 0),
    weight: 0.7,
    color: "#333",
    fillOpacity: opacity
  };
}

function onEachFeature(feature, layer) {
  const pcode = (feature?.properties?.adm3_pcode || "").trim();
  const row = dataByPcode[pcode];
  if (!row) return;

  layer.on('mouseover', () => layer.setStyle({ weight: 1.2 }));
  layer.on('mouseout', () => geoLayer && geoLayer.resetStyle(layer));

  layer.bindTooltip(() => {
    if (!passesFilter(row)) return "";
    const { lmri, n, hr } = getMetricFields();
    const lmriVal = Number(row[lmri]);
    const nVal = Number(row[n]);
    const hrVal = Number(row[hr]);

    return `
      <b>${row.Woreda}</b><br>
      Region: ${row.Region}<br>
      Zone: ${row.Zone}<br>
      P-code: ${row.adm3_pcode}<br>
      LMRI: ${isFinite(lmriVal) ? (lmriVal * 100).toFixed(1) + "%" : "—"}<br>
      Facilities: ${isFinite(nVal) ? nVal : "—"}<br>
      HR count: ${isFinite(hrVal) ? hrVal : "—"}<br>
      ${Number(row.LowN_Flag) === 1 ? "<i>Low N caution</i>" : ""}
    `;
  }, { sticky: true });
}

function centroidOfLayer(layer) {
  // Works for polygons/multipolygons
  try {
    return layer.getBounds().getCenter();
  } catch {
    return null;
  }
}

function circleRadius(hr) {
  // sqrt scale (stable visuellement)
  const x = Math.max(0, Number(hr) || 0);
  return 3000 * Math.sqrt(x); // meters
}

function rebuildCircles() {
  circlesLayer.clearLayers();
  if (!state.showCircles) return;

  const { hr } = getMetricFields();

  geoLayer.eachLayer(layer => {
    const f = layer.feature;
    const pcode = (f?.properties?.adm3_pcode || "").trim();
    const row = dataByPcode[pcode];
    if (!row || !passesFilter(row)) return;

    const hrVal = Number(row[hr]);
    if (!isFinite(hrVal) || hrVal <= 0) return;

    const c = centroidOfLayer(layer);
    if (!c) return;

    const marker = L.circle(c, {
      radius: circleRadius(hrVal),
      weight: 1,
      color: "#111",
      fillOpacity: 0.15
    });

    marker.bindTooltip(`<b>${row.Woreda}</b><br>HR: ${hrVal}`, { sticky: true });
    circlesLayer.addLayer(marker);
  });
}

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
  if (!geoLayer) return;
  const bounds = L.latLngBounds([]);

  geoLayer.eachLayer(layer => {
    const pcode = (layer.feature?.properties?.adm3_pcode || "").trim();
    const row = dataByPcode[pcode];
    if (!row || !passesFilter(row)) return;
    bounds.extend(layer.getBounds());
  });

  if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
}

function applyAll() {
  geoLayer.setStyle(style);
  rebuildCircles();
  updateStats();
  fitToSelection();
}

function populateFilters() {
  // Regions from CSV
  const regions = Array.from(new Set(Object.values(dataByPcode).map(r => r.Region))).sort();
  regions.forEach(r => {
    const opt = document.createElement('option');
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
    const opt = document.createElement('option');
    opt.value = z;
    opt.textContent = z;
    ui.zone.appendChild(opt);
  });
  ui.zone.disabled = false;
}

// UI events
ui.metric.addEventListener('change', () => {
  state.metric = ui.metric.value;
  applyAll();
});

ui.region.addEventListener('change', () => {
  state.region = ui.region.value;
  state.zone = "";
  ui.zone.value = "";
  populateZonesForRegion(state.region);
  applyAll();
});

ui.zone.addEventListener('change', () => {
  state.zone = ui.zone.value;
  applyAll();
});

ui.showCircles.addEventListener('change', () => {
  state.showCircles = ui.showCircles.checked;
  rebuildCircles();
});

// Load data + render
Promise.all([
  fetch('data/adm3_ethiopia.geojson').then(r => r.json()),
  fetch('data/lmri_woreda_t2_pcode.csv').then(r => r.text())
    .then(txt => Papa.parse(txt, { header: true, skipEmptyLines: true }).data)
]).then(([geojson, csvData]) => {

  csvData.forEach(row => {
    const p = (row.adm3_pcode || "").trim();
    if (p) dataByPcode[p] = row;
  });

  geoLayer = L.geoJSON(geojson, { style, onEachFeature }).addTo(map);
  populateFilters();
  updateStats();
  map.fitBounds(geoLayer.getBounds());
  rebuildCircles();

}).catch(err => {
  console.error(err);
  alert(err.message);
});
