const $ = id => document.getElementById(id);
const state = {collections: [], collection: null, folder: '', images: [], filtered: [], page: 0, preview: 0, request: 0};
const PAGE_SIZE = 60;
const number = value => `#${String(value).padStart(3, '0')}`;
let privateAccess = null;
const decryptedImages = new Map();
async function decryptFile(url, cryptoKey = privateAccess.cryptoKey) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('密钥链接不可用或图库尚未发布。');
  const data = new Uint8Array(await response.arrayBuffer());
  return crypto.subtle.decrypt({name: 'AES-GCM', iv: data.slice(0, 12)}, cryptoKey, data.slice(12));
}
async function imageURL(image) {
  if (!image.encrypted) return image.url.replace('/image?', '/thumbnail?');
  if (!decryptedImages.has(image.url)) {
    const result = decryptFile(image.url, image.cryptoKey || privateAccess.cryptoKey).then(data => URL.createObjectURL(new Blob([data], {type: 'image/webp'})));
    decryptedImages.set(image.url, result);
    result.catch(() => decryptedImages.delete(image.url));
  }
  return decryptedImages.get(image.url);
}
async function unlockGallery(collection, selected) {
  const key = selected.get('key');
  const vault = selected.get('vault');
  if (!key || !vault || !/^[a-f0-9]{32}$/.test(vault)) return;
  try {
    const raw = Uint8Array.from(atob(key.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - key.length % 4) % 4)), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    privateAccess = {key, vault, cryptoKey};
    const payload = JSON.parse(new TextDecoder().decode(await decryptFile(`data/${vault}.bin`)));
    let folders = payload;
    if (payload.groups) {
      folders = [];
      for (const group of payload.groups) {
        const bytes = Uint8Array.from(atob(group.key.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - group.key.length % 4) % 4)), c => c.charCodeAt(0));
        const groupKey = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
        const groupFolders = JSON.parse(new TextDecoder().decode(await decryptFile(`data/${group.vault}.bin`, groupKey)));
        for (const folder of groupFolders) for (const image of folder.images) image.cryptoKey = groupKey;
        folders.push(...groupFolders);
      }
    }
    collection.folders = folders;
    collection.locked = false;
  } catch (error) {
    privateAccess = null;
    throw new Error('MRMY密钥无效，或图库尚未发布。请在对应群聊发送 /web 获取链接。');
  }
}
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
      if (folder.images) return folder.images;
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
    count.textContent = collection.locked ? '🔒' : collection.folders.reduce((sum, f) => sum + f.count, 0).toLocaleString();
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
  const hash = new URLSearchParams({collection: id, folder: path});
  if (privateAccess) { hash.set('vault', privateAccess.vault); hash.set('key', privateAccess.key); }
  history.replaceState(null, '', `#${hash}`);
  filterImages();
  $('status').textContent = '正在读取图片…';
  try {
    if (state.collection.locked) throw new Error('MRMY为群专属图库，请在对应群聊发送 /web 获取密钥链接。');
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
    imageURL(image).then(url => { img.src = url; }).catch(() => { img.alt = '解密失败，请重新获取群密钥链接'; });
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
async function openPreview(index) {
  state.preview = index;
  const image = state.filtered[index];
  if (!image) return;
  $('previewTitle').textContent = `${number(image.number)} · ${image.name}`;
  $('largeImage').removeAttribute('src');
  $('largeImage').alt = image.name;
  $('original').removeAttribute('href');
  try {
    const url = await imageURL(image);
    if (state.preview !== index) return;
    $('largeImage').src = image.encrypted ? url : image.url;
    $('original').href = image.encrypted ? url : image.url;
  } catch (error) { $('largeImage').alt = '图片解密失败'; }
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
    const mrmy = state.collections.find(c => c.id === 'mrmy');
    if (mrmy?.locked && selected.get('key')) {
      try { await unlockGallery(mrmy, selected); }
      catch (error) { renderCollections(); $('status').textContent = error.message; return; }
    }
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
