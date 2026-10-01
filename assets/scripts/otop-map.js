(() => {
  'use strict';

  const DATA_ROOT = 'assets/brand/otop/';
  const MAP_URL = DATA_ROOT + 'map/isan-provinces.geojson';
  const MANIFEST_URL = DATA_ROOT + 'province-hero/province-hero-manifest.json';
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

  const i18n = window.OtopI18n;
  const t = (key, vars) => i18n ? i18n.t(key, vars) : key;
  const provinceLabel = province => i18n ? i18n.provinceName(province.provinceId) : province.provinceName;
  const localizedExperience = province => {
    if (!i18n || i18n.lang() === 'th') {
      return { title: province.experienceTitle, description: province.experienceDescription };
    }
    const name = provinceLabel(province);
    return {
      title: t('map_generic_title', { name }),
      description: t('map_generic_desc', { name }),
    };
  };

  const svg = document.getElementById('isanMap');
  const loading = document.getElementById('mapLoading');
  const quickList = document.getElementById('provinceQuickList');
  const panel = document.getElementById('provincePanel');
  let state = {
    geo: null,
    heroItems: [],
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

  function geometryBounds(geometry, project) {
    const points = coordinatesOf(geometry).map(project);
    const xs = points.map(point => point[0]);
    const ys = points.map(point => point[1]);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
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

  function heroUrlFor(province) {
    const hero = state.heroItems.find(item => item.provinceTh === province.provinceName);
    return hero ? DATA_ROOT + 'province-hero/' + hero.web : (province.heroProductImage || province.heroImage || '');
  }

  function applyStaticCopy() {
    if (!i18n) return;
    document.title = t('map_page_title');
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.content = t('map_meta');
    const skip = document.querySelector('.skip-link'); if (skip) skip.textContent = t('map_skip');
    const brand = document.querySelector('.brand-lockup'); if (brand) brand.setAttribute('aria-label', t('map_back'));
    const login = document.getElementById('loginLink'); if (login) login.textContent = t('login');
    const signup = document.getElementById('signupLink'); if (signup) signup.textContent = t('signup');
    const account = document.getElementById('accountLink'); if (account) account.textContent = t('account');
    const overline = document.querySelector('.map-overline'); if (overline) overline.textContent = t('map_overline');
    const title = document.getElementById('mapTitle'); if (title) title.textContent = t('map_title');
    const intro = document.querySelector('.map-card-head > div:first-child > p'); if (intro) intro.textContent = t('map_intro');
    const legend = document.querySelector('.map-legend'); if (legend) legend.setAttribute('aria-label', t('map_legend_aria'));
    const legendSpans = document.querySelectorAll('.map-legend > span');
    if (legendSpans[0]) legendSpans[0].lastChild.textContent = t('map_selected');
    if (legendSpans[1]) legendSpans[1].lastChild.textContent = t('map_other');
    if (!loading.hidden) loading.textContent = t('map_loading');
    svg.setAttribute('aria-label', t('map_aria'));
    quickList.setAttribute('aria-label', t('map_quick_aria'));
    const story = document.querySelector('.province-story-label'); if (story) story.textContent = t('map_story_label');
    const concept = document.querySelector('.concept-note'); if (concept) concept.textContent = t('map_concept');
    const footer = document.querySelector('.map-footer p'); if (footer) footer.textContent = t('map_footer');
  }

  function renderMap() {
    svg.replaceChildren();
    const selectedFeature = featureFor(state.selectedProvinceId);
    if (!selectedFeature) return;

    const defs = element('defs');
    const selectedPathData = geometryPath(selectedFeature.geometry, state.project);
    const clip = element('clipPath', { id: 'selectedProvinceClip' });
    clip.append(element('path', { d: selectedPathData, 'fill-rule': 'evenodd' }));
    defs.append(clip);
    svg.append(defs);

    const shapeGroup = element('g');
    state.geo.features.forEach(feature => {
      const provinceId = provinceIdForFeature(feature);
      const province = provinceFor(provinceId);
      if (!province) return;
      const path = element('path', {
        d: geometryPath(feature.geometry, state.project),
        fill: provinceId === state.selectedProvinceId ? 'transparent' : '#d9cdb9',
        stroke: '#fff8eb',
        'stroke-width': '2.2',
        'vector-effect': 'non-scaling-stroke',
        'fill-rule': 'evenodd',
        tabindex: '0',
        role: 'button',
        'aria-label': `${provinceLabel(province)}: ${localizedExperience(province).title}`,
        class: `province-shape${provinceId === state.selectedProvinceId ? ' is-selected' : ''}`,
        'data-province-id': provinceId
      });
      const title = element('title');
      title.textContent = `${provinceLabel(province)} — ${localizedExperience(province).title}`;
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

    const province = provinceFor(state.selectedProvinceId);
    const heroUrl = heroUrlFor(province);
    if (heroUrl) {
      const bounds = geometryBounds(selectedFeature.geometry, state.project);
      const image = element('image', {
        href: heroUrl,
        x: bounds.x,
        y: bounds.y,
        width: Math.max(bounds.width, 1),
        height: Math.max(bounds.height, 1),
        preserveAspectRatio: 'xMidYMid slice',
        'clip-path': 'url(#selectedProvinceClip)',
        class: 'selected-image',
        'aria-hidden': 'true',
      });
      svg.append(image);
    }
    svg.append(element('path', { d: selectedPathData, class: 'selected-outline', 'fill-rule': 'evenodd' }));
    svg.append(element('path', { d: selectedPathData, class: 'selected-inner-outline', 'fill-rule': 'evenodd' }));
  }

  function renderQuickList() {
    const provinces = [...state.provinces].sort((a, b) => a.sortOrder - b.sortOrder);
    quickList.replaceChildren(...provinces.map(province => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `province-chip${province.provinceId === state.selectedProvinceId ? ' is-selected' : ''}`;
      button.textContent = provinceLabel(province);
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
    const name = provinceLabel(province);
    const experience = localizedExperience(province);
    document.getElementById('provinceEn').textContent = t('map_province_header', { order: paddedOrder });
    document.getElementById('provinceName').textContent = name;
    document.getElementById('provinceExperienceTitle').textContent = experience.title;
    document.getElementById('provinceDescription').textContent = experience.description;
    document.getElementById('mapSelectedOrder').textContent = paddedOrder;
    document.getElementById('mapSelectedName').textContent = name;

    const cta = document.getElementById('provinceCta');
    cta.textContent = t('map_cta', { name });
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
    if (i18n) {
      i18n.mountSwitcher(document.querySelector('.account-nav'));
      applyStaticCopy();
    }
    try {
      const [geoResponse, manifestResponse, catalogResponse] = await Promise.all([
        fetch(MAP_URL),
        fetch(MANIFEST_URL),
        fetch(CATALOG_URL),
      ]);
      if (!geoResponse.ok || !manifestResponse.ok || !catalogResponse.ok) throw new Error('Map data unavailable');
      const [geo, manifest, catalog] = await Promise.all([
        geoResponse.json(), manifestResponse.json(), catalogResponse.json(),
      ]);
      if (geo.features.length !== 20 || catalog.provinces.length !== 20) throw new Error('Incomplete province data');
      state.geo = geo;
      state.heroItems = Array.isArray(manifest.items) ? manifest.items : [];
      state.provinces = catalog.provinces;
      state.project = makeProject(geo.features);
      renderMap();
      renderQuickList();
      renderPanel();
      loading.hidden = true;
    } catch (error) {
      loading.hidden = false;
      loading.textContent = t('map_error');
      console.error(error);
    }
  }

  if (i18n) {
    i18n.onChange(() => {
      applyStaticCopy();
      if (state.provinces.length) {
        renderMap();
        renderQuickList();
        renderPanel();
      }
    });
  }

  initialise();
})();
