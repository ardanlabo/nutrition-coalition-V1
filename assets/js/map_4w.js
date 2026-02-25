/* assets/js/map_4w.js
   4W woreda-level map — static GitHub Pages
   Data:
     - data/4w_woreda_agg_pcode.csv
     - data/adm1_ethiopia.geojson
     - data/adm2_ethiopia.geojson
     - data/adm3_ethiopia.geojson

   Features:
   - Region -> Zone dependent filters
   - NGO filter (based on ngo_list)
   - Choropleth by ngo_count (0 / 1 / 2 / 3-4 / 5-7 / 8+)
   - Drilldown click (fitBounds)
   - ADM1 halo + red outline, ADM2 grey
   - KPIs dynamic
   - Left-side details panel for selected woreda
   - Best-effort NGO->activities extraction (only if activity_list contains identifiable mapping)
*/

(function () {
  // ---------- Config ----------
  const PATHS = {
    adm1: "data/adm1_ethiopia.geojson",
    adm2: "data/adm2_ethiopia.geojson",
    adm3: "data/adm3_ethiopia.geojson",
    csv: "data/4w_woreda_agg_pcode.csv"
  };

  const DOM = {
    regionSelect: document.getElementById("regionSelect"),
    zoneSelect: document.getElementById("zoneSelect"),
    ngoSelect: document.getElementById("ngoSelect"),
    resetBtn: document.getElementById("resetBtn"),

    kpiWoredas: document.getElementById("kpiWoredas"),
    kpiNgos: document.getElementById("kpiNgos"),
    kpiActivities: document.getElementById("kpiActivities"),
    kpiRecords: document.getElementById("kpiRecords"),

    legendBox: document.getElementById("legendBox"),

    detailsHint: document.getElementById("detailsHint"),
    detailsBody: document.getElementById("detailsBody"),
    detailsTitle: document.getElementById("detailsTitle"),
    detailsMeta: document.getElementById("detailsMeta"),
    detailsNgos: document.getElementById("detailsNgos"),
    detailsActivities: document.getElementById("detailsActivities"),
    detailsFunding: document.getElementById("detailsFunding"),
    detailsNgoFocusWrap: document.getElementById("detailsNgoFocusWrap"),
    detailsNgoFocus: document.getElementById("detailsNgoFocus")
  };

  // NGO count classes
  const NGO_CLASSES = [
    { key: "c0", label: "0", min: 0, max: 0 },
    { key: "c1", label: "1", min: 1, max: 1 },
    { key: "c2", label: "2", min: 2, max: 2 },
    { key: "c3", label: "3–4", min: 3, max: 4 },
    { key: "c4", label: "5–7", min: 5, max: 7 },
    { key: "c5", label: "8+", min: 8, max: Infinity }
  ];

  // High-contrast palette (meeting-friendly)
  // Dark theme: keep c0 very dark, others clearly distinct
  const COLORS = {
    c0: "#0b1220",
    c1: "#1d4ed8",
    c2: "#2563eb",
    c3: "#3b82f6",
    c4: "#60a5fa",
    c5: "#93c5fd"
  };

  // ---------- Leaflet ----------
  const map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: false
  });

  // Panes (z-order)
  map.createPane("basemap");
  map.createPane("adm2");
  map.createPane("adm1halo");
  map.createPane("adm1");
  map.createPane("adm3bg");
  map.createPane("adm3focus");

  map.getPane("basemap").style.zIndex = 100;
  map.getPane("adm2").style.zIndex = 300;
  map.getPane("adm1halo").style.zIndex = 350;
  map.getPane("adm1").style.zIndex = 400;
  map.getPane("adm3bg").style.zIndex = 450;
  map.getPane("adm3focus").style.zIndex = 500;

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    pane: "basemap",
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  // ---------- State ----------
  let adm2Layer = null;
  let adm1HaloLayer = null;
  let adm1Layer = null;

  let adm3AllLayer = null;
  let adm3FocusLayer = null;
  let adm3Geo = null;

  let csvRows = [];
  let rowByPcode = new Map();

  let currentRegion = "";
  let currentZone = "";
  let currentNgo = "";

  let lastSelectedPcode = "";

  const ETH_FALLBACK = { center: [9.03, 38.74], zoom: 6 };

  // ---------- Helpers ----------
  function normStr(v) {
    return (v ?? "").toString().trim();
  }

  function safeNum(v) {
    if (v === null || v === undefined) return 0;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : 0;
  }

  function uniqueSorted(arr) {
    return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function splitList(raw) {
    const t = normStr(raw);
    if (!t) return [];
    return t
      .split(/[,;|\n]+/g)
      .map(x => x.trim())
      .filter(Boolean);
  }

  function ngoInRow(row, ngoName) {
    if (!ngoName) return true;
    const list = splitList(row?.ngo_list).map(x => x.toLowerCase());
    return list.includes(ngoName.toLowerCase());
  }

  function truncateText(s, maxChars) {
    const t = normStr(s);
    if (!t) return "—";
    if (t.length <= maxChars) return t;
    return t.slice(0, maxChars - 1) + "…";
  }

  function classifyNgoCount(n) {
    for (const c of NGO_CLASSES) {
      if (n >= c.min && n <= c.max) return c.key;
    }
    return "c0";
  }

  function colorForNgoCount(n) {
    const key = classifyNgoCount(n);
    return COLORS[key] || COLORS.c0;
  }

  function getAdm3PcodeFromFeature(feature) {
    const p = feature?.properties || {};
    return (
      p.ADM3_PCODE ||
      p.adm3_pcode ||
      p.ADM3PCODE ||
      p.ADM3_CODE ||
      ""
    ).toString().trim();
  }

  function setLegendSwatches() {
    if (!DOM.legendBox) return;
    DOM.legendBox.querySelectorAll("[data-swatch]").forEach(el => {
      const key = el.getAttribute("data-swatch");
      el.style.background = COLORS[key] || "#111827";
    });
  }

  // Best-effort extraction if activity_list contains patterns like:
  // "NGO: activity1, activity2; NGO2: activity..."
  function extractNgoActivities(activityListRaw, ngoName) {
    const ngo = normStr(ngoName);
    const txt = normStr(activityListRaw);
    if (!ngo || !txt) return "";

    const parts = txt.split(/[;|\n]+/g).map(x => x.trim()).filter(Boolean);
    const hits = parts.filter(p => p.toLowerCase().includes(ngo.toLowerCase()));
    if (!hits.length) return "";

    const cleaned = hits.map(h => {
      const idx = h.indexOf(":");
      if (idx !== -1) return h.slice(idx + 1).trim();
      return h;
    });

    return cleaned.join("\n");
  }

  // ---------- UI ----------
  function updateZoneOptions() {
    const zoneSel = DOM.zoneSelect;
    if (!zoneSel) return;

    zoneSel.innerHTML = `<option value="">All zones</option>`;

    if (!currentRegion) {
      zoneSel.disabled = true;
      return;
    }

    const zones = uniqueSorted(
      csvRows
        .filter(r => normStr(r.Region) === currentRegion)
        .map(r => normStr(r.Zone))
    );

    for (const z of zones) {
      const opt = document.createElement("option");
      opt.value = z;
      opt.textContent = z;
      zoneSel.appendChild(opt);
    }

    zoneSel.disabled = false;
  }

  function buildRegionOptions() {
    if (!DOM.regionSelect) return;
    const regions = uniqueSorted(csvRows.map(r => normStr(r.Region)));
    for (const r of regions) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      DOM.regionSelect.appendChild(opt);
    }
  }

  function buildNgoOptions() {
    if (!DOM.ngoSelect) return;

    const all = [];
    for (const r of csvRows) {
      const items = splitList(r.ngo_list);
      for (const it of items) all.push(it);
    }
    const ngos = uniqueSorted(all);

    DOM.ngoSelect.innerHTML = `<option value="">All NGOs</option>`;
    for (const n of ngos) {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      DOM.ngoSelect.appendChild(opt);
    }
  }

  function computeFilteredRows() {
    return csvRows.filter(r => {
      const rRegion = normStr(r.Region);
      const rZone = normStr(r.Zone);

      if (currentRegion && rRegion !== currentRegion) return false;
      if (currentZone && rZone !== currentZone) return false;

      if (currentNgo && !ngoInRow(r, currentNgo)) return false;

      return true;
    });
  }

  function updateKPIs(filteredRows) {
    const woredas = filteredRows.length;
    const ngos = filteredRows.reduce((acc, r) => acc + safeNum(r.ngo_count), 0);
    const acts = filteredRows.reduce((acc, r) => acc + safeNum(r.activity_count), 0);
    const recs = filteredRows.reduce((acc, r) => acc + safeNum(r.records), 0);

    if (DOM.kpiWoredas) DOM.kpiWoredas.textContent = woredas.toLocaleString();
    if (DOM.kpiNgos) DOM.kpiNgos.textContent = ngos.toLocaleString();
    if (DOM.kpiActivities) DOM.kpiActivities.textContent = acts.toLocaleString();
    if (DOM.kpiRecords) DOM.kpiRecords.textContent = recs.toLocaleString();
  }

  function renderDetailsByPcode(pcode) {
    if (!pcode) return;
    const row = rowByPcode.get(pcode);

    if (!row) {
      if (DOM.detailsHint) DOM.detailsHint.textContent = "No 4W record for this woreda (PCODE not found in CSV).";
      if (DOM.detailsBody) DOM.detailsBody.style.display = "none";
      return;
    }

    const title = `${normStr(row.Woreda) || "Woreda"} — ${pcode}`;
    const meta =
      `${normStr(row.Region) || "—"} • ${normStr(row.Zone) || "—"} • ` +
      `NGOs: ${safeNum(row.ngo_count)} • Activities: ${safeNum(row.activity_count)} • Records: ${safeNum(row.records)}`;

    if (DOM.detailsHint) DOM.detailsHint.textContent = "";
    if (DOM.detailsBody) DOM.detailsBody.style.display = "block";

    if (DOM.detailsTitle) DOM.detailsTitle.textContent = title;
    if (DOM.detailsMeta) DOM.detailsMeta.textContent = meta;

    if (DOM.detailsNgos) DOM.detailsNgos.textContent = truncateText(row.ngo_list, 900);
    if (DOM.detailsActivities) DOM.detailsActivities.textContent = truncateText(row.activity_list, 1200);
    if (DOM.detailsFunding) DOM.detailsFunding.textContent = truncateText(row.funding_statuses, 800);

    if (currentNgo) {
      const best = extractNgoActivities(row.activity_list, currentNgo);
      if (DOM.detailsNgoFocusWrap) DOM.detailsNgoFocusWrap.style.display = "block";

      if (best) {
        if (DOM.detailsNgoFocus) DOM.detailsNgoFocus.textContent = truncateText(best, 900);
      } else {
        // Do not invent mapping if the dataset doesn’t contain it.
        if (DOM.detailsNgoFocus) DOM.detailsNgoFocus.textContent =
          "No reliable NGO→activity mapping found in activity_list (dataset is aggregated). " +
          "Use the woreda-level activity list above.";
      }
    } else {
      if (DOM.detailsNgoFocusWrap) DOM.detailsNgoFocusWrap.style.display = "none";
    }
  }

  // ---------- Styling ----------
  function styleAdm3Bg() {
    return {
      pane: "adm3bg",
      color: "#111827",
      weight: 0.6,
      opacity: 0.25,
      fillOpacity: 0.04,
      fillColor: "#ffffff"
    };
  }

  function styleAdm3Focus(feature) {
    const pcode = getAdm3PcodeFromFeature(feature);
    const row = rowByPcode.get(pcode);
    const ngoCount = safeNum(row?.ngo_count);

    return {
      pane: "adm3focus",
      color: "#111827",
      weight: 0.9,
      opacity: 0.85,
      fillOpacity: 0.85,
      fillColor: colorForNgoCount(ngoCount)
    };
  }

  function makeTooltipHTML(feature) {
    const pcode = getAdm3PcodeFromFeature(feature);
    const row = rowByPcode.get(pcode);

    const woredaName = normStr(row?.Woreda) || "Unknown woreda";
    const region = normStr(row?.Region) || "—";
    const zone = normStr(row?.Zone) || "—";

    const ngoCount = safeNum(row?.ngo_count);
    const activityCount = safeNum(row?.activity_count);
    const records = safeNum(row?.records);

    return `
      <div style="min-width:260px">
        <div style="font-weight:800; font-size:14px; margin-bottom:6px;">${woredaName}</div>
        <div style="font-size:12px; opacity:.85; margin-bottom:8px;">
          <div><b>Region:</b> ${region}</div>
          <div><b>Zone:</b> ${zone}</div>
          <div><b>ADM3 PCODE:</b> ${pcode || "—"}</div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:12px; margin-bottom:8px;">
          <div><b>NGOs:</b> ${ngoCount}</div>
          <div><b>Activities:</b> ${activityCount}</div>
          <div><b>Records:</b> ${records}</div>
          <div><b>Coverage class:</b> ${normStr(row?.coverage_class) || "—"}</div>
        </div>

        <div style="font-size:12px; opacity:.85;">
          <div><b>NGOs:</b> ${truncateText(row?.ngo_list, 180)}</div>
          <div style="margin-top:6px;"><b>Activities:</b> ${truncateText(row?.activity_list, 180)}</div>
        </div>
      </div>
    `;
  }

  // ---------- Layers refresh ----------
  function refreshAdm3Layers() {
    if (!adm3Geo) return;

    const filteredRows = computeFilteredRows();
    updateKPIs(filteredRows);

    const focusPcodes = new Set(filteredRows.map(r => normStr(r.adm3_pcode)));

    if (adm3AllLayer) map.removeLayer(adm3AllLayer);
    if (adm3FocusLayer) map.removeLayer(adm3FocusLayer);

    // Background
    adm3AllLayer = L.geoJSON(adm3Geo, {
      style: styleAdm3Bg
    }).addTo(map);

    // Focus (filtered + colored)
    adm3FocusLayer = L.geoJSON(adm3Geo, {
      filter: (feature) => {
        const pcode = getAdm3PcodeFromFeature(feature);
        return focusPcodes.has(pcode);
      },
      style: styleAdm3Focus,
      onEachFeature: (feature, layer) => {
        layer.bindTooltip(makeTooltipHTML(feature), { sticky: true, direction: "auto" });

        layer.on("click", () => {
          try {
            const b = layer.getBounds();
            if (b && b.isValid()) map.fitBounds(b, { padding: [18, 18] });
          } catch (e) {}

          const pcode = getAdm3PcodeFromFeature(feature);
          lastSelectedPcode = pcode;
          renderDetailsByPcode(pcode);
        });
      }
    }).addTo(map);

    // Fit bounds to focus when a filter is active
    if ((currentRegion || currentZone || currentNgo) && adm3FocusLayer.getLayers().length > 0) {
      try {
        map.fitBounds(adm3FocusLayer.getBounds(), { padding: [20, 20] });
      } catch (e) {}
    }
  }

  function resetView(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();

    currentRegion = "";
    currentZone = "";
    currentNgo = "";
    lastSelectedPcode = "";

    if (DOM.regionSelect) DOM.regionSelect.value = "";
    if (DOM.zoneSelect) {
      DOM.zoneSelect.value = "";
      DOM.zoneSelect.disabled = true;
      DOM.zoneSelect.innerHTML = `<option value="">All zones</option>`;
    }
    if (DOM.ngoSelect) DOM.ngoSelect.value = "";

    if (DOM.detailsHint) DOM.detailsHint.textContent = "Click a woreda on the map to see details here.";
    if (DOM.detailsBody) DOM.detailsBody.style.display = "none";
    if (DOM.detailsNgoFocusWrap) DOM.detailsNgoFocusWrap.style.display = "none";

    refreshAdm3Layers();
    map.setView(ETH_FALLBACK.center, ETH_FALLBACK.zoom);
  }

  // ---------- Data loading ----------
  async function loadGeoJSON(url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status})`);
    return await res.json();
  }

  function loadCSV(url) {
    return new Promise((resolve, reject) => {
      Papa.parse(url, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: (results) => resolve(results.data),
        error: (err) => reject(err)
      });
    });
  }

  function indexRowsByPcode() {
    rowByPcode = new Map();
    for (const r of csvRows) {
      const p = normStr(r.adm3_pcode);
      if (!p) continue;
      rowByPcode.set(p, r);
    }
  }

  function addAdmOverlays(adm1, adm2) {
    // ADM2 grey
    adm2Layer = L.geoJSON(adm2, {
      pane: "adm2",
      style: {
        color: "#6b7280",
        weight: 1,
        opacity: 0.55,
        fillOpacity: 0
      }
    }).addTo(map);

    // ADM1 halo
    adm1HaloLayer = L.geoJSON(adm1, {
      pane: "adm1halo",
      style: {
        color: "#ffffff",
        weight: 6,
        opacity: 0.75,
        fillOpacity: 0
      }
    }).addTo(map);

    // ADM1 red
    adm1Layer = L.geoJSON(adm1, {
      pane: "adm1",
      style: {
        color: "#dc2626",
        weight: 2.2,
        opacity: 0.95,
        fillOpacity: 0
      }
    }).addTo(map);
  }

  // ---------- Wiring ----------
  function wireUI() {
    if (DOM.regionSelect) {
      DOM.regionSelect.addEventListener("change", () => {
        currentRegion = normStr(DOM.regionSelect.value);
        currentZone = "";
        if (DOM.zoneSelect) DOM.zoneSelect.value = "";

        updateZoneOptions();
        refreshAdm3Layers();

        if (lastSelectedPcode) renderDetailsByPcode(lastSelectedPcode);
      });
    }

    if (DOM.zoneSelect) {
      DOM.zoneSelect.addEventListener("change", () => {
        currentZone = normStr(DOM.zoneSelect.value);
        refreshAdm3Layers();

        if (lastSelectedPcode) renderDetailsByPcode(lastSelectedPcode);
      });
    }

    if (DOM.ngoSelect) {
      DOM.ngoSelect.addEventListener("change", () => {
        currentNgo = normStr(DOM.ngoSelect.value);
        refreshAdm3Layers();

        if (!currentNgo && DOM.detailsNgoFocusWrap) DOM.detailsNgoFocusWrap.style.display = "none";
        if (lastSelectedPcode) renderDetailsByPcode(lastSelectedPcode);
      });
    }

    if (DOM.resetBtn) {
      DOM.resetBtn.addEventListener("click", resetView);
    }
  }

  // ---------- Init ----------
  async function init() {
    setLegendSwatches();
    map.setView(ETH_FALLBACK.center, ETH_FALLBACK.zoom);

    const [adm1, adm2, adm3, rows] = await Promise.all([
      loadGeoJSON(PATHS.adm1),
      loadGeoJSON(PATHS.adm2),
      loadGeoJSON(PATHS.adm3),
      loadCSV(PATHS.csv)
    ]);

    adm3Geo = adm3;

    csvRows = rows.map(r => ({
      Region: normStr(r.Region),
      Zone: normStr(r.Zone),
      Woreda: normStr(r.Woreda),
      adm3_pcode: normStr(r.adm3_pcode),

      ngo_count: safeNum(r.ngo_count),
      activity_count: safeNum(r.activity_count),
      records: safeNum(r.records),

      funding_statuses: normStr(r.funding_statuses),
      coverage_index: normStr(r.coverage_index),
      ngo_list: normStr(r.ngo_list),
      activity_list: normStr(r.activity_list),
      coverage_class: normStr(r.coverage_class)
    }));

    indexRowsByPcode();
    buildRegionOptions();
    buildNgoOptions();
    addAdmOverlays(adm1, adm2);
    updateZoneOptions();
    wireUI();

    refreshAdm3Layers();

    // Fit to Ethiopia bounds using ADM1 if possible
    try {
      const tmp = L.geoJSON(adm1);
      map.fitBounds(tmp.getBounds(), { padding: [20, 20] });
    } catch (e) {
      // fallback already set
    }
  }

  init().catch(err => {
    console.error("[map_4w] init failed:", err);
    alert("4W map failed to load. Open console for details.");
  });
})();
