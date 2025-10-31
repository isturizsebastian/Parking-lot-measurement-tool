// ========= Config =========
const MAPTILER_KEY = 'YOUR_MAPTILER_KEY';
const STYLE = 'hybrid'; // 'hybrid' o 'satellite'
const START_CENTER = [-74.0, 40.72]; // NYC aprox (lon, lat)
const START_ZOOM = 12;

// ========= Estado =========
let currentUnits = 'm2'; // 'm2' o 'ft2'
let mode = 'idle'; // 'idle' | 'draw-outer' | 'draw-hole' | 'modify'

// ========= Inicializar Mapa =========
const map = new maplibregl.Map({
  container: 'map',
  style: `https://api.maptiler.com/maps/${STYLE}/style.json?key=${MAPTILER_KEY}`,
  center: START_CENTER,
  zoom: START_ZOOM,
  attributionControl: true
});
map.addControl(new maplibregl.NavigationControl(), 'top-right');

// ========= Draw =========
const draw = new MapboxDraw({
  displayControlsDefault: false,
  controls: { polygon: false, trash: false },
  styles: [
    // Relleno polígono
    {
      id: 'gl-draw-polygon-fill',
      type: 'fill',
      filter: ['all',['==','$type','Polygon'],['!=','mode','static']],
      paint: { 'fill-color': '#4cc3ff', 'fill-opacity': 0.22 }
    },
    // Borde polígono
    {
      id: 'gl-draw-polygon-stroke-active',
      type: 'line',
      filter: ['all',['==','$type','Polygon'],['!=','mode','static']],
      paint: { 'line-color': '#4cc3ff', 'line-width': 2 }
    },
    // Vértices
    {
      id: 'gl-draw-polygon-and-line-vertex-halo-active',
      type: 'circle',
      filter: ['all',['==','meta','vertex'],['!=','mode','static']],
      paint: { 'circle-radius': 7, 'circle-color': '#fff' }
    },
    {
      id: 'gl-draw-polygon-and-line-vertex-active',
      type: 'circle',
      filter: ['all',['==','meta','vertex'],['!=','mode','static']],
      paint: { 'circle-radius': 5, 'circle-color': '#4cc3ff' }
    }
  ]
});
map.addControl(draw, 'top-left');

// ========= Utilidades =========
const fmt = (num, digits=2) => num.toLocaleString(undefined, { maximumFractionDigits: digits });

function computeMetrics() {
  const fc = draw.getAll();
  if (!fc || !fc.features || fc.features.length === 0) {
    return { areaM2: 0, perimeterM: 0 };
  }

  let totalArea = 0;     // m²
  let totalPerimeter = 0; // m

  fc.features.forEach(f => {
    if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
      // Área geodésica
      totalArea += turf.area(f);

      // Perímetro: suma longitudes de todos los anillos
      if (f.geometry.type === 'Polygon') {
        f.geometry.coordinates.forEach(ring => {
          const line = turf.lineString(ring);
          totalPerimeter += turf.length(line, { units: 'kilometers' }) * 1000.0;
        });
      } else if (f.geometry.type === 'MultiPolygon') {
        f.geometry.coordinates.forEach(polyCoords => {
          polyCoords.forEach(ring => {
            const line = turf.lineString(ring);
            totalPerimeter += turf.length(line, { units: 'kilometers' }) * 1000.0;
          });
        });
      }
    }
  });

  return { areaM2: Math.abs(totalArea), perimeterM: Math.abs(totalPerimeter) };
}

function updateMetricsUI() {
  const { areaM2, perimeterM } = computeMetrics();
  const areaEl = document.getElementById('areaValue');
  const perimEl = document.getElementById('perimeterValue');

  if (areaM2 <= 0) {
    areaEl.textContent = '—';
    perimEl.textContent = '—';
    return;
  }

  if (currentUnits === 'm2') {
    areaEl.textContent = `${fmt(areaM2, 0)} m²`;
  } else {
    const ft2 = areaM2 * 10.76391041671;
    areaEl.textContent = `${fmt(ft2, 0)} ft²`;
  }

  // Perímetro: mostrar en m o ft
  if (currentUnits === 'm2') {
    if (perimeterM < 1000) perimEl.textContent = `${fmt(perimeterM, 1)} m`;
    else perimEl.textContent = `${fmt(perimeterM/1000, 2)} km`;
  } else {
    const feet = perimeterM * 3.280839895;
    if (feet < 5280) perimEl.textContent = `${fmt(feet, 1)} ft`;
    else perimEl.textContent = `${fmt(feet/5280, 2)} mi`;
  }
}

function setMode(newMode) {
  mode = newMode;
  if (mode === 'draw-outer' || mode === 'draw-hole') {
    draw.changeMode('draw_polygon');
  } else if (mode === 'modify') {
    draw.changeMode('simple_select');
  } else {
    draw.changeMode('simple_select');
  }
}

