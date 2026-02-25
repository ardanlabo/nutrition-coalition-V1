// assets/js/dashboard.js

function parseCSV(text) {
  const rows = [];
  let cur = "", inQuotes = false, row = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && inQuotes && n === '"') { cur += '"'; i++; continue; }
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === ',' && !inQuotes) { row.push(cur); cur = ""; continue; }
    if ((c === '\n' || c === '\r') && !inQuotes) {
      if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
      cur = ""; row = [];
      while (text[i + 1] === '\n' || text[i + 1] === '\r') i++;
      continue;
    }
    cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  const header = rows.shift().map(h => h.trim());
  return rows.filter(r => r.length).map(r => {
    const obj = {};
    header.forEach((h, idx) => obj[h] = (r[idx] ?? "").trim());
    return obj;
  });
}

const els = {
  region: document.getElementById('fRegion'),
  zone: document.getElementById('fZone'),
  woreda: document.getElementById('fWoreda'),
  supply: document.getElementById('fSupplyT2'),
  risk: document.getElementById('fHighRisk'),
  search: document.getElementById('fSearch'),

  kpis: document.getElementById('kpis'),
  rows: document.getElementById('rows'),
  countLine: document.getElementById('countLine'),

  hrTotal: document.getElementById('hrTotal'),
  hrSupply: document.getElementById('hrSupply'),
  hrNoSupply: document.getElementById('hrNoSupply'),
  hrPctNoSupply: document.getElementById('hrPctNoSupply'),
  hrCheck: document.getElementById('hrCheck'),
};

const norm = (s) => (s || "").toLowerCase().trim();

let data = [];      // OTP-only base (after init)
let filtered = [];  // after applying UI filters

function uniqueSorted(arr) {
  return [...new Set(arr
    .filter(v => v !== undefined && v !== null && String(v).trim() !== ""))
  ]
    .map(v => String(v))
    .sort((a, b) => a.localeCompare(b));
}

function setOptions(select, values, placeholder = "All") {
  const current = select.value;
  select.innerHTML = "";
  const opt0 = document.createElement('option');
  opt0.value = ""; opt0.textContent = placeholder;
  select.appendChild(opt0);
  values.forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    select.appendChild(o);
  });
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function supplyLabel(v) {
  if (v === "1" || v === "1.0") return { txt: "NGO supply", cls: "green" };
  if (v === "0" || v === "0.0") return { txt: "No supply", cls: "red" };
  return { txt: "Not reported", cls: "yellow" };
}

// ----------------------------
// ✅ NEW: Pressure label from lmri_t2_days
// Keep thresholds simple and defensible for tomorrow.
// You can adjust later.
// ----------------------------
function pressureFromDays(daysStr) {
  const d = Number((daysStr || "").toString().trim());
  if (!Number.isFinite(d)) return "—";
  // Suggested bands (meeting-friendly):
  // 0–10  : Faible pression
  // 11–30 : Modéré
  // 31–60 : Élevé
  // 61+   : Extrême
  if (d <= 10) return "Faible pression";
  if (d <= 30) return "Modéré";
  if (d <= 60) return "Élevé";
  return "Extrême";
}

// ----------------------------
// ✅ NEW: OTP-only guardrail
// returns true only if otp_active_t2 is 1 (or 1.0)
// ----------------------------
function isOtpActiveT2(d) {
  const v = (d["otp_active_t2"] || "").trim();
  return (v === "1" || v === "1.0");
}

function refreshCascadeOptions() {
  const r = els.region.value;
  const z = els.zone.value;

  // ✅ options based on OTP-only base "data"
  setOptions(els.region, uniqueSorted(data.map(d => d.region)));
  setOptions(els.zone, uniqueSorted(data.filter(d => !r || d.region === r).map(d => d.zone)));
  setOptions(els.woreda, uniqueSorted(data.filter(d =>
    (!r || d.region === r) && (!z || d.zone === z)
  ).map(d => d.woreda)));
}

function applyFilters() {
  const r = els.region.value;
  const z = els.zone.value;
  const w = els.woreda.value;
  const s = els.supply.value;
  const hr = els.risk.value;
  const q = norm(els.search.value);

  // ✅ data is already OTP-only (from init), but keep it safe:
  filtered = data.filter(d => {
    if (r && d.region !== r) return false;
    if (z && d.zone !== z) return false;
    if (w && d.woreda !== w) return false;

    // Supply filter (T2)
    const sv = d["rutf_supply_modality_t2"] || "";
    if (s === "1" && !(sv === "1" || sv === "1.0")) return false;
    if (s === "0" && !(sv === "0" || sv === "0.0")) return false;
    if (s === "na" && sv !== "") return false;

    // High risk filter (T2 critical) — keep as filter input,
    // even if we display text status in the table.
    const rv = d["lmri_t2_critical (0/1)"] || "";
    if (hr === "1" && !(rv === "1" || rv === "1.0")) return false;
    if (hr === "0" && !(rv === "0" || rv === "0.0")) return false;

    // Search
    if (q && !norm(d.hf_name).includes(q)) return false;

    return true;
  });

  renderKPIs();
  renderHRBlock();
  renderTable();
}

