/* global google, turf */
let map, drawingManager, autocomplete;
let mode = 'add'; // 'add' | 'hole'
const addPolys = [];   // google.maps.Polygon[]
const holePolys = [];  // google.maps.Polygon[]

function initApp() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 10.491, lng: -66.903 }, // Caracas aprox
    zoom: 18,
    mapTypeId: 'hybrid', // híbrido: satélite + labels
    tilt: 0,
    streetViewControl: false,
    fullscreenControl: true,
    mapTypeControl: true
  });

  // Autocomplete (búsqueda)
  const input = document.getElementById('search');
  autocomplete = new google.maps.places.Autocomplete(input, {
    fields: ['geometry', 'name', 'formatted_address'],
  });
  autocomplete.bindTo('bounds', map);
  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (!place.geometry) return;
    if (place.geometry.viewport) map.fitBounds(place.geometry.viewport);
    else map.setCenter(place.geometry.location);
    if (map.getZoom() < 18) map.setZoom(18);
  });

  // Drawing Manager
  drawingManager = new google.maps.drawing.DrawingManager({
    drawingMode: google.maps.drawing.OverlayType.POLYGON,
    drawingControl: false,
    polygonOptions: polyStyle('add')
  });
  drawingManager.setMap(map);

  google.maps.event.addListener(drawingManager, 'overlaycomplete', (e) => {
    if (e.type !== google.maps.drawing.OverlayType.POLYGON) return;
    const poly = e.overlay;
    poly.setEditable(true);
    stylePolygon(poly, mode);

    (mode === 'add' ? addPolys : holePolys).push(poly);

    // Recalcular cuando se edite
    const path = poly.getPath();
    ['set_at', 'insert_at', 'remove_at'].forEach(evt =>
      google.maps.event.addListener(path, evt, updateStats)
    );

    updateStats();
  });

  // Controles
  document.getElementById('mode-add').onclick = () => {
    mode = 'add';
    drawingManager.setOptions({ polygonOptions: polyStyle('add') });
  };
  document.getElementById('mode-hole').onclick = () => {
    mode = 'hole';
    drawingManager.setOptions({ polygonOptions: polyStyle('hole') });
  };
  document.getElementById('undo').onclick = undoLast;
  document.getElementById('clear').onclick = clearAll;

  // Toggle tipo de mapa
  const toggle = document.getElementById('toggle-type');
  toggle.addEventListener('change', () => {
    map.setMapTypeId(toggle.checked ? 'satellite' : 'hybrid');
  });

  updateStats();
}

function polyStyle(kind) {
  return {
    fillColor: kind === 'add' ? '#22c55e' : '#ef4444',
    fillOpacity: 0.22,
    strokeColor: kind === 'add' ? '#22c55e' : '#ef4444',
    strokeOpacity: 0.95,
    strokeWeight: 2,
    zIndex: kind === 'add' ? 2 : 3
  };
}
function stylePolygon(poly, kind) { poly.setOptions(polyStyle(kind)); }

function undoLast() {
  const arr = mode === 'add' ? addPolys : holePolys;
  const poly = arr.pop();
  if (poly) poly.setMap(null);
  updateStats();
}

function clearAll() {
  [...addPolys, ...holePolys].forEach(p => p.setMap(null));
  addPolys.length = 0;
  holePolys.length = 0;
  updateStats();
}

// Conversión Google Polygon -> Turf Polygon
function googlePolygonToTurf(poly) {
  const path = poly.getPath().getArray().map(latLng => [latLng.lng(), latLng.lat()]);
  if (path.length < 3) return null;
  const first = path[0], last = path[path.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) path.push(first);
  return turf.polygon([path]);
}
function multiUnion(features) {
  if (!features.length) return null;
  let out = features[0];
  for (let i = 1; i < features.length; i++) {
    out = turf.union(out, features[i]) || out;
  }
  return out;
}

function updateStats() {
  const adds = addPolys.map(googlePolygonToTurf).filter(Boolean);
  const holes = holePolys.map(googlePolygonToTurf).filter(Boolean);

  let unionAdd = adds.length ? multiUnion(adds) : null;
  let unionHole = holes.length ? multiUnion(holes) : null;

  let net = unionAdd;
  if (unionAdd && unionHole) {
    try {
      net = turf.difference(unionAdd, unionHole) || null;
    } catch (e) {
      console.warn('difference error:', e);
    }
  }

  let areaM2 = 0;
  let perimeterM = 0;

  if (net) {
    areaM2 = turf.area(net);

    // Sumar perímetros de anillos exteriores
    const g = net.geometry || net;
    const rings = g.type === 'Polygon'
      ? [g.coordinates[0]]
      : g.type === 'MultiPolygon'
        ? g.coordinates.map(p => p[0])
        : [];
    rings.forEach(r => {
      const path = r.map(([lng, lat]) => new google.maps.LatLng(lat, lng));
      perimeterM += google.maps.geometry.spherical.computeLength(path);
    });
  }

  const m2 = areaM2;
  const ft2 = m2 * 10.7639;
  const acres = m2 / 4046.8564224;
  const m = perimeterM;
  const ft = m * 3.28084;

  document.getElementById('stats').innerHTML = `
    Área neta: ${m2.toFixed(2)} m² (${ft2.toFixed(0)} ft² | ${acres.toFixed(4)} acres)<br/>
    Perímetro neto: ${m.toFixed(2)} m (${ft.toFixed(2)} ft)<br/>
    Polígonos: ${addPolys.length} | Huecos: ${holePolys.length}
  `;
}

window.initApp = initApp;