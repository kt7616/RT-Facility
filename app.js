// ================================================================
// 北日本 放射線治療施設アクセスマップ - メインアプリケーション
// ================================================================

"use strict";

// --- 定数 ---
const TIME_BREAKS = [0, 15, 30, 45, 60, 90, 120, 180, Infinity];
const TIME_LABELS = [
  "15分以内", "15-30分", "30-45分", "45-60分",
  "60-90分", "90-120分", "120-180分", "180分超"
];
const TIME_COLORS = [
  "#2166ac", "#4393c3", "#92c5de", "#fddbc7",
  "#f4a582", "#d6604d", "#b2182b", "#67001f"
];

// --- 状態管理 ---
let map;
let prefectures = [];
let allFacilities = [];
let prefData = {};        // { code: { mesh, durMatrix, muni, border, loaded } }
let prefLayers = {};      // { code: { meshLayer, muniLayer, borderLayer, markerLayer } }
let activeFacilities = new Set();
let debounceTimer = null;
let loadedCount = 0;
let summaryPrefCode = "01"; // デフォルト: 北海道

// ================================================================
// ユーティリティ
// ================================================================

function classifyTime(minutes) {
  for (let i = 1; i < TIME_BREAKS.length; i++) {
    if (minutes <= TIME_BREAKS[i]) return i - 1;
  }
  return TIME_LABELS.length - 1;
}

function formatNumber(n) {
  return n.toLocaleString("ja-JP");
}

// ================================================================
// データ読み込み
// ================================================================

async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to load: " + url);
  return res.json();
}

async function loadInitialData() {
  [prefectures, allFacilities] = await Promise.all([
    loadJSON("data/prefectures.json"),
    loadJSON("data/facilities.json")
  ]);

  // 全施設をデフォルトで有効化
  allFacilities.forEach(f => activeFacilities.add(f.name));

  // 道県データ構造を初期化
  prefectures.forEach(p => {
    prefData[p.code] = { loaded: false, loading: false };
    prefLayers[p.code] = {
      meshLayer: L.layerGroup(),
      muniLayer: L.layerGroup(),
      borderLayer: L.layerGroup(),
      markerLayer: L.layerGroup()
    };
  });
}

async function loadPrefectureData(code) {
  if (prefData[code].loaded || prefData[code].loading) return;
  prefData[code].loading = true;

  const pref = prefectures.find(p => p.code === code);
  const dir = "data/" + pref.dir_name;

  try {
    const [mesh, durMatrix, muni, border] = await Promise.all([
      loadJSON(dir + "/mesh.geojson"),
      loadJSON(dir + "/dur_matrix.json"),
      loadJSON(dir + "/muni.geojson"),
      loadJSON(dir + "/border.geojson")
    ]);

    prefData[code].mesh = mesh;
    prefData[code].durMatrix = durMatrix;
    prefData[code].muni = muni;
    prefData[code].border = border;
    prefData[code].loaded = true;

    // 境界・市区町村レイヤを描画（一度だけ）
    renderStaticLayers(code);
  } catch (e) {
    console.warn("Failed to load data for " + code + ": " + e.message);
  }

  prefData[code].loading = false;
  loadedCount++;
  updateLoadingProgress();
}

function updateLoadingProgress() {
  const el = document.getElementById("loadingOverlay");
  if (!el) return;
  const total = prefectures.length;
  const pct = Math.round(loadedCount / total * 100);
  const pref = prefectures[loadedCount - 1];
  const name = pref ? pref.name : "";
  el.textContent = "データ読み込み中... " + loadedCount + "/" + total +
    " (" + pct + "%) " + name;
}

// ================================================================
// レイヤ描画
// ================================================================

function renderStaticLayers(code) {
  const data = prefData[code];
  const layers = prefLayers[code];

  // 市区町村境界
  if (data.muni) {
    L.geoJSON(data.muni, {
      style: { fill: false, color: "white", weight: 0.3, opacity: 0.5 }
    }).addTo(layers.muniLayer);
  }

  // 道県境界
  if (data.border) {
    L.geoJSON(data.border, {
      style: { fill: false, color: "#333", weight: 1.2, opacity: 0.8 }
    }).addTo(layers.borderLayer);
  }
}

