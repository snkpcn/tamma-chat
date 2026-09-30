(() => {
  'use strict';

  const DATA_ROOT = 'assets/brand/otop/';
  const MAP_URL = DATA_ROOT + 'map/isan-provinces.geojson';
  const MANIFEST_URL = DATA_ROOT + 'province-hero/province-hero-manifest.json';
  const VIEW = { width: 760, height: 870, pad: 28 };
  const INITIAL_PROVINCE = 'Chaiyaphum Province';

  const svg = document.getElementById('isanMap');
  const loading = document.getElementById('mapLoading');
  const quickList = document.getElementById('provinceQuickList');
  const panel = document.getElementById('provincePanel');
  let state = { geo: null, items: [], selected: INITIAL_PROVINCE, project: null };

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

  function itemFor(shapeName) {
    return state.items.find(item => item.geoShapeName === shapeName);
  }

  function heroUrl(item) {
    return DATA_ROOT + 'province-hero/' + item.web;
  }

  function renderMap() {
    svg.replaceChildren();
    const defs = element('defs');
    const clip = element('clipPath', { id: 'selectedProvinceClip' });
    const selectedFeature = state.geo.features.find(feature => feature.properties.shapeName === state.selected);
    const selectedPathData = geometryPath(selectedFeature.geometry, state.project);
    clip.append(element('path', { d: selectedPathData, 'fill-rule': 'evenodd' }));
    defs.append(clip);
    svg.append(defs);

    const shapeGroup = element('g');
    state.geo.features.forEach(feature => {
      const shapeName = feature.properties.shapeName;
      const item = itemFor(shapeName);
      const path = element('path', {
        d: geometryPath(feature.geometry, state.project),
        fill: shapeName === state.selected ? 'transparent' : '#d9cdb9',
        stroke: '#fff8eb',
        'stroke-width': '2.2',
        'vector-effect': 'non-scaling-stroke',
        'fill-rule': 'evenodd',
        tabindex: '0',
        role: 'button',
        'aria-label': `${item.provinceTh}: ${item.productTh}`,
        class: `province-shape${shapeName === state.selected ? ' is-selected' : ''}`,
        'data-province': shapeName
      });
      const title = element('title');
      title.textContent = `${item.provinceTh} — ${item.productTh}`;
      path.append(title);
      path.addEventListener('click', () => selectProvince(shapeName));
      path.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectProvince(shapeName);
        }
      });
      shapeGroup.append(path);
    });
    svg.append(shapeGroup);

    const item = itemFor(state.selected);
    const bounds = geometryBounds(selectedFeature.geometry, state.project);
    const image = element('image', {
      href: heroUrl(item),
      x: bounds.x, y: bounds.y, width: Math.max(bounds.width, 1), height: Math.max(bounds.height, 1),
      preserveAspectRatio: 'xMidYMid slice',
      'clip-path': 'url(#selectedProvinceClip)',
      class: 'selected-image'
    });
    svg.append(image);
    svg.append(element('path', { d: selectedPathData, class: 'selected-outline', 'fill-rule': 'evenodd' }));
    svg.append(element('path', { d: selectedPathData, class: 'selected-inner-outline', 'fill-rule': 'evenodd' }));
  }

  function renderQuickList() {
    quickList.replaceChildren(...state.items.map(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `province-chip${item.geoShapeName === state.selected ? ' is-selected' : ''}`;
      button.textContent = item.provinceTh;
      button.setAttribute('aria-pressed', item.geoShapeName === state.selected ? 'true' : 'false');
      button.addEventListener('click', () => selectProvince(item.geoShapeName));
      return button;
    }));
    quickList.querySelector('.is-selected')?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  function renderPanel() {
    const item = itemFor(state.selected);
    const open = item.geoShapeName === INITIAL_PROVINCE;
    const paddedOrder = String(item.order).padStart(2, '0');
    const image = document.getElementById('provinceImage');
    panel.classList.add('is-changing');
    image.onload = () => panel.classList.remove('is-changing');
    image.src = heroUrl(item);
    image.alt = `ภาพจำลอง${item.productTh} จังหวัด${item.provinceTh}`;
    document.getElementById('provinceCount').textContent = `${paddedOrder} / 20`;
    document.getElementById('provinceEn').textContent = item.provinceEn.toUpperCase();
    document.getElementById('provinceName').textContent = item.provinceTh;
    document.getElementById('provinceProduct').textContent = item.productTh;
    document.getElementById('mapSelectedOrder').textContent = paddedOrder;
    document.getElementById('mapSelectedName').textContent = item.provinceTh;

    const status = document.getElementById('provinceStatus');
    status.classList.toggle('is-open', open);
    status.lastChild.textContent = open ? 'เปิดสำรวจแล้ว · เริ่มต้นที่ชัยภูมิ' : 'จุดหมายถัดไป';

    const description = document.getElementById('provinceDescription');
    description.textContent = open
      ? 'จุดเริ่มต้นของการเดินทางผ่านงานหัตถกรรม ภูมิปัญญา และเรื่องราวจากชุมชนอีสาน'
      : 'ภาพตัวอย่างของดีประจำจังหวัดสำหรับแผนการขยาย OTOP Marketplace ไปทั่วทั้งภาคอีสาน';

    const cta = document.getElementById('provinceCta');
    cta.classList.toggle('is-disabled', !open);
    cta.textContent = open ? 'ดูสินค้า OTOP ชัยภูมิ' : 'Marketplace จังหวัดนี้ · เร็ว ๆ นี้';
    cta.href = open ? 'index.html#community' : '#';
    cta.setAttribute('aria-disabled', open ? 'false' : 'true');
  }

  function selectProvince(shapeName) {
    if (!itemFor(shapeName)) return;
    state.selected = shapeName;
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
      const [geoResponse, manifestResponse] = await Promise.all([fetch(MAP_URL), fetch(MANIFEST_URL)]);
      if (!geoResponse.ok || !manifestResponse.ok) throw new Error('Map data unavailable');
      const [geo, manifest] = await Promise.all([geoResponse.json(), manifestResponse.json()]);
      if (geo.features.length !== 20 || manifest.items.length !== 20) throw new Error('Incomplete province data');
      state.geo = geo;
      state.items = manifest.items;
      state.project = makeProject(geo.features);
      renderMap();
      renderQuickList();
      renderPanel();
      loading.hidden = true;
    } catch (error) {
      loading.textContent = 'ไม่สามารถเปิดแผนที่ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';
      console.error(error);
    }
  }

  initialise();
})();
