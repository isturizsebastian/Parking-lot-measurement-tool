// public/main.js
// GUI + Leaflet + Leaflet.draw + Turf.js + Búsqueda Nominatim

// --- Constantes de conversión ---
const M2_TO_FT2 = 10.76391041671;
const M_TO_FT = 3.280839895;

// --- Elementos del DOM ---
const infoEl = document.getElementById('info');
const btnClear = document.getElementById('btn-clear');
const unitSelect = document.getElementById('unit-select');
const areaValueEl = document.getElementById('area-value');
const perimeterValueEl = document.getElementById('perimeter-value');
const btnCopyArea = document.getElementById('btn-copy-area');

// Búsqueda
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const suggestionsEl = document.getElementById('search-suggestions');

// --- Estado en memoria ---
let lastAreaM2 = null;       // área en m²
let lastPerimeterM = null;   // perímetro en metros
let tempBoundaryLayer = null; // capa temporal para mostrar límites de resultados

// --- Inicialización del mapa ---
const map = L.map('map', { zoomControl: true }).setView([39.5, -98.35], 4);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// Capa para dibujos del usuario
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);

// Control de dibujo y edición
const drawControl = new L.Control.Draw({
  draw: {
    marker: false,
    circle: false,
    circlemarker: false,
    polyline: false,
    rectangle: false,
    polygon: {
      allowIntersection: false,
      showArea: false, // usamos Turf para el cálculo
      shapeOptions: {
        color: '#4f8cff',
        weight: 2,
        fillColor: '#4f8cff',
        fillOpacity: 0.15
      }
    }
  },
  edit: {
    featureGroup: drawnItems,
    remove: true
  }
});
map.addControl(drawControl);

// --- Utilidades de formato ---
function formatAreaByUnit(areaM2, unit) {
  if (areaM2 == null || isNaN(areaM2)) return '—';
  if (unit === 'ft2') {
    const v = areaM2 * M2_TO_FT2;
    return `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ft²`;
  }
  return `${areaM2.toLocaleString(undefined, { maximumFractionDigits: 2 })} m²`;
}
function formatPerimeterByUnit(perimeterM, unit) {
  if (perimeterM == null || isNaN(perimeterM)) return '—';
  if (unit === 'ft2') {
    const v = perimeterM * M_TO_FT;
    return `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ft`;
  }
  return `${perimeterM.toLocaleString(undefined, { maximumFractionDigits: 2 })} m`;
}
// Convierte Polygon a línea y calcula longitud geodésica en metros
function perimeterMetersFromPolygon(feature) {
  try {
    const line = turf.polygonToLine(feature); // anillo exterior
    const lengthM = turf.length(line, { units: 'meters' });
    return lengthM;
  } catch {
    return 0;
  }
}

// --- Render de resultados ---
function renderResults() {
  const unit = unitSelect.value; // 'm2' o 'ft2'
  areaValueEl.textContent = formatAreaByUnit(lastAreaM2, unit);
  perimeterValueEl.textContent = formatPerimeterByUnit(lastPerimeterM, unit);

  if (lastAreaM2 == null) {
    infoEl.textContent = 'Dibuja un polígono para medir el área y el perímetro.';
  } else {
    const areaTextBoth = `${lastAreaM2.toLocaleString(undefined, { maximumFractionDigits: 2 })} m² | ${(lastAreaM2 * M2_TO_FT2).toLocaleString(undefined, { maximumFractionDigits: 2 })} ft²`;
    const perimTextBoth = `${lastPerimeterM.toLocaleString(undefined, { maximumFractionDigits: 2 })} m | ${(lastPerimeterM * M_TO_FT).toLocaleString(undefined, { maximumFractionDigits: 2 })} ft`;
    infoEl.innerHTML = `Área: <strong>${areaTextBoth}</strong><br/>Perímetro: <strong>${perimTextBoth}</strong>`;
  }
}
function computeFromLayer(layer) {
  const gj = layer.toGeoJSON();
  const feature = gj.type === 'Feature' ? gj : { type: 'Feature', geometry: gj, properties: {} };
  lastAreaM2 = turf.area(feature);
  lastPerimeterM = perimeterMetersFromPolygon(feature);
  renderResults();
}

// --- Eventos de Leaflet Draw ---
map.on(L.Draw.Event.CREATED, (e) => {
  drawnItems.clearLayers();
  const layer = e.layer;
  drawnItems.addLayer(layer);
  computeFromLayer(layer);
});
map.on('draw:edited', (e) => {
  e.layers.eachLayer((layer) => {
    computeFromLayer(layer);
  });
});
map.on('draw:deleted', () => {
  lastAreaM2 = null;
  lastPerimeterM = null;
  renderResults();
});

