const $ = id => document.getElementById(id);
const state = {collections: [], collection: null, folder: '', images: [], filtered: [], page: 0, preview: 0, request: 0};
const PAGE_SIZE = 60;
const number = value => `#${String(value).padStart(3, '0')}`;
function folderLabel(folder) {
  if (folder?.name) return folder.name;
  const path = folder?.path || '';
  return path.split('/').filter(Boolean).pop() || '根目录';
}
function currentFolderLabel() {
  return folderLabel(state.collection?.folders.find(folder => folder.path === state.folder));
}
async function getJSON(url) {
  if (window.GALLERY_STATIC) {
    if (url === '/api/collections') url = 'data/collections.json';
    else {
      const query = new URL(url, location.origin).searchParams;
      const collection = state.collections.find(c => c.id === query.get('collection'));
      const folder = collection?.folders.find(f => f.path === query.get('path'));
      if (!folder) throw new Error('未找到该文件夹的静态索引。');
      url = folder.index;
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error('读取失败，请检查目录是否存在或点击刷新重试。');
  return response.json();
}
function button(text, action, selected = false) {
  const item = document.createElement('button');
  item.textContent = text;
  item.classList.toggle('selected', selected);
  item.onclick = action;
  return item;
}
function renderCollections() {
  $('collections').replaceChildren(...state.collections.map(collection => {
    const item = button(`▧  ${collection.id.toUpperCase()}`, () => selectCollection(collection), state.collection?.id === collection.id);
    const count = document.createElement('span');
    count.textContent = collection.folders.reduce((sum, f) => sum + f.count, 0).toLocaleString();
    item.append(count);
    return item;
  }));
}
function renderFolders() {
  const folders = (state.collection?.folders || []).filter(folder => folder.count > 0);
  $('folderCount').textContent = folders.length;
  const query = $('folderSearch').value.toLocaleLowerCase();
  $('folders').replaceChildren(...folders.filter(f => folderLabel(f).toLocaleLowerCase().includes(query)).map(folder => {
    const item = button(`▱  ${folderLabel(folder)}`, () => selectFolder(folder.path), state.folder === folder.path);
    const count = document.createElement('span');
    count.textContent = folder.count;
    item.append(count);
    item.title = folderLabel(folder);
    return item;
  }));
}
function selectCollection(collection, preferred) {
  state.collection = collection;
  $('folderSearch').value = '';
  renderCollections();
  const folder = collection.folders.find(f => f.path === preferred) || collection.folders.find(f => f.count > 0) || collection.folders[0];
  selectFolder(folder?.path || '');
}
async function selectFolder(path) {
  const request = ++state.request;
  state.folder = path;
  state.images = [];
  state.page = 0;
  $('search').value = '';
  renderFolders();
  const id = state.collection.id;
  $('title').textContent = currentFolderLabel();
  $('breadcrumb').textContent = `图片档案 / ${id.toUpperCase()} / ${currentFolderLabel()}`;
  $('description').textContent = '仅显示当前文件夹中的图片，可在左侧切换文件夹。';
  history.replaceState(null, '', `#${new URLSearchParams({collection: id, folder: path})}`);
  filterImages();
  $('status').textContent = '正在读取图片…';
  try {
    if (!state.collection.exists) throw new Error('图片目录不存在，请配置目录后刷新图库。');
    const images = await getJSON(`/api/images?${new URLSearchParams({collection: id, path})}`);
    if (request !== state.request) return;
    state.images = images;
    filterImages();
  } catch (error) {
    if (request === state.request) $('status').textContent = error.message;
  }
}
function filterImages() {
  const query = $('search').value.trim().toLocaleLowerCase();
  state.filtered = state.images.filter(img => query.startsWith('#') ? img.number === Number(query.slice(1)) : img.name.toLocaleLowerCase().includes(query));
  if ($('sort').value === 'desc') state.filtered.reverse();
  state.page = 0;
  renderImages();
}
function renderImages() {
  const start = state.page * PAGE_SIZE;
  const items = state.filtered.slice(start, start + PAGE_SIZE);
  $('total').textContent = state.images.length.toLocaleString();
  $('status').textContent = state.images.length ? (items.length ? '' : '没有匹配的图片。') : '这个文件夹内还没有图片，可选择其他子文件夹。';
  $('grid').replaceChildren(...items.map((image, index) => {
    const card = button('', () => openPreview(start + index));
    card.className = 'card';
    const wrap = document.createElement('div');
    wrap.className = 'image-wrap';
    const img = document.createElement('img');
    img.src = image.url.replace('/image?', '/thumbnail?');
    img.alt = image.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onerror = () => { img.alt = '图片暂时无法预览'; };
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = number(image.number);
    wrap.append(img, badge);
    const info = document.createElement('div');
    info.className = 'card-info';
    const name = document.createElement('div');
    name.className = 'filename';
    name.textContent = image.name;
    name.title = image.name;
    const meta = document.createElement('div');
    meta.className = 'file-meta';
    meta.textContent = `${image.name.split('.').pop().toUpperCase()}  /  ${state.collection.id.toUpperCase()}`;
    info.append(name, meta);
    card.append(wrap, info);
    card.setAttribute('aria-label', `${number(image.number)} ${image.name}，查看大图`);
    return card;
  }));
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
  $('range').textContent = items.length ? `显示 ${start + 1}–${start + items.length} / ${state.filtered.length} 张` : '显示 0 张';
  $('page').textContent = `${state.page + 1} / ${totalPages}`;
  $('prev').disabled = state.page === 0;
  $('next').disabled = state.page + 1 >= totalPages;
}
function openPreview(index) {
  state.preview = index;
  const image = state.filtered[index];
  if (!image) return;
  $('previewTitle').textContent = `${number(image.number)} · ${image.name}`;
  $('largeImage').src = image.url;
  $('largeImage').alt = image.name;
  $('original').href = image.url;
  $('previewIndex').textContent = `${state.collection.id.toUpperCase()} / ${currentFolderLabel()} · ${index + 1} / ${state.filtered.length}`;
  $('prevImage').disabled = index === 0;
  $('nextImage').disabled = index === state.filtered.length - 1;
  if (!$('preview').open) $('preview').showModal();
}
async function load() {
  $('refresh').disabled = true;
  $('status').textContent = '正在扫描图片文件夹…';
  try {
    const selected = new URLSearchParams(location.hash.slice(1));
    state.collections = await getJSON('/api/collections');
    selectCollection(state.collections.find(c => c.id === selected.get('collection')) || state.collections[0], selected.get('folder'));
  } catch (error) { $('status').textContent = error.message; }
  finally { $('refresh').disabled = false; }
}
$('refresh').onclick = load;
$('search').oninput = filterImages;
$('sort').onchange = filterImages;
$('folderSearch').oninput = renderFolders;
for (const [id, direction] of [['prev', -1], ['next', 1]]) $(id).onclick = () => { state.page += direction; renderImages(); window.scrollTo({top: 0, behavior: 'smooth'}); };
$('closePreview').onclick = () => $('preview').close();
$('preview').onclick = event => { if (event.target === $('preview')) $('preview').close(); };
$('prevImage').onclick = () => openPreview(state.preview - 1);
$('nextImage').onclick = () => openPreview(state.preview + 1);
document.addEventListener('keydown', event => {
  if (!$('preview').open) return;
  if (event.key === 'ArrowLeft' && state.preview > 0) openPreview(state.preview - 1);
  if (event.key === 'ArrowRight' && state.preview < state.filtered.length - 1) openPreview(state.preview + 1);
});
load();
