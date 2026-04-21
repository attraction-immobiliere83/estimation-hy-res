let ventes = [];

const CSV_FILE = 'https://cdn.jsdelivr.net/gh/attraction-immobiliere83/estimation-hy-res@main/dvf_light.csv';
const SURFACE_TOL = 0.15;
const TERRAIN_TOL = 0.20;

const PRIX_M2_MIN = 800;
const PRIX_M2_MAX = 12000;

const PRIX_MAX_APPART = 2000000;
const PRIX_MAX_MAISON = 5000000;

const DATE_MIN = new Date('2023-01-01T00:00:00');

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
    const key = [v.dateRaw || "", v.adresse || "", Math.round(v.prix || 0), Math.round(v.surface || 0)].join("|");
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

/* --- Carte --- */
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
function updateMap(subjectLat, subjectLon, rayonKm, points) {
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
      ${formatEuro(p.prix)} • ${formatInt(p.surface)} m² • ${formatM2(pm2)}<br>
      Distance : ${distM} m
    `);
  }

  const latlngs = [[subjectLat, subjectLon], ...pts.map(p => [p.lat, p.lng])];
  map.fitBounds(L.latLngBounds(latlngs).pad(0.22));
}

/* --- Chargement CSV --- */
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

    const iPrix = idx(["valeur fonciere","valeur_fonciere","prix"]);
    const iType = idx(["type local","type_local","type"]);
    const iSurf = idx(["surface reelle bati","surface_reelle_bati","surface habitable","surface_habitable"]);
    const iPieces = idx(["nombre pieces principales","nombre_pieces_principales","pieces"]);
    const iTerr = idx(["surface terrain","surface_terrain"]);
    const iLat  = idx(["latitude","lat"]);
    const iLng  = idx(["longitude","lon","lng"]);

    const iNum = idx(["adresse numero","adresse_numero","numero"]);
    const iVoie = idx(["adresse nom de voie","adresse_nom_de_voie","adresse nom voie","adresse_nom_voie","voie"]);
    const iCP = idx(["code postal","code_postal","cp"]);
    const iVille = idx(["nom commune","nom_commune","commune","ville"]);
    const iDate = idx(["date mutation","date_mutation","date"]);

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
      let full = `${adresseRue}${cp ? `, ${cp}` : ""}${ville ? ` ${ville}` : ""}`.trim();
      if (!voie) {
        const base = `${num || ""}${cp ? `, ${cp}` : ""}${ville ? ` ${ville}` : ""}`.trim();
        full = `${base} (adresse partielle)`.trim();
      }

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
    dataBadge.textContent = `Erreur : ${err.message}`;
    dataBadge.classList.add('warn');
  });

/* --- Estimation --- */
document.getElementById('formEstimation').addEventListener('submit', async function (e) {
  e.preventDefault();

  const btn = e.target.querySelector('button');
  const originalBtnText = btn.textContent;
  
  // 1. Récupération des entrées
  const rue = document.getElementById('adresse').value;
  const cp = document.getElementById('cp').value;
  const ville = document.getElementById('ville').value;
  const typeBien = document.getElementById('type').value;
  const surfaceSaisie = parseFloat(document.getElementById('surface').value);
  const terrainSaisi = parseFloat(document.getElementById('terrain').value) || 0;
  const rayonKm = parseFloat(document.getElementById('rayon').value);
  const piecesChoisies = getPiecesSelectionnees(); // Fonction de ton index.html

  const resDiv = document.getElementById('resultats');
  const metaDiv = document.getElementById('meta');

  try {
    btn.disabled = true;
    btn.textContent = "Localisation en cours...";
    resDiv.innerHTML = '<p class="hint">Recherche des coordonnées GPS...</p>';

    // 2. Géocodage (Adresse -> GPS)
    const query = encodeURIComponent(`${rue} ${cp} ${ville}`);
    const geoRes = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${query}&limit=1`);
    const geoData = await geoRes.json();

    if (!geoData.features || geoData.features.length === 0) {
      throw new Error("Désolé, nous n'avons pas trouvé cette adresse précise.");
    }

    const [lon, lat] = geoData.features[0].geometry.coordinates;
    btn.textContent = "Analyse du marché...";

    // 3. Filtrage des ventes CSV
    let localVentes = ventes.filter(v => {
      // Filtre Type (Maison / Appartement)
      if (v.type !== typeBien) return false;

      // Filtre Distance
      const d = distanceKm(lat, lon, v.lat, v.lng);
      if (d > rayonKm) return false;
      v.dist = d; // On stocke la distance pour le tri

      // Filtre Surface (±15%)
      if (v.surface < surfaceSaisie * (1 - SURFACE_TOL) || v.surface > surfaceSaisie * (1 + SURFACE_TOL)) return false;

      // Filtre Terrain (±20% si c'est une maison)
      if (typeBien === "Maison" && terrainSaisi > 0) {
        if (v.surface_terrain < terrainSaisi * (1 - TERRAIN_TOL) || v.surface_terrain > terrainSaisi * (1 + TERRAIN_TOL)) return false;
      }

      return true;
    });

    // Nettoyage final
    localVentes = dedupeComparables(localVentes);
    localVentes = cleanComparables(localVentes, typeBien);
    localVentes.sort((a, b) => a.dist - b.dist);

    // 4. Affichage des résultats
    if (localVentes.length === 0) {
      resDiv.innerHTML = `<p class="hint" style="color:#dc2626;">Aucune vente similaire trouvée à proximité. Essayez d'augmenter le rayon de recherche.</p>`;
      metaDiv.textContent = "";
    } else {
      const prixM2Array = localVentes.map(v => v.prix / v.surface);
      const moy = prixM2Array.reduce((a, b) => a + b, 0) / prixM2Array.length;

      metaDiv.innerHTML = `<strong>${localVentes.length}</strong> ventes comparables trouvées.`;
      
      let html = `
        <div class="kpis">
          <div class="kpi"><div class="klabel">Prix m² moyen</div><div class="kvalue">${formatM2(moy)}</div></div>
          <div class="kpi"><div class="klabel">Estimation conseillée</div><div class="kvalue">${formatEuro(moy * surfaceSaisie)}</div></div>
        </div>
        <div class="tableWrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Adresse</th><th>Surface</th><th>Prix</th><th>Dist.</th></tr>
            </thead>
            <tbody>
      `;

      localVentes.slice(0, 10).forEach(v => {
        html += `
          <tr>
            <td>${v.dateRaw}</td>
            <td>${v.adresse}</td>
            <td>${v.surface} m²</td>
            <td><strong>${formatEuro(v.prix)}</strong></td>
            <td>${Math.round(v.dist * 1000)}m</td>
          </tr>
        `;
      });
      html += `</tbody></table></div>`;
      resDiv.innerHTML = html;

      // Mise à jour de la carte
      updateMap(lat, lon, rayonKm, localVentes);
    }

  } catch (err) {
    resDiv.innerHTML = `<p class="hint" style="color:#dc2626;">${err.message}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = originalBtnText;
  }
});