function computeTravelMin(code) {
  const data = prefData[code];
  if (!data.loaded || !data.durMatrix) return null;

  // R jsonlite auto_unbox converts single-element vectors to scalars
  let colnames = data.durMatrix.colnames;
  if (!Array.isArray(colnames)) colnames = [colnames];
  const matrix = data.durMatrix.data;

  // 有効施設のインデックスを取得
  const activeIdx = [];
  colnames.forEach((name, i) => {
    if (activeFacilities.has(name)) activeIdx.push(i);
  });

  if (activeIdx.length === 0) return null;

  // 各メッシュについて最小所要時間を計算
  return matrix.map(row => {
    let minDur = Infinity;
    for (const i of activeIdx) {
      const v = row[i];
      if (v >= 0 && v < minDur) minDur = v;
    }
    return minDur === Infinity ? null : minDur / 60; // 秒→分
  });
}

function renderMeshLayer(code) {
  const data = prefData[code];
  const layers = prefLayers[code];
  if (!data.loaded) return;

  layers.meshLayer.clearLayers();

  const travelMin = computeTravelMin(code);
  if (!travelMin) return;

  const features = data.mesh.features;
  const geoData = {
    type: "FeatureCollection",
    features: features.map((f, i) => {
      const min = travelMin[i];
      if (min == null) return null;
      const cat = classifyTime(min);
      return {
        type: "Feature",
        geometry: f.geometry,
        properties: {
          population: f.properties.population,
          travel_min: Math.round(min * 10) / 10,
          color: TIME_COLORS[cat]
        }
      };
    }).filter(Boolean)
  };

  L.geoJSON(geoData, {
    style: f => ({
      fillColor: f.properties.color,
      fillOpacity: 0.75,
      color: f.properties.color,
      weight: 0.5,
      opacity: 0.75
    }),
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(
        feature.properties.travel_min + "分 / 人口" +
        formatNumber(feature.properties.population),
        { sticky: true }
      );
    }
  }).addTo(layers.meshLayer);
}

function renderMarkers(code) {
  const layers = prefLayers[code];
  layers.markerLayer.clearLayers();

  const prefFacilities = allFacilities.filter(f => f.pref_code === code);
  prefFacilities.forEach(f => {
    const isActive = activeFacilities.has(f.name);
    L.circleMarker([f.lat, f.lon], {
      radius: 6,
      fillColor: isActive ? "yellow" : "#999",
      color: "black",
      weight: 1,
      fillOpacity: isActive ? 1.0 : 0.3
    })
    .bindTooltip(f.name)
    .on("click", () => {
      if (activeFacilities.has(f.name)) {
        activeFacilities.delete(f.name);
      } else {
        activeFacilities.add(f.name);
      }
      syncCheckboxes();
      scheduleUpdate();
    })
    .addTo(layers.markerLayer);
  });
}

// ================================================================
// 集計テーブル
// ================================================================

function buildSummarySelect() {
  const sel = document.getElementById("summaryPrefSelect");
  if (!sel) return;

  let html = '<option value="all">全道県</option>';
  prefectures.forEach(p => {
    const selected = p.code === summaryPrefCode ? " selected" : "";
    html += '<option value="' + p.code + '"' + selected + '>' + p.name + '</option>';
  });
  sel.innerHTML = html;

  sel.addEventListener("change", function () {
    summaryPrefCode = this.value;
    updateSummaryTable();
  });
}

function updateSummaryTable() {
  const bins = TIME_LABELS.map(() => ({ count: 0, pop: 0 }));
  let totalPop = 0;

  const targetPrefs = summaryPrefCode === "all"
    ? prefectures
    : prefectures.filter(p => p.code === summaryPrefCode);

  targetPrefs.forEach(p => {
    const data = prefData[p.code];
    if (!data.loaded) return;

    const travelMin = computeTravelMin(p.code);
    if (!travelMin) return;

    const features = data.mesh.features;
    travelMin.forEach((min, i) => {
      if (min == null) return;
      const cat = classifyTime(min);
      const pop = features[i].properties.population || 0;
      bins[cat].count++;
      bins[cat].pop += pop;
      totalPop += pop;
    });
  });

  const tbody = document.querySelector("#summaryTable tbody");
  tbody.innerHTML = "";
  let cumPop = 0;

  bins.forEach((bin, i) => {
    cumPop += bin.pop;
    const pct = totalPop > 0 ? (bin.pop / totalPop * 100) : 0;
    const cumPct = totalPop > 0 ? (cumPop / totalPop * 100) : 0;

    const tr = document.createElement("tr");
    tr.className = "pct-bar";
    tr.style.setProperty("--bar-w", pct + "%");
    tr.innerHTML =
      '<td style="color:' + TIME_COLORS[i] + ';font-weight:bold">' + TIME_LABELS[i] + "</td>" +
      "<td>" + formatNumber(bin.count) + "</td>" +
      "<td>" + formatNumber(bin.pop) + "</td>" +
      "<td>" + pct.toFixed(1) + "</td>" +
      "<td>" + cumPct.toFixed(1) + "</td>";
    tbody.appendChild(tr);
  });
}