function renderKPIs() {
  const total = filtered.length;

  const highRisk = filtered.filter(d =>
    d["lmri_t2_critical (0/1)"] === "1" || d["lmri_t2_critical (0/1)"] === "1.0"
  ).length;

  const supplyYes = filtered.filter(d =>
    d["rutf_supply_modality_t2"] === "1" || d["rutf_supply_modality_t2"] === "1.0"
  ).length;

  const supplyNo = filtered.filter(d =>
    d["rutf_supply_modality_t2"] === "0" || d["rutf_supply_modality_t2"] === "0.0"
  ).length;

  const supplyNA = total - supplyYes - supplyNo;

  const kpis = [
    { v: total.toLocaleString(), l: "OTP-active facilities (T2)" }, // ✅ clarify denominator
    { v: highRisk.toLocaleString(), l: "High risk (T2)" },
    { v: supplyYes.toLocaleString(), l: "NGO supply (T2)" },
    { v: supplyNA.toLocaleString(), l: "Supply not reported (T2)" },
  ];

  els.kpis.innerHTML = kpis.map(k => `
    <div class="kpi">
      <div class="v">${k.v}</div>
      <div class="l">${k.l}</div>
    </div>
  `).join("");
}

function renderHRBlock() {
  const A = filtered.filter(d =>
    d["lmri_t2_critical (0/1)"] === "1" || d["lmri_t2_critical (0/1)"] === "1.0"
  ).length;

  const B = filtered.filter(d =>
    (d["lmri_t2_critical (0/1)"] === "1" || d["lmri_t2_critical (0/1)"] === "1.0") &&
    (d["rutf_supply_modality_t2"] === "1" || d["rutf_supply_modality_t2"] === "1.0")
  ).length;

  const C = filtered.filter(d =>
    (d["lmri_t2_critical (0/1)"] === "1" || d["lmri_t2_critical (0/1)"] === "1.0") &&
    (d["rutf_supply_modality_t2"] === "0" || d["rutf_supply_modality_t2"] === "0.0")
  ).length;

  const D = filtered.filter(d =>
    (d["lmri_t2_critical (0/1)"] === "1" || d["lmri_t2_critical (0/1)"] === "1.0") &&
    ((d["rutf_supply_modality_t2"] || "") === "")
  ).length;

  const pctNo = A ? Math.round((C / A) * 1000) / 10 : 0;

  els.hrTotal.textContent = A.toLocaleString();
  els.hrSupply.textContent = B.toLocaleString();
  els.hrNoSupply.textContent = C.toLocaleString();
  els.hrPctNoSupply.textContent = `${pctNo}%`;
  els.hrCheck.textContent = `Check: A = B + C + D → ${A} = ${B} + ${C} + ${D}`;
}

function renderTable() {
  els.countLine.textContent = `${filtered.length.toLocaleString()} facilities (OTP-active T2, filtered view)`;

  const maxRows = 900; // keep responsive
  // ✅ stable, useful sorting for operations:
  // High risk first, then highest days, then HF name
  const slice = filtered
    .slice()
    .sort((a, b) => {
      const aCrit = (a["lmri_t2_critical (0/1)"] === "1" || a["lmri_t2_critical (0/1)"] === "1.0") ? 1 : 0;
      const bCrit = (b["lmri_t2_critical (0/1)"] === "1" || b["lmri_t2_critical (0/1)"] === "1.0") ? 1 : 0;
      if (bCrit !== aCrit) return bCrit - aCrit;

      const aDays = Number((a["lmri_t2_days"] || "").toString().trim());
      const bDays = Number((b["lmri_t2_days"] || "").toString().trim());
      const aD = Number.isFinite(aDays) ? aDays : -1;
      const bD = Number.isFinite(bDays) ? bDays : -1;
      if (bD !== aD) return bD - aD;

      return (a.hf_name || "").localeCompare(b.hf_name || "");
    })
    .slice(0, maxRows);

  els.rows.innerHTML = slice.map(d => {
    const sup = supplyLabel(d["rutf_supply_modality_t2"]);
    const t2 = d["lmri_t2_days"] || "";
    const statusTxt = pressureFromDays(t2); // ✅ text status
    const low = d["low_data_flag (1 si DRS < 0.5)"] || "";

    return `
      <tr>
        <td>${d.region}</td>
        <td>${d.zone}</td>
        <td>${d.woreda}</td>
        <td><b>${d.hf_name}</b><div class="small">${d.hf_id}</div></td>
        <td>${d.adm3_pcode}</td>
        <td><span class="pill ${sup.cls}">${sup.txt}</span></td>
        <td>${t2}</td>
        <td>${statusTxt}</td>
        <td>${low}</td>
      </tr>
    `;
  }).join("");
}

async function init() {
  const res = await fetch('data/dashboard_facility_layer_v2_clean.csv');
  const txt = await res.text();
  const all = parseCSV(txt);

  // ✅ OTP-only base dataset
  // IMPORTANT: this relies on a column named "otp_active_t2"
  // If your column name differs, change it ONLY in isOtpActiveT2().
  data = all.filter(isOtpActiveT2);

  refreshCascadeOptions();
  applyFilters();

  els.region.addEventListener('change', () => {
    els.zone.value = "";
    els.woreda.value = "";
    refreshCascadeOptions();
    applyFilters();
  });

  els.zone.addEventListener('change', () => {
    els.woreda.value = "";
    refreshCascadeOptions();
    applyFilters();
  });

  els.woreda.addEventListener('change', applyFilters);
  els.supply.addEventListener('change', applyFilters);
  els.risk.addEventListener('change', applyFilters);

  els.search.addEventListener('input', () => {
    window.clearTimeout(window.__t);
    window.__t = window.setTimeout(applyFilters, 120);
  });
}

init();