// --- Interacciones del GUI ---
btnClear.addEventListener('click', () => {
  drawnItems.clearLayers();
  lastAreaM2 = null;
  lastPerimeterM = null;
  renderResults();
});
unitSelect.addEventListener('change', renderResults);
btnCopyArea.addEventListener('click', async () => {
  if (lastAreaM2 == null) return;
  const unit = unitSelect.value;
  const value = unit === 'ft2' ? (lastAreaM2 * M2_TO_FT2) : lastAreaM2;
  const textToCopy = `${value.toFixed(2)} ${unit === 'ft2' ? 'ft^2' : 'm^2'}`;
  try {
    await navigator.clipboard.writeText(textToCopy);
    btnCopyArea.textContent = 'Copiado';
  } catch {
    const ta = document.createElement('textarea');
    ta.value = textToCopy;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    btnCopyArea.textContent = 'Copiado';
  }
  setTimeout(() => (btnCopyArea.textContent = 'Copiar'), 1200);
});

// ---------------------------
// BÚSQUEDA CON NOMINATIM
// ---------------------------

// Debounce helper
function debounce(fn, delay = 350) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

// Construir URL de Nominatim
function makeNominatimUrl(q) {
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    polygon_geojson: '1',
    limit: '5'
  });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

// Renderizar sugerencias
function showSuggestions(items) {
  suggestionsEl.innerHTML = '';
  if (!items || items.length === 0) {
    suggestionsEl.classList.remove('show');
    return;
  }
  items.forEach((it, idx) => {
    const li = document.createElement('li');
    li.role = 'option';
    li.dataset.index = String(idx);
    li.textContent = it.display_name;
    li.addEventListener('click', () => selectSuggestion(it));
    suggestionsEl.appendChild(li);
  });
  // Posición básica debajo del input
  const rect = searchInput.getBoundingClientRect();
  suggestionsEl.style.position = 'absolute';
  suggestionsEl.style.left = `${rect.left}px`;
  suggestionsEl.style.top = `${rect.bottom + window.scrollY + 4}px`;
  suggestionsEl.style.width = `${rect.width + 110}px`; // ancho aprox considerando el botón
  suggestionsEl.classList.add('show');
}
function hideSuggestions() {
  suggestionsEl.classList.remove('show');
}

// Selección de una sugerencia
function selectSuggestion(item) {
  hideSuggestions();
  searchInput.value = item.display_name || '';

  // Limpiar capa temporal
  if (tempBoundaryLayer) {
    map.removeLayer(tempBoundaryLayer);
    tempBoundaryLayer = null;
  }

  // Si viene con polígono, muéstralo
  if (item.geojson && (item.geojson.type === 'Polygon' || item.geojson.type === 'MultiPolygon')) {
    tempBoundaryLayer = L.geoJSON(item.geojson, {
      style: { color: '#22c55e', weight: 2, fillOpacity: 0.1 }
    }).addTo(map);
    map.fitBounds(tempBoundaryLayer.getBounds(), { padding: [20, 20] });
  } else if (item.boundingbox) {
    // boundingbox: [south, north, west, east] en string
    const [s, n, w, e] = item.boundingbox.map(parseFloat);
    const bounds = L.latLngBounds([s, w], [n, e]);
    map.fitBounds(bounds, { padding: [20, 20] });
  } else if (item.lat && item.lon) {
    map.flyTo([parseFloat(item.lat), parseFloat(item.lon)], 16);
  }
}

// Ejecutar búsqueda
async function performSearch(q) {
  if (!q || q.trim().length < 3) {
    hideSuggestions();
    return;
  }
  try {
    // Nominatim requiere un User-Agent y referer válidos; los navegadores ya envían referer.
    const url = makeNominatimUrl(q.trim());
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });
    if (!res.ok) throw new Error('Error en la búsqueda');
    const data = await res.json();
    showSuggestions(data);
  } catch (e) {
    console.warn('Búsqueda fallida:', e);
    hideSuggestions();
  }
}

// Eventos de búsqueda
const debouncedSearch = debounce(() => performSearch(searchInput.value), 350);

searchInput.addEventListener('input', debouncedSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    performSearch(searchInput.value);
  } else if (e.key === 'Escape') {
    hideSuggestions();
  }
});
searchBtn.addEventListener('click', () => performSearch(searchInput.value));

// Ocultar sugerencias si se hace click fuera
document.addEventListener('click', (e) => {
  if (!suggestionsEl.contains(e.target) && e.target !== searchInput) {
    hideSuggestions();
  }
});

// Render inicial
renderResults();