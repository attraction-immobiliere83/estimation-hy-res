let ventes = [];

// --- Réglages ---
const CSV_FILE = 'dvf_light.csv';
const SURFACE_TOL = 0.15;
const TERRAIN_TOL = 0.25;

// Anti-aberrations internes
const PRIX_M2_MIN = 800;
const PRIX_M2_MAX = 12000;

// Plafonds prix par type
const PRIX_MAX_APPART = 2000000;
const PRIX_MAX_MAISON = 5000000;

// ventes après 01/01/2023
const DATE_MIN = new Date('2023-01-01T00:00:00');

// --- Helpers ---
function normalizeHeader(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}
function toNumberFR(x) {
  if (x === undefined || x === null) return NaN;
  const s = x.toString().trim();
  if (!s) return NaN;
  return parseFloat(s.replace(/\s/g, "").replace(",", "."));
}
function parseDateSmart(s) {
  if (!s) return null;
  const t = s.trim();

  const m1 = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return new Date(`${m1[1]}-${m1[2]}-${m1[3]}T00:00:00`);

  const m2 = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return new Date(`${m2[3]}-${m2[2]}-${m2[1]}T00:00:00`);

  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}
function formatEuro(n) {
  if (!isFinite(n)) return "-";
  return `${Math.round(n).toLocaleString('fr-FR')} €`;
}
function formatInt(n) {
  if (!isFinite(n)) return "-";
  return Math.round(n).toLocaleString('fr-FR');
}
function formatM2(n) {
  if (!isFinite(n)) return "-";
  return `${Math.round(n).toLocaleString('fr-FR')} €/m²`;
}
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function mediane(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function percentile(arr, p) {
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}
function detectDelimiter(headerLine) {
  const candidates = [';', ',', '|'];
  const counts = candidates.map(d => ({ d, c: (headerLine.split(d).length - 1) }));
  counts.sort((a, b) => b.c - a.c);
  return counts[0].c > 0 ? counts[0].d : ',';
}
function dedupeComparables(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const key = [
      v.dateRaw || "",
      v.adresse || "",
      Math.round(v.prix || 0),
      Math.round(v.surface || 0)
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
function cleanComparables(list, type) {
  const prixMax = (type === "Appartement") ? PRIX_MAX_APPART : PRIX_MAX_MAISON;

  return list.filter(v => {
    if (!isFinite(v.prix) || !isFinite(v.surface)) return false;
    if (v.prix > prixMax) return false;

    const pm2 = v.prix / v.surface;
    if (!isFinite(pm2)) return false;
    if (pm2 < PRIX_M2_MIN || pm2 > PRIX_M2_MAX) return false;

    return true;
  });
}

// --- Affichage erreurs dans la zone résultats ---
function showErrorInResults(err) {
  console.error(err);
  const zone = document.getElementById('resultats');
  const mapDiv = document.getElementById('map');
  const meta = document.getElementById('meta');

  if (meta) meta.textContent = "";
  if (mapDiv) mapDiv.style.display = "none";
  if (zone) {
    zone.innerHTML = `
      <p class="hint">
        ⚠️ Une erreur JavaScript a empêché l'affichage des résultats.<br>
        Ouvre la console (F12) pour voir le détail.<br>
        <span style="color:#b91c1c;font-weight:800;">${(err && err.message) ? err.message : String(err)}</span>
      </p>
    `;
  }
}

// --- Gestion checkboxes pièces ---
function setupPiecesUI() {
  const any = document.querySelector('.pieceAny');
  const opts = Array.from(document.querySelectorAll('.pieceOpt'));
  if (!any || opts.length === 0) return;

  // Si aucune option cochée -> any actif
  if (!opts.some(o => o.checked)) any.checked = true;

  any.addEventListener('change', () => {
    if (any.checked) {
      for (const o of opts) o.checked = false;
    } else {
      if (!opts.some(o => o.checked)) any.checked = true;
    }
  });

  for (const o of opts) {
    o.addEventListener('change', () => {
      if (o.checked) {
        any.checked = false;
      } else {
        if (!opts.some(x => x.checked)) any.checked = true;
      }
    });
  }
}

function getPiecesSelected() {
  const any = document.querySelector('.pieceAny');
  const opts = Array.from(document.querySelectorAll('.pieceOpt'));
  const selected = opts
    .filter(o => o.checked)
    .map(o => parseInt(o.value, 10))
    .filter(n => Number.isInteger(n));
  const isAny = any ? any.checked : true;
  return { isAny, selected };
}

// --- Carte Leaflet ---
let map = null;
let layerGroup = null;

function ensureMap() {
  const mapDiv = document.getElementById('map');
  mapDiv.style.display = 'block';

  if (!map) {
    map = L.map('map', { scrollWheelZoom: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    layerGroup = L.layerGroup().addTo(map);
  }
}

function updateMap(subjectLat, subjectLon, rayonKm, points, showTerrain) {
  ensureMap();
  layerGroup.clearLayers();

  const homeIcon = L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:999px;background:#2563eb;border:3px solid white;box-shadow:0 6px 14px rgba(0,0,0,.18)"></div>`,
    iconSize: [14,14],
    iconAnchor: [7,7]
  });

  L.marker([subjectLat, subjectLon], { icon: homeIcon })
    .addTo(layerGroup)
    .bindPopup("Votre adresse")
    .openPopup();

  L.circle([subjectLat, subjectLon], {
    radius: rayonKm * 1000,
    color: "#2563eb",
    weight: 2,
    fillColor: "#2563eb",
    fillOpacity: 0.08
  }).addTo(layerGroup);

  const pts = points.slice(0, 120);

  for (const p of pts) {
    const distM = Math.round((p.dist || 0) * 1000);
    const pm2 = p.prix / p.surface;

    const terrainLine = (showTerrain && isFinite(p.surface_terrain))
      ? `<br>Terrain : ${formatInt(p.surface_terrain)} m²`
      : "";

    L.circleMarker([p.lat, p.lng], {
      radius: 6,
      color: "#dc2626",
      fillColor: "#dc2626",
      fillOpacity: 0.85,
      weight: 1
    })
    .addTo(layerGroup)
    .bindPopup(`
      <b>${p.adresse}</b><br>
      ${p.dateRaw || "-"}<br>
      ${formatEuro(p.prix)} • ${formatInt(p.surface)} m²${terrainLine} • ${formatM2(pm2)}<br>
      Distance : ${distM} m
    `);
  }

  const latlngs = [[subjectLat, subjectLon], ...pts.map(p => [p.lat, p.lng])];
  map.fitBounds(L.latLngBounds(latlngs).pad(0.22));
}

// --- Chargement CSV ---
const dataBadge = document.getElementById('dataBadge');

fetch(CSV_FILE)
  .then(r => {
    if (!r.ok) throw new Error(`CSV introuvable: ${CSV_FILE} (HTTP ${r.status})`);
    return r.text();
  })
  .then(text => {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV vide ou mal formé.");

    const delim = detectDelimiter(lines[0]);
    const headers = lines[0].split(delim).map(normalizeHeader);

    const idx = (names) => {
      for (const n of names) {
        const i = headers.indexOf(normalizeHeader(n));
        if (i !== -1) return i;
      }
      return -1;
    };

    const iPrix = idx(["valeur fonciere", "valeur_fonciere", "prix"]);
    const iType = idx(["type local", "type_local", "type"]);
    const iSurf = idx(["surface reelle bati", "surface_reelle_bati", "surface habitable", "surface_habitable"]);
    const iPieces = idx(["nombre pieces principales", "nombre_pieces_principales", "pieces", "nb pieces principales"]);
    const iTerr = idx(["surface terrain", "surface_terrain"]);
    const iLat  = idx(["latitude", "lat"]);
    const iLng  = idx(["longitude", "lon", "lng"]);

    const iNum = idx(["adresse numero", "adresse_numero", "numero"]);
    const iVoie = idx(["adresse nom de voie", "adresse_nom_de_voie", "voie"]);
    const iCP = idx(["code postal", "code_postal", "cp"]);
    const iVille = idx(["nom commune", "nom_commune", "commune", "ville"]);
    const iDate = idx(["date mutation", "date_mutation", "date"]);

    if ([iPrix, iType, iSurf, iLat, iLng].some(i => i === -1)) {
      throw new Error("Colonnes indispensables introuvables (prix/type/surface/lat/lng).");
    }

    ventes = lines.slice(1).map(line => {
      const cols = line.split(delim);

      const num = iNum !== -1 ? (cols[iNum] || "").trim() : "";
      const voie = iVoie !== -1 ? (cols[iVoie] || "").trim() : "";
      const cp = iCP !== -1 ? (cols[iCP] || "").trim() : "";
      const ville = iVille !== -1 ? (cols[iVille] || "").trim() : "";
      const dateRaw = iDate !== -1 ? (cols[iDate] || "").trim() : "";
      const dateObj = parseDateSmart(dateRaw);

      const adresseRue = `${num} ${voie}`.trim();
      const full = `${adresseRue}${cp ? `, ${cp}` : ""}${ville ? ` ${ville}` : ""}`.trim();

      return {
        prix: toNumberFR(cols[iPrix]),
        type: (cols[iType] || "").trim(),
        surface: toNumberFR(cols[iSurf]),
        pieces: iPieces !== -1 ? toNumberFR(cols[iPieces]) : NaN,
        surface_terrain: iTerr !== -1 ? toNumberFR(cols[iTerr]) : NaN,
        lat: toNumberFR(cols[iLat]),
        lng: toNumberFR(cols[iLng]),
        adresse: full || "-",
        dateRaw,
        dateObj
      };
    });

    dataBadge.textContent = `Données prêtes : ${ventes.length.toLocaleString('fr-FR')} lignes`;
    dataBadge.classList.remove('warn');
    dataBadge.classList.add('ok');
  })
  .catch(err => {
    console.error(err);
    dataBadge.textContent = `Erreur chargement données`;
    dataBadge.classList.add('warn');
  });

// --- Démarrage après DOM chargé ---
document.addEventListener('DOMContentLoaded', () => {
  setupPiecesUI();

  const form = document.getElementById('formEstimation');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();

    try {
      const adresse = document.getElementById('adresse').value.trim();
      const cp = document.getElementById('cp').value.trim();
      const ville = document.getElementById('ville').value.trim();

      const type = document.getElementById('type').value.trim();
      const surface = parseFloat(document.getElementById('surface').value);

      const { isAny: piecesAny, selected: piecesSelected } = getPiecesSelected();
      const filtrerPieces = (!piecesAny && piecesSelected.length > 0);

      const terrain = parseFloat(document.getElementById('terrain').value || "0");
      const rayonKm = parseFloat(document.getElementById('rayon').value);

      const zone = document.getElementById('resultats');
      const meta = document.getElementById('meta');
      const mapDiv = document.getElementById('map');

      if (!ventes || ventes.length === 0) {
        zone.innerHTML = `<p class="hint">Les données sont en cours de chargement. Attends 2–3 secondes et réessaie.</p>`;
        return;
      }
      if (!adresse || !cp || !ville || !isFinite(surface) || surface <= 0) {
        zone.innerHTML = `<p class="hint">Merci de remplir : adresse + code postal + ville + surface.</p>`;
        return;
      }

      // Géocodage BAN
      const query = `${adresse} ${cp} ${ville}`;
      const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=1`;
      const geoResp = await fetch(url);
      const geoData = await geoResp.json();

      if (!geoData.features || geoData.features.length === 0) {
        mapDiv.style.display = "none";
        zone.innerHTML = `<p class="hint">Adresse introuvable. Vérifie l’adresse, le code postal et la ville.</p>`;
        return;
      }

      const lon = geoData.features[0].geometry.coordinates[0];
      const lat = geoData.features[0].geometry.coordinates[1];

      const surfaceMin = surface * (1 - SURFACE_TOL);
      const surfaceMax = surface * (1 + SURFACE_TOL);

      const filtrerTerrain = (type === "Maison" && isFinite(terrain) && terrain > 0);
      const terrainMin = terrain * (1 - TERRAIN_TOL);
      const terrainMax = terrain * (1 + TERRAIN_TOL);

      let comps = [];

      for (const v of ventes) {
        if (v.type !== type) continue;
        if (!isFinite(v.prix) || !isFinite(v.surface) || !isFinite(v.lat) || !isFinite(v.lng)) continue;
        if (!(v.dateObj && v.dateObj >= DATE_MIN)) continue;

        if (v.surface < surfaceMin || v.surface > surfaceMax) continue;

        if (filtrerTerrain) {
          if (!isFinite(v.surface_terrain)) continue;
          if (v.surface_terrain < terrainMin || v.surface_terrain > terrainMax) continue;
        }

        if (filtrerPieces) {
          if (!isFinite(v.pieces)) continue;

          const wants6plus = piecesSelected.includes(6);
          const okPieces = wants6plus
            ? (piecesSelected.includes(Math.round(v.pieces)) || v.pieces >= 6)
            : piecesSelected.includes(Math.round(v.pieces));

          if (!okPieces) continue;
        }

        const d = distanceKm(lat, lon, v.lat, v.lng);
        if (d <= rayonKm) comps.push({ ...v, dist: d });
      }

      comps = dedupeComparables(comps);
      comps = cleanComparables(comps, type);

      if (comps.length === 0) {
        meta.textContent = "";
        mapDiv.style.display = "none";
        zone.innerHTML = `<p class="hint">Aucune vente comparable trouvée (après 01/01/2023). Essaie d’augmenter le rayon ou d’élargir les pièces (ex : 2 + 3 + 4).</p>`;
        return;
      }

      // Tri : surface d’abord, puis proximité pièces (léger), puis distance
      const scoreComparable = (v) => {
        const surfaceDiff = Math.abs(v.surface - surface) / surface;

        let piecesPenalty = 0;
        if (filtrerPieces && isFinite(v.pieces)) {
          const wants6plus = piecesSelected.includes(6);
          if (wants6plus && v.pieces >= 6) {
            piecesPenalty = 0;
          } else {
            const diffs = piecesSelected.map(p => Math.abs(v.pieces - p));
            const minDiff = diffs.length ? Math.min(...diffs) : 0;
            piecesPenalty = 0.02 * Math.min(minDiff, 4);
          }
        }

        const distPenalty = Math.min((v.dist || 0) / Math.max(rayonKm, 0.1), 1) * 0.02;
        return surfaceDiff + piecesPenalty + distPenalty;
      };

      comps = comps
        .map(v => ({ ...v, _score: scoreComparable(v) }))
        .sort((a, b) => (a._score - b._score) || (a.dist - b.dist));

      const top = comps.slice(0, 20);

      const prixM2 = comps.map(v => v.prix / v.surface).filter(x => isFinite(x));
      const moyenneM2 = prixM2.reduce((a, b) => a + b, 0) / prixM2.length;
      const medianeM2 = mediane(prixM2);
      const basM2 = percentile(prixM2, 0.10);
      const hautM2 = percentile(prixM2, 0.90);

      const estBasse = basM2 * surface;
      const estMoy = moyenneM2 * surface;
      const estMed = medianeM2 * surface;
      const estHaute = hautM2 * surface;

      const piecesTexte = filtrerPieces
        ? piecesSelected.map(p => (p === 6 ? "6+" : String(p))).join(", ")
        : "peu importe";

      const terrainTexte = filtrerTerrain
        ? ` • Terrain ${Math.round(terrainMin)}–${Math.round(terrainMax)} m²`
        : "";

      meta.textContent =
        `${type} • Rayon ${rayonKm} km • Surface ${Math.round(surfaceMin)}–${Math.round(surfaceMax)} m² • Pièces ${piecesTexte}${terrainTexte} • Après 01/01/2023`;

      const showTerrainColumn = (type === "Maison" && filtrerTerrain);

      const terrainHeader = showTerrainColumn ? `<th>Terrain</th>` : "";
      const terrainCell = (v) => showTerrainColumn
        ? `<td>${isFinite(v.surface_terrain) ? formatInt(v.surface_terrain) : "-"}</td>`
        : "";

      const rows = top.map(v => {
        const pm2 = v.prix / v.surface;
        const distM = Math.round(v.dist * 1000);
        return `
          <tr>
            <td>${v.dateRaw || "-"}</td>
            <td title="${v.adresse}">${v.adresse}</td>
            <td>${formatInt(v.surface)}</td>
            ${terrainCell(v)}
            <td>${isFinite(v.pieces) ? v.pieces : "-"}</td>
            <td>${formatEuro(v.prix)}</td>
            <td>${formatM2(pm2)}</td>
            <td>${distM} m</td>
          </tr>
        `;
      }).join("");

      zone.innerHTML = `
        <div class="kpis">
          <div class="kpi">
            <div class="label">Ventes comparables</div>
            <div class="value">${formatInt(comps.length)}</div>
            <div class="sub">Après 01/01/2023</div>
          </div>
          <div class="kpi">
            <div class="label">Prix moyen (au m²)</div>
            <div class="value">${formatM2(moyenneM2)}</div>
          </div>
          <div class="kpi">
            <div class="label">Prix médian (au m²)</div>
            <div class="value">${formatM2(medianeM2)}</div>
          </div>
          <div class="kpi">
            <div class="label">Fourchette de marché</div>
            <div class="value">${formatM2(basM2)} → ${formatM2(hautM2)}</div>
            <div class="sub">Bas/haut (10% → 90%)</div>
          </div>
        </div>

        <div class="kpis" style="margin-top:12px;">
          <div class="kpi">
            <div class="label">Estimation basse</div>
            <div class="value">${formatEuro(estBasse)}</div>
            <div class="sub">Calcul : ${formatM2(basM2)}</div>
          </div>
          <div class="kpi">
            <div class="label">Estimation moyenne</div>
            <div class="value">${formatEuro(estMoy)}</div>
            <div class="sub">Calcul : ${formatM2(moyenneM2)}</div>
          </div>
          <div class="kpi">
            <div class="label">Estimation médiane</div>
            <div class="value">${formatEuro(estMed)}</div>
            <div class="sub">Calcul : ${formatM2(medianeM2)}</div>
          </div>
          <div class="kpi">
            <div class="label">Estimation haute</div>
            <div class="value">${formatEuro(estHaute)}</div>
            <div class="sub">Calcul : ${formatM2(hautM2)}</div>
          </div>
        </div>

        <div class="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Adresse (n° + rue, CP, ville)</th>
                <th>Surface</th>
                ${terrainHeader}
                <th>Pièces</th>
                <th>Prix vendu</th>
                <th>Prix / m²</th>
                <th>Distance</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;

      updateMap(lat, lon, rayonKm, comps, showTerrainColumn);
    } catch (err) {
      showErrorInResults(err);
    }
  });
});