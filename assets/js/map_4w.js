/* js/map_4w.js
   4W woreda-level minimap (full page) — static GitHub Pages
   Data: data/4w_woreda_agg_pcode.csv
   Join key: adm3_pcode vs adm3_ethiopia.geojson properties.ADM3_PCODE (or adm3_pcode)
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
    resetBtn: document.getElementById("resetBtn"),
    kpiWoredas: document.getElementById("kpiWoredas"),
    kpiNgos: document.getElementById("kpiNgos"),
    kpiActivities: document.getElementById("kpiActivities"),
    kpiRecords: document.getElementById("kpiRecords"),
    legendBox: document.getElementById("legendBox")
  };

  // NGO count classes: 0 / 1 / 2 / 3-4 / 5-7 / 8+
  const NGO_CLASSES = [
    { key: "c0", label: "0", min: 0, max: 0 },
    { key: "c1", label: "1", min: 1, max: 1 },
    { key: "c2", label: "2", min: 2, max: 2 },
    { key: "c3", label: "3–4", min: 3, max: 4 },
    { key: "c4", label: "5–7", min: 5, max: 7 },
    { key: "c5", label: "8+", min: 8, max: Infinity }
  ];

  // Stable palette (light -> dark). Keep it constant for meeting readability.
  const COLORS = {
  c0: "#111827",  // 0 NGOs (quasi noir/bleu)
  c1: "#1d4ed8",  // 1 (bleu franc)
  c2: "#2563eb",  // 2
  c3: "#3b82f6",  // 3–4
  c4: "#60a5fa",  // 5–7
  c5: "#93c5fd"   // 8+
};

  // ---------- Leaflet map ----------
  const map = L.map("map", {
    zoomControl: true,
    scrollWheelZoom: false
  });

  // Panes for z-order control
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
  let adm1Layer = null;
  let adm1HaloLayer = null;
  let adm2Layer = null;

  let adm3AllLayer = null;   // background (all woredas, low emphasis)
  let adm3FocusLayer = null; // focus (filtered by region/zone, colored)
  let adm3Geo = null;

  let csvRows = [];
  let rowByPcode = new Map();

  let currentRegion = "";
  let currentZone = "";

  const ETHIOPIA_FALLBACK_VIEW = { center: [9.03, 38.74], zoom: 6 };

  // ---------- Helpers ----------
  function safeNum(v) {
    if (v === null || v === undefined) return 0;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : 0;
  }

  function normStr(v) {
    return (v ?? "").toString().trim();
  }

  function getAdm3PcodeFromFeature(feature) {
    const p = feature?.properties || {};
    // common variants
    return (
      p.ADM3_PCODE ||
      p.adm3_pcode ||
      p.ADM3PCODE ||
      p.ADM3_CODE ||
      ""
    ).toString().trim();
  }

  function getRegionFromFeature(feature) {
    const p = feature?.properties || {};
    return (p.ADM1_EN || p.ADM1_NAME || p.region || "").toString().trim();
  }

  function getZoneFromFeature(feature) {
    const p = feature?.properties || {};
    // zones often in ADM2 or custom property; we’ll use CSV for zones anyway
    return (p.ADM2_EN || p.ADM2_NAME || p.zone || "").toString().trim();
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

  function truncateList(s, maxChars) {
    const t = normStr(s);
    if (!t) return "—";
    if (t.length <= maxChars) return t;
    return t.slice(0, maxChars - 1) + "…";
  }

  function setLegendSwatches() {
    if (!DOM.legendBox) return;
    DOM.legendBox.querySelectorAll("[data-swatch]").forEach(el => {
      const key = el.getAttribute("data-swatch");
      el.style.background = COLORS[key] || "#eee";
    });
  }

  function uniqueSorted(arr) {
    return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function updateZoneOptions() {
    const zoneSel = DOM.zoneSelect;
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

  function computeFilteredRows() {
    return csvRows.filter(r => {
      const rRegion = normStr(r.Region);
      const rZone = normStr(r.Zone);

      if (currentRegion && rRegion !== currentRegion) return false;
      if (currentZone && rZone !== currentZone) return false;
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

  function makeTooltipHTML(feature) {
    const pcode = getAdm3PcodeFromFeature(feature);
    const row = rowByPcode.get(pcode);

    const props = feature.properties || {};
    const woredaName =
      normStr(row?.Woreda) ||
      normStr(props.ADM3_EN) ||
      normStr(props.ADM3_NAME) ||
      "Unknown woreda";

    const region = normStr(row?.Region) || getRegionFromFeature(feature) || "—";
    const zone = normStr(row?.Zone) || "—";

    const ngoCount = safeNum(row?.ngo_count);
    const activityCount = safeNum(row?.activity_count);
    const records = safeNum(row?.records);

    const fundingStatuses = truncateList(row?.funding_statuses, 120);
    const ngoList = truncateList(row?.ngo_list, 180);
    const activityList = truncateList(row?.activity_list, 180);

    return `
      <div style="min-width:260px">
        <div style="font-weight:700; font-size:14px; margin-bottom:6px;">${woredaName}</div>
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

        <div style="font-size:12px; line-height:1.35;">
          <div><b>Funding statuses:</b> ${fundingStatuses}</div>
          <div style="margin-top:6px;"><b>NGO list:</b> ${ngoList}</div>
          <div style="margin-top:6px;"><b>Activity list:</b> ${activityList}</div>
        </div>
      </div>
    `;
  }

  function styleAdm3Bg() {
    return {
      pane: "adm3bg",
      color: "#111827",
      weight: 0.6,
      opacity: 0.35,
      fillOpacity: 0.05,
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
      weight: 0.8,
      opacity: 0.8,
      fillOpacity: 0.75,
      fillColor: colorForNgoCount(ngoCount)
    };
  }

  function refreshAdm3Layers() {
    if (!adm3Geo) return;

    const filteredRows = computeFilteredRows();
    updateKPIs(filteredRows);

    // Build a set of pcodes in current filter
    const focusPcodes = new Set(filteredRows.map(r => normStr(r.adm3_pcode)));

    // Remove previous layers (do not leak)
    if (adm3AllLayer) map.removeLayer(adm3AllLayer);
    if (adm3FocusLayer) map.removeLayer(adm3FocusLayer);

    // Background: all woredas
    adm3AllLayer = L.geoJSON(adm3Geo, {
      style: styleAdm3Bg,
      onEachFeature: (feature, layer) => {
        // Keep lightweight; no tooltip on bg
      }
    }).addTo(map);

    // Focus: only filtered woredas, colored
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
          } catch (e) {
            // no-op
          }
        });
      }
    }).addTo(map);

    // Fit bounds to focus if filter is active and has data
    if ((currentRegion || currentZone) && adm3FocusLayer.getLayers().length > 0) {
      try {
        map.fitBounds(adm3FocusLayer.getBounds(), { padding: [20, 20] });
      } catch (e) {
        // fallback
      }
    }
  }

  function resetView() {
    currentRegion = "";
    currentZone = "";

    if (DOM.regionSelect) DOM.regionSelect.value = "";
    if (DOM.zoneSelect) {
      DOM.zoneSelect.value = "";
      DOM.zoneSelect.disabled = true;
      DOM.zoneSelect.innerHTML = `<option value="">All zones</option>`;
    }

    refreshAdm3Layers();
    map.setView(ETHIOPIA_FALLBACK_VIEW.center, ETHIOPIA_FALLBACK_VIEW.zoom);
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

  function buildRegionOptions() {
    const regions = uniqueSorted(csvRows.map(r => normStr(r.Region)));
    for (const r of regions) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      DOM.regionSelect.appendChild(opt);
    }
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
    // ADM2 grey (under ADM1)
    adm2Layer = L.geoJSON(adm2, {
      pane: "adm2",
      style: {
        color: "#6b7280",
        weight: 1,
        opacity: 0.6,
        fillOpacity: 0
      }
    }).addTo(map);

    // ADM1 halo (white thick line)
    adm1HaloLayer = L.geoJSON(adm1, {
      pane: "adm1halo",
      style: {
        color: "#ffffff",
        weight: 6,
        opacity: 0.9,
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

  // ---------- Wiring UI ----------
  function wireUI() {
    if (DOM.regionSelect) {
      DOM.regionSelect.addEventListener("change", () => {
        currentRegion = normStr(DOM.regionSelect.value);
        currentZone = "";
        if (DOM.zoneSelect) DOM.zoneSelect.value = "";

        updateZoneOptions();
        refreshAdm3Layers();
      });
    }

    if (DOM.zoneSelect) {
      DOM.zoneSelect.addEventListener("change", () => {
        currentZone = normStr(DOM.zoneSelect.value);
        refreshAdm3Layers();
      });
    }

    if (DOM.resetBtn) {
      DOM.resetBtn.addEventListener("click", resetView);
    }
  }

  // ---------- Init ----------
  async function init() {
    setLegendSwatches();

    // Start view
    map.setView(ETHIOPIA_FALLBACK_VIEW.center, ETHIOPIA_FALLBACK_VIEW.zoom);

    // Load all in parallel
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
    addAdmOverlays(adm1, adm2);
    wireUI();

    // Initial render
    refreshAdm3Layers();

    // Fit to Ethiopia bounds using ADM1 if possible (more stable than hardcoded)
    try {
      const tmp = L.geoJSON(adm1);
      map.fitBounds(tmp.getBounds(), { padding: [20, 20] });
    } catch (e) {
      // fallback already set
    }
  }

  init().catch(err => {
    console.error("[map_4w] init failed:", err);
    alert("Map failed to load. Open console for details.");
  });
})();
