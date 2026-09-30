(() => {
  'use strict';

  const DATA_ROOT = 'assets/brand/otop/';
  const MAP_URL = DATA_ROOT + 'map/isan-provinces.geojson';
  const CATALOG_URL = '/.netlify/functions/otop-province-catalog';
  const VIEW = { width: 760, height: 870, pad: 28 };
  const INITIAL_PROVINCE_ID = 'chaiyaphum';
  const SHAPE_TO_PROVINCE_ID = {
    'Chaiyaphum Province': 'chaiyaphum',
    'Khon Kaen Province': 'khonkaen',
    'Buri Ram Province': 'buriram',
    'Surin Province': 'surin',
    'Si Sa Ket Province': 'sisaket',
    'Nakhon Ratchasima Province': 'nakhonratchasima',
    'Roi Et Province': 'roiet',
    'Maha Sarakham Province': 'mahasarakham',
    Kalasin: 'kalasin',
    'Sakon Nakhon Province': 'sakonnakhon',
    'Nakhon Phanom Province': 'nakhonphanom',
    'Mukdahan Province': 'mukdahan',
    'Yasothon Province': 'yasothon',
    'Amnat Charoen Province': 'amnatcharoen',
    'Ubon Ratchathani Province': 'ubonratchathani',
    'Udon Thani Province': 'udonthani',
    'Nong Khai Province': 'nongkhai',
    'Bueng Kan Province': 'buengkan',
    'Loei Province': 'loei',
    'Nong Bua Lam Phu Province': 'nongbualamphu',
  };

  const svg = document.getElementById('isanMap');
  const loading = document.getElementById('mapLoading');
  const quickList = document.getElementById('provinceQuickList');
  const panel = document.getElementById('provincePanel');
  let state = {
    geo: null,
    provinces: [],
    selectedProvinceId: INITIAL_PROVINCE_ID,
    project: null,
  };

  function element(name, attributes = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function coordinatesOf(geometry) {
    if (geometry.type === 'Polygon') return geometry.coordinates.flat();
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
    return [];
  }

  function makeProject(features) {
    const points = features.flatMap(feature => coordinatesOf(feature.geometry));
    const longitudes = points.map(point => point[0]);
    const latitudes = points.map(point => point[1]);
    const bounds = {
      minX: Math.min(...longitudes), maxX: Math.max(...longitudes),
      minY: Math.min(...latitudes), maxY: Math.max(...latitudes)
    };
    const usableWidth = VIEW.width - VIEW.pad * 2;
    const usableHeight = VIEW.height - VIEW.pad * 2;
    const scale = Math.min(usableWidth / (bounds.maxX - bounds.minX), usableHeight / (bounds.maxY - bounds.minY));
    const drawnWidth = (bounds.maxX - bounds.minX) * scale;
    const drawnHeight = (bounds.maxY - bounds.minY) * scale;
    const offsetX = (VIEW.width - drawnWidth) / 2;
    const offsetY = (VIEW.height - drawnHeight) / 2;
    return ([longitude, latitude]) => [
      offsetX + (longitude - bounds.minX) * scale,
      offsetY + (bounds.maxY - latitude) * scale
    ];
  }

  function geometryPath(geometry, project) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.map(polygon => polygon.map(ring => ring.map((point, index) => {
      const [x, y] = project(point);
      return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join('') + 'Z').join('')).join('');
  }

  function provinceFor(provinceId) {
    return state.provinces.find(province => province.provinceId === provinceId);
  }

  function provinceIdForFeature(feature) {
    return SHAPE_TO_PROVINCE_ID[feature.properties.shapeName];
  }

  function featureFor(provinceId) {
    return state.geo.features.find(feature => provinceIdForFeature(feature) === provinceId);
  }

  function renderMap() {
    svg.replaceChildren();
    const selectedFeature = featureFor(state.selectedProvinceId);
    if (!selectedFeature) return;

    const defs = element('defs');
    const selectedGradient = element('linearGradient', {
      id: 'selectedProvinceGradient', x1: '0', y1: '0', x2: '1', y2: '1'
    });
    selectedGradient.append(
      element('stop', { offset: '0%', 'stop-color': '#a95027' }),
      element('stop', { offset: '100%', 'stop-color': '#6a2e07' })
    );
    defs.append(selectedGradient);
    svg.append(defs);

    const shapeGroup = element('g');
    state.geo.features.forEach(feature => {
      const provinceId = provinceIdForFeature(feature);
      const province = provinceFor(provinceId);
      if (!province) return;
      const path = element('path', {
        d: geometryPath(feature.geometry, state.project),
        fill: provinceId === state.selectedProvinceId ? 'url(#selectedProvinceGradient)' : '#d9cdb9',
        stroke: '#fff8eb',
        'stroke-width': '2.2',
        'vector-effect': 'non-scaling-stroke',
        'fill-rule': 'evenodd',
        tabindex: '0',
        role: 'button',
        'aria-label': `${province.provinceName}: ${province.experienceTitle}`,
        class: `province-shape${provinceId === state.selectedProvinceId ? ' is-selected' : ''}`,
        'data-province-id': provinceId
      });
      const title = element('title');
      title.textContent = `${province.provinceName} — ${province.experienceTitle}`;
      path.append(title);
      path.addEventListener('click', () => selectProvince(provinceId));
      path.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectProvince(provinceId);
        }
      });
      shapeGroup.append(path);
    });
    svg.append(shapeGroup);

    const selectedPathData = geometryPath(selectedFeature.geometry, state.project);
    svg.append(element('path', { d: selectedPathData, class: 'selected-outline', 'fill-rule': 'evenodd' }));
    svg.append(element('path', { d: selectedPathData, class: 'selected-inner-outline', 'fill-rule': 'evenodd' }));
  }

  function renderQuickList() {
    const provinces = [...state.provinces].sort((a, b) => a.sortOrder - b.sortOrder);
    quickList.replaceChildren(...provinces.map(province => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `province-chip${province.provinceId === state.selectedProvinceId ? ' is-selected' : ''}`;
      button.textContent = province.provinceName;
      button.dataset.provinceId = province.provinceId;
      button.setAttribute('aria-pressed', province.provinceId === state.selectedProvinceId ? 'true' : 'false');
      button.addEventListener('click', () => selectProvince(province.provinceId));
      return button;
    }));
    quickList.querySelector('.is-selected')?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  function renderPanel() {
    const province = provinceFor(state.selectedProvinceId);
    const paddedOrder = String(province.sortOrder).padStart(2, '0');
    panel.classList.add('is-changing');
    document.getElementById('provinceCount').textContent = paddedOrder;
    document.getElementById('provinceEn').textContent = `ประสบการณ์จังหวัด · ${paddedOrder}`;
    document.getElementById('provinceName').textContent = province.provinceName;
    document.getElementById('provinceExperienceTitle').textContent = province.experienceTitle;
    document.getElementById('provinceDescription').textContent = province.experienceDescription;
    document.getElementById('mapSelectedOrder').textContent = paddedOrder;
    document.getElementById('mapSelectedName').textContent = province.provinceName;

    const cta = document.getElementById('provinceCta');
    cta.textContent = `ดูสินค้าจาก${province.provinceName}`;
    cta.href = `otop.html?provinceId=${encodeURIComponent(province.provinceId)}`;
    requestAnimationFrame(() => panel.classList.remove('is-changing'));
  }

  function selectProvince(provinceId) {
    if (!provinceFor(provinceId)) return;
    state.selectedProvinceId = provinceId;
    renderMap();
    renderQuickList();
    renderPanel();
  }

  function syncAccountNavigation() {
    let signedIn = false;
    try { signedIn = Boolean(JSON.parse(localStorage.getItem('tamma_auth_session') || 'null')?.access_token); } catch (_) {}
    document.getElementById('loginLink').hidden = signedIn;
    document.getElementById('signupLink').hidden = signedIn;
    document.getElementById('accountLink').hidden = !signedIn;
  }

  async function initialise() {
    syncAccountNavigation();
    try {
      const [geoResponse, catalogResponse] = await Promise.all([
        fetch(MAP_URL),
        fetch(CATALOG_URL),
      ]);
      if (!geoResponse.ok || !catalogResponse.ok) throw new Error('Map data unavailable');
      const [geo, catalog] = await Promise.all([
        geoResponse.json(), catalogResponse.json(),
      ]);
      if (geo.features.length !== 20 || catalog.provinces.length !== 20) throw new Error('Incomplete province data');
      state.geo = geo;
      state.provinces = catalog.provinces;
      state.project = makeProject(geo.features);
      renderMap();
      renderQuickList();
      renderPanel();
      loading.hidden = true;
    } catch (error) {
      loading.hidden = false;
      loading.textContent = 'ไม่สามารถเปิดแผนที่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';
      console.error(error);
    }
  }

  initialise();
})();