// ================================================================
// サイドバー
// ================================================================

function buildSidebar() {
  const sidebar = document.getElementById("sidebar");

  // ヘッダー
  let html = '<h3>施設選択</h3>';
  html += '<div class="active-count" id="activeCount"></div>';
  html += '<div class="toggle-links">';
  html += '<a onclick="selectAll()">全選択</a> / ';
  html += '<a onclick="deselectAll()">全解除</a>';
  html += '</div><hr>';

  // 道県ごとのセクション
  prefectures.forEach(p => {
    const prefFac = allFacilities.filter(f => f.pref_code === p.code);
    html += '<div class="pref-section">';
    html += '<div class="pref-header" onclick="togglePrefSection(\'' + p.code + '\')">';
    html += '<span><span class="arrow" id="arrow_' + p.code + '">&#9654;</span> ';
    html += p.name + ' (' + prefFac.length + ')</span>';
    html += '<span class="pref-links">';
    html += '<a onclick="event.stopPropagation();selectPref(\'' + p.code + '\')">全</a>';
    html += '<a onclick="event.stopPropagation();deselectPref(\'' + p.code + '\')">解</a>';
    html += '</span>';
    html += '</div>';

    html += '<div class="fac-list" id="facList_' + p.code + '">';
    prefFac.forEach(f => {
      const checked = activeFacilities.has(f.name) ? "checked" : "";
      html += '<label><input type="checkbox" ' + checked +
              ' data-fac="' + escapeHtml(f.name) + '" onchange="onFacToggle(this)">' +
              escapeHtml(f.name) + '</label>';
    });
    if (prefFac.length === 0) {
      html += '<div style="color:#999;font-size:12px;padding:4px 0">施設データなし</div>';
    }
    html += '</div></div>';
  });

  // 出典
  html += '<hr><div class="credit-box">';
  html += '<h4>出典 <a onclick="showDisclaimer()" style="font-weight:normal;font-size:11px;color:#2166ac;cursor:pointer">（詳細はこちら）</a></h4><ul>';
  html += '<li>人口: 令和2年国勢調査 (e-Stat)</li>';
  html += '<li>道路: &copy; OpenStreetMap contributors</li>';
  html += '<li>経路計算: OSRM</li>';
  html += '<li>行政境界: GADM v4.1</li>';
  html += '<li>地図: 国土地理院</li>';
  html += '</ul></div>';

  sidebar.innerHTML = html;
  updateActiveCount();
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
}

function togglePrefSection(code) {
  const list = document.getElementById("facList_" + code);
  const arrow = document.getElementById("arrow_" + code);
  list.classList.toggle("open");
  arrow.classList.toggle("open");
}

function onFacToggle(el) {
  const name = el.dataset.fac;
  if (el.checked) {
    activeFacilities.add(name);
  } else {
    activeFacilities.delete(name);
  }
  updateActiveCount();
  scheduleUpdate();
}

function selectAll() {
  allFacilities.forEach(f => activeFacilities.add(f.name));
  syncCheckboxes();
  scheduleUpdate();
}

function deselectAll() {
  activeFacilities.clear();
  syncCheckboxes();
  scheduleUpdate();
}

function selectPref(code) {
  allFacilities.filter(f => f.pref_code === code)
    .forEach(f => activeFacilities.add(f.name));
  syncCheckboxes();
  scheduleUpdate();
}

function deselectPref(code) {
  allFacilities.filter(f => f.pref_code === code)
    .forEach(f => activeFacilities.delete(f.name));
  syncCheckboxes();
  scheduleUpdate();
}

