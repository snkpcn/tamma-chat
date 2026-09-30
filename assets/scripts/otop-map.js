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

  const svg = document.getElementById('isanMap');
  const loading = document.getElementById('mapLoading');
  const quickList = document.getElementById('provinceQuickList');
  const panel = document.getElementById('provincePanel');
  const productGrid = document.getElementById('provinceProductGrid');
  const productHeading = document.getElementById('provinceProductsHeading');
  const productSummary = document.getElementById('provinceProductsSummary');
  let state = {
    geo: null,
    heroItems: [],
    provinces: [],
    selectedProvinceId: INITIAL_PROVINCE_ID,
    productsByProvince: new Map(),
    project: null,
    selectionRequest: 0,
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
      x: Math.min(...xs), y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys)
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

  function manifestHeroUrl(province) {
    const item = state.heroItems.find(hero => hero.provinceTh === province.provinceName);
    return item ? DATA_ROOT + 'province-hero/' + item.web : '';
  }

  function fallbackHeroUrl(province) {
    return province.heroProductImage || province.heroImage || '';
  }

  function primaryHeroUrl(province) {
    return manifestHeroUrl(province) || fallbackHeroUrl(province);
  }

  function setImageWithFallback(image, province) {
    const fallback = fallbackHeroUrl(province);
    image.onerror = () => {
      image.onerror = null;
      if (fallback) image.src = fallback;
    };
    image.src = primaryHeroUrl(province);
  }

  function renderMap() {
    svg.replaceChildren();
    const selectedFeature = featureFor(state.selectedProvinceId);
    if (!selectedFeature) return;

    const defs = element('defs');
    const clip = element('clipPath', { id: 'selectedProvinceClip' });
    const selectedPathData = geometryPath(selectedFeature.geometry, state.project);
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
        'aria-label': `${province.provinceName}: ${province.heroTitle}`,
        class: `province-shape${provinceId === state.selectedProvinceId ? ' is-selected' : ''}`,
        'data-province-id': provinceId
      });
      const title = element('title');
      title.textContent = province.heroTitle;
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
    const bounds = geometryBounds(selectedFeature.geometry, state.project);
    const image = element('image', {
      href: primaryHeroUrl(province),
      x: bounds.x, y: bounds.y, width: Math.max(bounds.width, 1), height: Math.max(bounds.height, 1),
      preserveAspectRatio: 'xMidYMid slice',
      'clip-path': 'url(#selectedProvinceClip)',
      class: 'selected-image'
    });
    const fallback = fallbackHeroUrl(province);
    image.addEventListener('error', () => {
      if (fallback && image.getAttribute('href') !== fallback) image.setAttribute('href', fallback);
    }, { once: true });
    svg.append(image);
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

  function selectedProducts() {
    return state.productsByProvince.get(state.selectedProvinceId);
  }

  function renderPanel() {
    const province = provinceFor(state.selectedProvinceId);
    const products = selectedProducts();
    const hasProducts = Array.isArray(products) && products.length > 0;
    const paddedOrder = String(province.sortOrder).padStart(2, '0');
    const image = document.getElementById('provinceImage');
    panel.classList.add('is-changing');
    image.onload = () => panel.classList.remove('is-changing');
    setImageWithFallback(image, province);
    image.alt = province.heroTitle;
    document.getElementById('provinceCount').textContent = `${paddedOrder} / 20`;
    document.getElementById('provinceEn').textContent = 'OTOP · ภาคอีสาน';
    document.getElementById('provinceName').textContent = province.provinceName;
    document.getElementById('provinceProduct').textContent = province.provinceId === INITIAL_PROVINCE_ID
      ? 'ผ้าไหมมัดหมี่บ้านเขว้า'
      : province.heroTitle;
    document.getElementById('provincePhotoCredit').hidden = true;
    document.getElementById('mapSelectedOrder').textContent = paddedOrder;
    document.getElementById('mapSelectedName').textContent = province.provinceName;

    const status = document.getElementById('provinceStatus');
    status.classList.add('is-open');
    status.lastChild.textContent = hasProducts
      ? `${products.length} เรื่องราวพร้อมสำรวจ`
      : 'เปิดให้สำรวจแล้ว';
    document.getElementById('provinceDescription').textContent = province.provinceId === INITIAL_PROVINCE_ID
      ? 'บ้านเขว้าสืบทอดการทอผ้าไหมมัดหมี่มาเกือบ 200 ปี ตั้งแต่สาวไหม มัดลาย ย้อมสี จนถึงทอด้วยกี่ทีละเส้น'
      : province.heroSubtitle;

    const cta = document.getElementById('provinceCta');
    cta.hidden = !hasProducts;
    cta.classList.remove('is-disabled');
    cta.textContent = `ดูสินค้า OTOP ${province.provinceName}`;
    cta.href = '#provinceProducts';
    cta.setAttribute('aria-disabled', 'false');
  }

  function productCard(product) {
    const card = document.createElement('article');
    card.className = 'story-product-card';

    const media = document.createElement('div');
    media.className = 'story-product-media';
    const image = document.createElement('img');
    image.src = product.image;
    image.alt = product.productName;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      media.classList.add('is-placeholder');
      image.remove();
    }, { once: true });
    media.append(image);

    const body = document.createElement('div');
    body.className = 'story-product-body';
    const tags = document.createElement('p');
    tags.className = 'story-product-tags';
    tags.textContent = `${product.category} · ${product.originPlace}`;
    const title = document.createElement('h3');
    title.textContent = product.productName;
    const description = document.createElement('p');
    description.className = 'story-product-description';
    description.textContent = product.shortDescription;
    const caption = document.createElement('p');
    caption.className = 'story-product-caption';
    caption.textContent = product.imageCaption;
    body.append(tags, title, description, caption);
    card.append(media, body);
    return card;
  }

  function renderProducts() {
    const province = provinceFor(state.selectedProvinceId);
    const products = selectedProducts();
    productHeading.textContent = `สินค้า OTOP ${province.provinceName}`;
    if (!Array.isArray(products)) {
      productSummary.textContent = 'กำลังโหลดข้อมูลสินค้าจากระบบ…';
      productGrid.replaceChildren();
      return;
    }
    if (!products.length) {
      productSummary.textContent = 'ข้อมูลจังหวัดพร้อมแล้ว';
      const empty = document.createElement('div');
      empty.className = 'province-products-empty';
      empty.textContent = 'ยังไม่มีสินค้าที่ผ่านการยืนยันสำหรับแสดงในหน้านี้';
      productGrid.replaceChildren(empty);
      return;
    }
    productSummary.textContent = `${products.length} เรื่องราว · ยังไม่เปิดจำหน่ายจนกว่าราคา สต๊อก และการจัดส่งจะยืนยันครบ`;
    productGrid.replaceChildren(...products.map(productCard));
  }

  async function loadProducts(provinceId) {
    if (state.productsByProvince.has(provinceId)) return;
    const response = await fetch(`${CATALOG_URL}?provinceId=${encodeURIComponent(provinceId)}`);
    if (!response.ok) throw new Error('Province catalog unavailable');
    const data = await response.json();
    state.productsByProvince.set(provinceId, Array.isArray(data.products) ? data.products : []);
  }

  async function selectProvince(provinceId) {
    if (!provinceFor(provinceId)) return;
    state.selectedProvinceId = provinceId;
    const request = ++state.selectionRequest;
    renderMap();
    renderQuickList();
    renderPanel();
    renderProducts();
    try {
      await loadProducts(provinceId);
      if (request !== state.selectionRequest || state.selectedProvinceId !== provinceId) return;
      renderPanel();
      renderProducts();
    } catch (error) {
      if (request !== state.selectionRequest) return;
      productSummary.textContent = 'ยังโหลดข้อมูลสินค้าจังหวัดนี้ไม่ได้ กรุณาลองใหม่อีกครั้ง';
      console.error(error);
    }
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
      renderProducts();
      loading.hidden = true;
      await loadProducts(INITIAL_PROVINCE_ID);
      renderPanel();
      renderProducts();
    } catch (error) {
      loading.hidden = false;
      loading.textContent = 'ไม่สามารถเปิดแผนที่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';
      console.error(error);
    }
  }

  initialise();
})();
