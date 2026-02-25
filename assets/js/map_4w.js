/* assets/js/map_4w.js
   4W woreda-level map — static GitHub Pages

   Data:
     - data/4w_woreda_agg_pcode.csv  (choropleth + woreda-level tooltips/panel)
     - data/4w_long_pcode.csv        (filters NGO/Activity + reliable NGO->activities)
     - data/adm1_ethiopia.geojson
     - data/adm2_ethiopia.geojson
     - data/adm3_ethiopia.geojson

   Features (kept):
   - Region -> Zone dependent filters
   - Choropleth by ngo_count (0 / 1 / 2 / 3-4 / 5-7 / 8+)
   - Drilldown click (fitBounds)
   - ADM1 halo + red outline, ADM2 grey
   - KPIs dynamic
   - Left-side details panel for selected woreda
   - Legend stable
   - scrollWheelZoom disabled
   - panes z-order

   Added (requested):
   - NGO filter (reliable) based on long dataset
   - Activity filter + Activity AND (two selects) based on long dataset
   - When NGO selected + woreda clicked: show reliable NGO activities in that woreda
   - When activity filter active: show NGOs matching activity(ies) in selected woreda
*/

(function () {
  // ---------- Config ----------
  const PATHS = {
    adm1: "data/adm1_ethiopia.geojson",
    adm2: "data/adm2_ethiopia.geojson",
    adm3: "data/adm3_ethiopia.geojson",
    csvAgg: "data/4w_woreda_agg_pcode.csv",
    csvLong: "data/4w_long_pcode.csv"
  };

  const DOM = {
    regionSelect: document.getElementById("regionSelect"),
    zoneSelect: document.getElementById("zoneSelect"),
    ngoSelect: document.getElementById("ngoSelect"),
    // NEW (optional, but required for activity filtering UX)
    activitySelect1: document.getElementById("activitySelect1"),
    activitySelect2: document.getElementById("activitySelect2"),

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
    detailsNgoFocus: document.getElementById("detailsNgoFocus"),

    // NEW (optional) – if you add these in HTML, we’ll fill them
    detailsActFocusWrap: document.getElementById("detailsActFocusWrap"),
    detailsActFocus: document.getElementById("detailsActFocus")
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

  // Agg (woreda-level)
  let aggRows = [];
  let aggByPcode = new Map();

  // Long (woreda x NGO x activity)
  let longRows = [];

  let currentRegion = "";
  let currentZone = "";
  let currentNgo = "";
  let currentAct1 = "";
  let currentAct2 = "";

  let lastSelectedPcode = "";

  const ETH_FALLBACK = { center: [9.03, 38.74], zoom: 6 };

  // ---------- Helpers ----------
  function normStr(v) {
    return (v ?? "").toString().trim();
  }

  function normUpper(v) {
    return normStr(v).toUpperCase();
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

  function longRowMatchesFilters(r) {
    // Region/Zone filters should match long dataset for accurate filtering set
    const rRegion = normStr(r.Region);
    const rZone = normStr(r.Zone);

    if (currentRegion && rRegion !== currentRegion) return false;
    if (currentZone && rZone !== currentZone) return false;

    if (currentNgo && normStr(r.NGO) !== currentNgo) return false;

    // Activities: AND logic if act2 selected
    if (currentAct1 || currentAct2) {
      const a = normStr(r.activity_code);
      if (!a) return false;

      // for AND we compute on group; here we only handle single activity, group handled elsewhere
      if (currentAct1 && currentAct2) return true; // group-level check later
      if (currentAct1 && a !== currentAct1) return false;
      if (currentAct2 && a !== currentAct2) return false;
    }

    return true;
  }

  // Compute focus PCODEs from long dataset (reliable for NGO/Activity queries)
  function computeFocusPcodesFromLong() {
    // Base filter on region/zone/ngo first
    const base = longRows.filter(r => {
      const rRegion = normStr(r.Region);
      const rZone = normStr(r.Zone);
      if (currentRegion && rRegion !== currentRegion) return false;
      if (currentZone && rZone !== currentZone) return false;
      if (currentNgo && normStr(r.NGO) !== currentNgo) return false;
      return true;
    });

    // If no activities selected, any row in base qualifies
    if (!currentAct1 && !currentAct2) {
      return new Set(base.map(r => normStr(r.adm3_pcode)).filter(Boolean));
    }

    // Single activity
    if ((currentAct1 && !currentAct2) || (!currentAct1 && currentAct2)) {
      const target = currentAct1 || currentAct2;
      return new Set(
        base
          .filter(r => normStr(r.activity_code) === target)
          .map(r => normStr(r.adm3_pcode))
          .filter(Boolean)
      );
    }

    // AND logic: pcode must have BOTH activities (within base, so region/zone/ngo already applied)
    const byP = new Map(); // pcode -> Set(activity_code)
    for (const r of base) {
      const p = normStr(r.adm3_pcode);
      if (!p) continue;
      const a = normStr(r.activity_code);
      if (!a) continue;
      if (!byP.has(p)) byP.set(p, new Set());
      byP.get(p).add(a);
    }
    const out = new Set();
    for (const [p, aset] of byP.entries()) {
      if (aset.has(currentAct1) && aset.has(currentAct2)) out.add(p);
    }
    return out;
  }

  // ---------- UI options ----------
  function updateZoneOptions() {
    const zoneSel = DOM.zoneSelect;
    if (!zoneSel) return;

    zoneSel.innerHTML = `<option value="">All zones</option>`;

    if (!currentRegion) {
      zoneSel.disabled = true;
      return;
    }

    // zones from AGG is fine (woreda-level universe)
    const zones = uniqueSorted(
      aggRows
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
    const regions = uniqueSorted(aggRows.map(r => normStr(r.Region)));
    for (const r of regions) {
      const opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      DOM.regionSelect.appendChild(opt);
    }
  }

  function buildNgoOptions() {
    if (!DOM.ngoSelect) return;

    // NGOs from LONG dataset (reliable)
    const ngos = uniqueSorted(longRows.map(r => normStr(r.NGO)).filter(Boolean));
    DOM.ngoSelect.innerHTML = `<option value="">All NGOs</option>`;
    for (const n of ngos) {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      DOM.ngoSelect.appendChild(opt);
    }
  }

  function buildActivityOptions() {
    // activities from LONG dataset (activity_code)
    const acts = uniqueSorted(longRows.map(r => normStr(r.activity_code)).filter(Boolean));

    function fill(selectEl) {
      if (!selectEl) return;
      selectEl.innerHTML = `<option value="">All activities</option>`;
      for (const a of acts) {
        const opt = document.createElement("option");
        opt.value = a;
        opt.textContent = a;
        selectEl.appendChild(opt);
      }
    }

    fill(DOM.activitySelect1);
    fill(DOM.activitySelect2);
  }

  // ---------- KPIs ----------
  function updateKPIsFromPcodes(focusPcodes) {
    // focusPcodes is Set of pcodes
    // KPI values computed from AGG rows intersecting focus
    const rows = aggRows.filter(r => focusPcodes.has(normStr(r.adm3_pcode)));

    const woredas = rows.length;
    const ngos = rows.reduce((acc, r) => acc + safeNum(r.ngo_count), 0);
    const acts = rows.reduce((acc, r) => acc + safeNum(r.activity_count), 0);
    const recs = rows.reduce((acc, r) => acc + safeNum(r.records), 0);

    if (DOM.kpiWoredas) DOM.kpiWoredas.textContent = woredas.toLocaleString();
    if (DOM.kpiNgos) DOM.kpiNgos.textContent = ngos.toLocaleString();
    if (DOM.kpiActivities) DOM.kpiActivities.textContent = acts.toLocaleString();
    if (DOM.kpiRecords) DOM.kpiRecords.textContent = recs.toLocaleString();
  }

  // ---------- Details panel ----------
  function getNgoActivitiesInWoreda(pcode, ngoName) {
    const p = normStr(pcode);
    const ngo = normStr(ngoName);
    if (!p || !ngo) return [];

    const acts = longRows
      .filter(r => normStr(r.adm3_pcode) === p && normStr(r.NGO) === ngo)
      .map(r => normStr(r.activity_code))
      .filter(Boolean);

    return uniqueSorted(acts);
  }

  function getNgosMatchingActivitiesInWoreda(pcode, act1, act2) {
    const p = normStr(pcode);
    if (!p) return [];

    const a1 = normStr(act1);
    const a2 = normStr(act2);

    // if none selected -> empty
    if (!a1 && !a2) return [];

    const rows = longRows.filter(r => normStr(r.adm3_pcode) === p);
    const byNgo = new Map(); // NGO -> Set(activities)
    for (const r of rows) {
      const ngo = normStr(r.NGO);
      const a = normStr(r.activity_code);
      if (!ngo || !a) continue;
      if (!byNgo.has(ngo)) byNgo.set(ngo, new Set());
      byNgo.get(ngo).add(a);
    }

    const out = [];
    for (const [ngo, aset] of byNgo.entries()) {
      if (a1 && a2) {
        if (aset.has(a1) && aset.has(a2)) out.push(ngo);
      } else {
        const target = a1 || a2;
        if (aset.has(target)) out.push(ngo);
      }
    }

    return out.sort((x, y) => x.localeCompare(y));
  }

  function renderDetailsByPcode(pcode) {
    if (!pcode) return;

    const row = aggByPcode.get(pcode);

    if (!row) {
      if (DOM.detailsHint) DOM.detailsHint.textContent = "No 4W record for this woreda (PCODE not found in AGG CSV).";
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

    if (DOM.detailsNgos) DOM.detailsNgos.textContent = truncateText(row.ngo_list, 1200);
    if (DOM.detailsActivities) DOM.detailsActivities.textContent = truncateText(row.activity_list, 1400);
    if (DOM.detailsFunding) DOM.detailsFunding.textContent = truncateText(row.funding_statuses, 900);

    // NGO focus (reliable now, from LONG)
    if (currentNgo) {
      const acts = getNgoActivitiesInWoreda(pcode, currentNgo);
      if (DOM.detailsNgoFocusWrap) DOM.detailsNgoFocusWrap.style.display = "block";
      if (DOM.detailsNgoFocus) {
        DOM.detailsNgoFocus.textContent = acts.length
          ? acts.join(", ")
          : "No activity record for this NGO in this woreda (based on LONG dataset).";
      }
    } else {
      if (DOM.detailsNgoFocusWrap) DOM.detailsNgoFocusWrap.style.display = "none";
    }

    // Activity focus (optional UI elements)
    if (DOM.detailsActFocusWrap && DOM.detailsActFocus) {
      const a1 = currentAct1;
      const a2 = currentAct2;
      const ngos = getNgosMatchingActivitiesInWoreda(pcode, a1, a2);
      if (a1 || a2) {
        DOM.detailsActFocusWrap.style.display = "block";
        const label = a1 && a2 ? `${a1} + ${a2}` : (a1 || a2);
        DOM.detailsActFocus.textContent = ngos.length
          ? `For ${label}: ${truncateText(ngos.join(", "), 900)}`
          : `For ${label}: no NGO found in this woreda (LONG dataset).`;
      } else {
        DOM.detailsActFocusWrap.style.display = "none";
      }
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
    const row = aggByPcode.get(pcode);
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
    const row = aggByPcode.get(pcode);

    const woredaName = normStr(row?.Woreda) || "Unknown woreda";
    const region = normStr(row?.Region) || "—";
    const zone = normStr(row?.Zone) || "—";

    const ngoCount = safeNum(row?.ngo_count);
    const activityCount = safeNum(row?.activity_count);
    const records = safeNum(row?.records);

    // Small “answer hint” when activity filters are set
    let actHint = "";
    if (currentAct1 || currentAct2) {
      const ngos = getNgosMatchingActivitiesInWoreda(pcode, currentAct1, currentAct2);
      const label = currentAct1 && currentAct2 ? `${currentAct1}+${currentAct2}` : (currentAct1 || currentAct2);
      actHint = `<div style="margin-top:6px;"><b>${label} NGOs:</b> ${truncateText(ngos.join(", "), 160)}</div>`;
    }

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
          ${actHint}
        </div>
      </div>
    `;
  }

  // ---------- Layers refresh ----------
  function refreshAdm3Layers() {
    if (!adm3Geo) return;

    // Compute focus pcodes from LONG dataset (reliable filters)
    const focusPcodes = computeFocusPcodesFromLong();

    // KPIs computed from AGG intersect
    updateKPIsFromPcodes(focusPcodes);

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
    if ((currentRegion || currentZone || currentNgo || currentAct1 || currentAct2) &&
        adm3FocusLayer.getLayers().length > 0) {
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
    currentAct1 = "";
    currentAct2 = "";
    lastSelectedPcode = "";

    if (DOM.regionSelect) DOM.regionSelect.value = "";
    if (DOM.zoneSelect) {
      DOM.zoneSelect.value = "";
      DOM.zoneSelect.disabled = true;
      DOM.zoneSelect.innerHTML = `<option value="">All zones</option>`;
    }
    if (DOM.ngoSelect) DOM.ngoSelect.value = "";
    if (DOM.activitySelect1) DOM.activitySelect1.value = "";
    if (DOM.activitySelect2) DOM.activitySelect2.value = "";

    if (DOM.detailsHint) DOM.detailsHint.textContent = "Click a woreda on the map to see details here.";
    if (DOM.detailsBody) DOM.detailsBody.style.display = "none";
    if (DOM.detailsNgoFocusWrap) DOM.detailsNgoFocusWrap.style.display = "none";
    if (DOM.detailsActFocusWrap) DOM.detailsActFocusWrap.style.display = "none";

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

  function indexAggByPcode() {
    aggByPcode = new Map();
    for (const r of aggRows) {
      const p = normStr(r.adm3_pcode);
      if (!p) continue;
      aggByPcode.set(p, r);
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
        if (lastSelectedPcode) renderDetailsByPcode(lastSelectedPcode);
      });
    }

    if (DOM.activitySelect1) {
      DOM.activitySelect1.addEventListener("change", () => {
        currentAct1 = normStr(DOM.activitySelect1.value);
        refreshAdm3Layers();
        if (lastSelectedPcode) renderDetailsByPcode(lastSelectedPcode);
      });
    }

    if (DOM.activitySelect2) {
      DOM.activitySelect2.addEventListener("change", () => {
        currentAct2 = normStr(DOM.activitySelect2.value);
        refreshAdm3Layers();
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

    const [adm1, adm2, adm3, agg, lng] = await Promise.all([
      loadGeoJSON(PATHS.adm1),
      loadGeoJSON(PATHS.adm2),
      loadGeoJSON(PATHS.adm3),
      loadCSV(PATHS.csvAgg),
      loadCSV(PATHS.csvLong)
    ]);

    adm3Geo = adm3;

    // AGG rows
    aggRows = agg.map(r => ({
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

    indexAggByPcode();

    // LONG rows
    // Expected columns: adm3_pcode, Region, Zone, Woreda, NGO, activity_code (and optionally activity_raw, funding_status)
    longRows = lng.map(r => ({
      adm3_pcode: normStr(r.adm3_pcode),
      Region: normStr(r.Region),
      Zone: normStr(r.Zone),
      Woreda: normStr(r.Woreda),
      NGO: normStr(r.NGO),
      activity_code: normStr(r.activity_code || r.activity || r.Activity || r.ACTIVITY),
      activity_raw: normStr(r.activity_raw),
      funding_status: normStr(r.funding_status || r.Parent_Funding_Status || r["Parent Funding Status"])
    })).filter(r => r.adm3_pcode && r.NGO && r.activity_code); // keep only usable

    buildRegionOptions();
    updateZoneOptions();
    buildNgoOptions();
    buildActivityOptions();

    addAdmOverlays(adm1, adm2);
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