function syncCheckboxes() {
  document.querySelectorAll('.fac-list input[type="checkbox"]').forEach(el => {
    el.checked = activeFacilities.has(el.dataset.fac);
  });
  updateActiveCount();
}

function updateActiveCount() {
  const el = document.getElementById("activeCount");
  if (el) el.textContent = "有効施設: " + activeFacilities.size + " / " + allFacilities.length;
}

// ================================================================
// 地図初期化
// ================================================================

function initMap() {
  map = L.map("map", { preferCanvas: true });

  // 初期表示: 北海道全域
  map.fitBounds([[41.3, 139.3], [45.6, 145.9]]);

  // 国土地理院淡色地図
  L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>',
    maxZoom: 18
  }).addTo(map);

  // 各道県のレイヤグループをmapに追加
  prefectures.forEach(p => {
    const layers = prefLayers[p.code];
    layers.meshLayer.addTo(map);
    layers.muniLayer.addTo(map);
    layers.borderLayer.addTo(map);
    layers.markerLayer.addTo(map);
  });

  // 凡例
  addLegend();
}

function addLegend() {
  const legend = L.control({ position: "bottomright" });
  legend.onAdd = function () {
    const div = L.DomUtil.create("div", "info legend");
    div.style.cssText = "background:#fff;padding:8px 12px;border-radius:4px;" +
      "box-shadow:0 1px 4px rgba(0,0,0,0.3);font-size:12px;line-height:1.6;";
    div.innerHTML = "<b>最寄り施設への<br>所要時間</b><br>";
    TIME_LABELS.forEach((label, i) => {
      div.innerHTML +=
        '<i style="background:' + TIME_COLORS[i] +
        ';width:14px;height:14px;display:inline-block;margin-right:4px;' +
        'vertical-align:middle;border:1px solid #ccc"></i>' + label + "<br>";
    });
    return div;
  };
  legend.addTo(map);
}

// ================================================================
// 更新制御
// ================================================================

function scheduleUpdate() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(updateAllLayers, 200);
}

function updateAllLayers() {
  for (const p of prefectures) {
    if (!prefData[p.code].loaded) continue;
    renderMeshLayer(p.code);
    renderMarkers(p.code);
  }
  updateSummaryTable();
}

// ================================================================
// 免責事項モーダル
// ================================================================

function initDisclaimer() {
  const check = document.getElementById("agreeCheck");
  const btn = document.getElementById("agreeBtn");
  const closeBtn = document.getElementById("closeBtn");
  const modal = document.getElementById("disclaimerModal");

  check.addEventListener("change", () => {
    btn.classList.toggle("enabled", check.checked);
  });

  btn.addEventListener("click", () => {
    if (check.checked) {
      modal.classList.add("hidden");
    }
  });

  closeBtn.addEventListener("click", () => {
    modal.classList.add("hidden");
  });
}

function showDisclaimer() {
  const modal = document.getElementById("disclaimerModal");
  document.getElementById("agreeSection").classList.add("hidden");
  document.getElementById("closeSection").classList.remove("hidden");
  modal.classList.remove("hidden");
}

// ================================================================
// 起動
// ================================================================

(async function main() {
  initDisclaimer();

  try {
    await loadInitialData();
    buildSidebar();
    buildSummarySelect();
    initMap();

    // 全道県のデータを並行読み込み（進捗表示あり）
    const loadPromises = prefectures.map(p => loadPrefectureData(p.code));
    await Promise.all(loadPromises);

    // 描画フェーズ: UIスレッドをブロックしないよう1道県ずつ描画
    const overlay = document.getElementById("loadingOverlay");
    overlay.textContent = "描画中...";

    for (let i = 0; i < prefectures.length; i++) {
      const p = prefectures[i];
      if (!prefData[p.code].loaded) continue;
      overlay.textContent = "描画中... " + (i + 1) + "/" + prefectures.length +
        " " + p.name;
      // 各道県の描画前にUIを更新する機会を与える
      await new Promise(r => setTimeout(r, 0));
      try {
        renderMeshLayer(p.code);
        renderMarkers(p.code);
      } catch (e) {
        console.warn("Render error for " + p.code + ":", e);
      }
    }

    updateSummaryTable();
  } catch (e) {
    console.error("Startup error:", e);
  } finally {
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) overlay.classList.add("hidden");
  }
})();