// Añadir un anillo interior (hueco) a un polígono existente
function addHoleToContainingPolygon(holeFeature) {
  const fc = draw.getAll();
  if (!fc.features || fc.features.length === 0) return false;

  const holeGeom = holeFeature.geometry;
  if (!holeGeom || holeGeom.type !== 'Polygon') return false;

  // Usamos el centroide del hueco para identificar el polígono contenedor
  const holeCentroid = turf.centroid(holeFeature);

  // Buscar primer polígono que contenga el centroide
  let targetId = null;
  let targetFeature = null;
  for (const f of fc.features) {
    if (f.id === holeFeature.id) continue;
    if (f.geometry.type !== 'Polygon') continue;
    if (turf.booleanPointInPolygon(holeCentroid, f)) {
      targetId = f.id;
      targetFeature = f;
      break;
    }
  }

  if (!targetFeature) return false;

  // Asegurar que los anillos tengan orientación correcta (CCW exterior, CW interior)
  const rewoundTarget = turf.rewind(targetFeature, { reverse: false });
  const rewoundHole = turf.rewind(holeFeature, { reverse: true }); // invierte a CW si es necesario

  const targetCoords = rewoundTarget.geometry.coordinates.slice();
  const holeCoords = rewoundHole.geometry.coordinates[0];

  // Añadir el hole como un nuevo anillo interior
  targetCoords.push(holeCoords);

  // Actualizar el polígono en Draw
  draw.add({
    id: targetId + '_updated_' + Date.now(),
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: targetCoords }
  });

  // Eliminar el polígono antiguo y el hueco temporal
  try { draw.delete([targetId]); } catch (e) {}
  try { draw.delete([holeFeature.id]); } catch (e) {}

  return true;
}

// ========= Eventos de dibujo =========
map.on('draw.create', (e) => {
  if (mode === 'draw-hole') {
    // Intentar convertir el nuevo polígono en un anillo interior de un polígono existente
    const ok = addHoleToContainingPolygon(e.features[0]);
    if (!ok) {
      // Si no hubo contenedor, simplemente dejamos el polígono como independiente
      // o lo borramos si prefieres forzar que sea dentro de un polígono
      // draw.delete(e.features[0].id);
    }
  }
  updateMetricsUI();
});
map.on('draw.update', updateMetricsUI);
map.on('draw.delete', updateMetricsUI);
map.on('load', updateMetricsUI);

// ========= Controles UI =========
document.getElementById('drawOuterBtn').addEventListener('click', () => setMode('draw-outer'));
document.getElementById('drawHoleBtn').addEventListener('click', () => setMode('draw-hole'));
document.getElementById('modifyBtn').addEventListener('click', () => setMode('modify'));
document.getElementById('deleteBtn').addEventListener('click', () => {
  const sel = draw.getSelectedIds();
  if (sel.length) draw.delete(sel);
  else draw.trash();
  updateMetricsUI();
});

document.getElementById('unitsToggle').addEventListener('click', (e) => {
  currentUnits = currentUnits === 'm2' ? 'ft2' : 'm2';
  e.currentTarget.textContent = currentUnits === 'm2' ? 'm²' : 'ft²';
  updateMetricsUI();
});

// CTA demo
document.getElementById('ctaEstimate').addEventListener('click', (e) => {
  e.preventDefault();
  const payload = draw.getAll();
  console.log('Payload GeoJSON para propuesta:', payload);
  alert('GeoJSON del dibujo registrado en la consola. Integra aquí el flujo de “solicitar propuesta”.');
});

// ========= Búsqueda (Geocoding MapTiler) =========
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
let searchTimer = null;

function showResults(items) {
  searchResults.innerHTML = '';
  if (!items || !items.length) {
    searchResults.classList.remove('visible');
    return;
  }
  items.slice(0, 6).forEach(item => {
    const el = document.createElement('div');
    el.className = 'item';
    el.textContent = item.place_name || item.text || item.properties?.name || item.name;
    el.addEventListener('click', () => {
      searchResults.classList.remove('visible');
      searchInput.value = el.textContent;

      // Volar a bbox si existe, si no, al centro
      const bbox = item.bbox || item.properties?.bbox;
      if (bbox && bbox.length === 4) {
        map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, duration: 900 });
      } else if (item.center && item.center.length === 2) {
        map.flyTo({ center: item.center, zoom: 16, duration: 900 });
      }
    });
    searchResults.appendChild(el);
  });
  searchResults.classList.add('visible');
}

async function geocode(query) {
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${MAPTILER_KEY}&limit=6`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding failed');
  const data = await res.json();
  // Normalizamos un poco a objetos tipo Mapbox response
  const feats = (data.features || []).map(f => ({
    place_name: f.place_name,
    center: f.center,
    bbox: f.bbox,
    properties: f.properties || {}
  }));
  return feats;
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 3) {
    searchResults.classList.remove('visible');
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const items = await geocode(q);
      showResults(items);
    } catch (e) {
      console.error(e);
      searchResults.classList.remove('visible');
    }
  }, 250);
});

document.addEventListener('click', (e) => {
  if (!searchResults.contains(e.target) && e.target !== searchInput) {
    searchResults.classList.remove('visible');
  }
});