const map = L.map('map').setView([9, 40], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let dataByPcode = {};

function getColor(value) {
  if (value >= 0.5) return "#800026";
  if (value >= 0.3) return "#BD0026";
  if (value >= 0.2) return "#E31A1C";
  if (value >= 0.1) return "#FC4E2A";
  if (value > 0) return "#FD8D3C";
  return "#FFEDA0";
}

function style(feature) {
  const pcode = feature.properties.adm3_pcode;
  const row = dataByPcode[pcode];

  if (!row) return { fillOpacity: 0, weight: 0 };

  const lowN = Number(row.LowN_Flag) === 1;
  const opacity = lowN ? 0.3 : 0.7;

  return {
    fillColor: getColor(Number(row.LMRI_NoSupport)),
    weight: 0.5,
    color: "#333",
    fillOpacity: opacity
  };
}

function onEachFeature(feature, layer) {
  const pcode = feature.properties.adm3_pcode;
  const row = dataByPcode[pcode];

  if (!row) return;

  const tooltip = `
    <b>${row.Woreda}</b><br>
    Region: ${row.Region}<br>
    Zone: ${row.Zone}<br>
    LMRI (No Support): ${(row.LMRI_NoSupport * 100).toFixed(1)}%<br>
    Facilities (No Support): ${row.Facilities_NoSupport}<br>
    HR Count: ${row.HR_NoSupport}<br>
    ${row.LowN_Flag == 1 ? "<i>Low N caution</i>" : ""}
  `;

  layer.bindTooltip(tooltip);
}

Promise.all([
  fetch('data/adm3_ethiopia.geojson').then(res => res.json()),
  fetch('data/lmri_woreda_t2_pcode.csv')
    .then(res => res.text())
    .then(csv => Papa.parse(csv, { header: true }).data)
]).then(([geojson, csvData]) => {

  csvData.forEach(row => {
    if (row.adm3_pcode) {
      dataByPcode[row.adm3_pcode] = row;
    }
  });

  const layer = L.geoJSON(geojson, {
    style: style,
    onEachFeature: onEachFeature
  }).addTo(map);

  map.fitBounds(layer.getBounds());
});
