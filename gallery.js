(() => {
  const $ = id => document.getElementById(id);
  const api = '/.netlify/functions/sweets-gallery';
  const auth = '/.netlify/functions/gallery-auth';
  let photos = [], previewUrl = '', busy = false;
  async function request(url, options) {
    const res = await fetch(url, { cache: 'no-store', ...options });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to load the gallery. Please try again.');
    return data;
  }
  const authRequest = data => request(auth, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  function status(message, owner = true) { $(owner ? 'ownerGalleryStatus' : 'customerGalleryStatus').textContent = message; }
  function imageUrl(photo, owner = false) { return `${api}?id=${encodeURIComponent(photo.id)}${owner ? '&owner=1' : ''}`; }
  function button(label, action) {
    const el = document.createElement('button'); el.type = 'button'; el.textContent = label;
    el.className = 'px-3 py-2 rounded-lg bg-bear-100 hover:bg-bear-200 text-bear-900 font-bold text-xs';
    el.addEventListener('click', action); return el;
  }
  function iconButton(label, path, action) {
    const el = button('', action);
    el.className = 'inline-flex shrink-0 items-center justify-center w-11 h-11 rounded-lg shadow-md text-bear-900 bg-bear-100 hover:bg-bear-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:opacity-60 disabled:cursor-not-allowed';
    el.setAttribute('aria-label', label);
    el.title = label;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '20'); svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path); svg.append(shape); el.append(svg);
    return el;
  }
  function card(photo, owner) {
    const el = document.createElement('article');
    el.className = 'rounded-2xl border border-bear-200 bg-bear-50 overflow-hidden';
    if (!owner) el.classList.add('self-start', 'min-w-0');
    const view = button('View photo', () => {
      $('galleryLightboxImage').src = imageUrl(photo, owner);
      $('galleryLightboxImage').alt = photo.title;
      $('galleryLightboxTitle').textContent = photo.title;
      $('galleryLightboxTitle').className = owner ? 'font-display text-xl font-bold mt-3' : 'text-sm font-bold mt-3';
      $('galleryLightboxCaption').textContent = photo.caption;
      $('galleryLightbox').showModal();
    });
    view.className = 'block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-700';
    view.setAttribute('aria-label', `Enlarge ${photo.title}`);
    const img = document.createElement('img'); img.src = imageUrl(photo, owner); img.alt = photo.title;
    img.loading = 'lazy'; img.className = `w-full ${owner ? 'h-64' : 'h-[6.72rem]'} object-cover`;
    img.addEventListener('error', () => { img.alt = `${photo.title} — photo unavailable`; });
    const media = document.createElement('div'); media.className = 'relative';
    view.replaceChildren(img); media.append(view); el.append(media);
    if (!owner) {
      const label = document.createElement('h4');
      label.className = 'absolute inset-x-0 bottom-0 px-1.5 pt-4 pb-1 text-center text-[0.6125rem] font-normal leading-tight text-white break-words bg-gradient-to-t from-black/70 via-black/40 to-transparent [text-shadow:0_1px_2px_rgba(0,0,0,0.8)] pointer-events-none';
      label.textContent = photo.title;
      media.append(label);
      return el;
    }
    const info = document.createElement('div'); info.className = 'p-4 space-y-2';
    const title = document.createElement('h4'); title.className = 'text-sm font-normal text-bear-900 break-words'; title.textContent = photo.title;
    const caption = document.createElement('p'); caption.className = 'text-sm font-normal text-bear-700 whitespace-pre-wrap break-words'; caption.textContent = photo.caption;
    info.append(title, caption);
    if (owner) {
      if (!photo.published) {
        const hidden = document.createElement('span');
        hidden.className = 'absolute top-2 left-2 rounded-full bg-bear-900 text-bear-50 px-3 py-1 text-xs font-bold shadow-md pointer-events-none';
        hidden.textContent = 'Hidden';
        media.append(hidden);
      }
      const actions = document.createElement('div'); actions.className = 'absolute inset-x-2 bottom-2 flex justify-center gap-2';
      const index = photos.findIndex(item => item.id === photo.id);
      const visibility = iconButton(`${photo.published ? 'Hide from' : 'Show in'} customer gallery: ${photo.title}`, 'M12 5v14M5 12h14', () => toggle(photo));
      visibility.setAttribute('aria-pressed', String(photo.published));
      if (photo.published) visibility.classList.add('ring-2', 'ring-bear-700', 'ring-inset');
      const pencil = iconButton(`Edit or replace: ${photo.title}`, 'm16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5', () => edit(photo));
      pencil.dataset.noAutoscroll = ''; // edit() scrolls to the editor form itself
      const left = iconButton(`Move left: ${photo.title}`, 'M19 12H5m7-7-7 7 7 7', () => move(photo, 'left'));
      const right = iconButton(`Move right: ${photo.title}`, 'M5 12h14m-7-7 7 7-7 7', () => move(photo, 'right'));
      const trash = iconButton(`Delete from gallery: ${photo.title}`, 'M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6', () => remove(photo));
      trash.classList.remove('text-bear-900', 'bg-bear-100', 'hover:bg-bear-200');
      trash.classList.add('text-rose-700', 'bg-rose-50', 'hover:bg-rose-100');
      left.disabled = index === 0; right.disabled = index === photos.length - 1;
      actions.append(visibility, pencil, left, right, trash);
      media.append(actions);
    }
    el.append(info); return el;
  }
  async function loadCustomer() {
    status('Loading Moma Bear’s photos…', false); $('retryCustomerGallery').classList.add('hidden');
    $('customerGalleryPhotos').replaceChildren();
    try {
      const data = await request(api);
      $('customerGalleryPhotos').replaceChildren(...data.photos.map(p => card(p, false)));
      status(data.photos.length ? '' : 'Fresh from the kitchen: Moma Bear’s gallery photos are coming soon.', false);
    } catch (e) { status(e.message, false); $('retryCustomerGallery').classList.remove('hidden'); }
  }
  async function loadOwner() {
    status('Checking gallery access…');
    try {
      const session = await request(auth);
      $('galleryManagement').classList.toggle('hidden', !session.unlocked);
      $('galleryLoginForm').classList.toggle('hidden', session.unlocked);
      $('gallerySignOut').classList.toggle('hidden', !session.unlocked);
      if (!session.unlocked) { status('Enter your portal password again to unlock Gallery Manager.'); $('galleryPassword').focus(); return; }
      const data = await request(api + '?owner=1'); photos = data.photos;
      $('ownerGalleryPhotos').replaceChildren(...photos.map(p => card(p, true)));
      status(photos.length ? `${photos.length} gallery photo${photos.length === 1 ? '' : 's'}. Hidden photos stay private.` : 'Your gallery is ready. Add your first photo above.');
    } catch (e) { status(e.message); }
  }
  function clearEditor() {
    $('galleryPhotoForm').reset(); $('galleryEditId').value = '';
    $('galleryEditorHeading').textContent = 'Add a photo';
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = '';
    $('galleryUploadPreview').classList.add('hidden'); $('galleryUploadPreview').removeAttribute('src');
  }
  function edit(photo) {
    clearEditor(); $('galleryEditId').value = photo.id; $('galleryTitle').value = photo.title;
    $('galleryCaption').value = photo.caption; $('galleryPublished').checked = photo.published;
    $('galleryEditorHeading').textContent = 'Edit photo';
    $('galleryUploadPreview').src = imageUrl(photo, true); $('galleryUploadPreview').classList.remove('hidden');
    $('galleryTitle').focus({ preventScroll: true });
    const form = $('galleryPhotoForm'); const header = document.querySelector('header.sticky');
    form.style.scrollMarginTop = ((header ? header.offsetHeight : 0) + 8) + 'px';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function mutate(action) {
    if (busy) return;
    busy = true;
    $('galleryManagement').inert = true;
    status('Saving gallery changes…');
    try {
      await action(); clearEditor(); await loadOwner();
      if (!$('sweetsGalleryDrawer').classList.contains('hidden')) await loadCustomer();
    } catch (e) { status(e.message); }
    finally { busy = false; $('galleryManagement').inert = false; }
  }
  function move(photo, direction) {
    mutate(() => request(api + '?id=' + photo.id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction })
    }));
  }
  function toggle(photo) {
    mutate(() => {
      const form = new FormData(); form.set('title', photo.title); form.set('caption', photo.caption); form.set('published', String(!photo.published));
      return request(api + '?id=' + photo.id, { method: 'POST', body: form });
    });
  }
  function remove(photo) {
    const dialog = document.createElement('dialog');
    dialog.className = 'rounded-2xl p-6 space-y-4 max-w-sm bg-white text-bear-900 shadow-xl';
    const text = document.createElement('p'); text.textContent = `Hide or permanently delete “${photo.title}”? Hidden photos can be shown again.`;
    const actions = document.createElement('div'); actions.className = 'flex flex-wrap gap-2';
    const close = () => { dialog.close(); dialog.remove(); };
    actions.append(button('Cancel', close), button('Hide instead', () => {
      close(); if (photo.published) toggle(photo);
    }), button('Delete permanently', () => {
      close(); mutate(() => request(api + '?id=' + photo.id, {method: 'DELETE'}));
    }));
    dialog.append(text, actions); document.body.append(dialog); dialog.showModal();
    dialog.addEventListener('cancel', () => dialog.remove());
  }
  $('btnSweetsGallery').addEventListener('click', () => {
    const drawer = $('sweetsGalleryDrawer'); const opening = drawer.classList.contains('hidden');
    drawer.classList.toggle('hidden', !opening); $('btnSweetsGallery').setAttribute('aria-expanded', String(opening));
    if (opening) {
      loadCustomer();
      $('sweetsGalleryHeading').focus({ preventScroll: true });
      // Scroll so the top of the gallery sits just below the sticky header (works on phones too).
      const scrollToGallery = () => {
        const header = document.querySelector('header.sticky');
        const offset = (header ? header.offsetHeight : 0) + 8;
        const top = drawer.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      };
      requestAnimationFrame(scrollToGallery);
    }
  });
  $('btnCloseSweetsGallery').addEventListener('click', () => { $('sweetsGalleryDrawer').classList.add('hidden'); $('btnSweetsGallery').setAttribute('aria-expanded', 'false'); $('btnSweetsGallery').focus(); });
  $('retryCustomerGallery').addEventListener('click', loadCustomer);
  document.querySelector('[data-ownertab="gallery"]').addEventListener('click', loadOwner);
  $('retryOwnerGallery').addEventListener('click', loadOwner);
  $('galleryCancelEdit').addEventListener('click', clearEditor);
  $('galleryImage').addEventListener('change', () => {
    const file = $('galleryImage').files[0]; if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) {
      $('galleryImage').value = ''; status('Choose a JPEG, PNG, or WebP photo up to 3 MB.'); return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = URL.createObjectURL(file);
    $('galleryUploadPreview').src = previewUrl; $('galleryUploadPreview').classList.remove('hidden');
  });
  $('galleryPhotoForm').addEventListener('submit', event => {
    event.preventDefault(); const id = $('galleryEditId').value; const file = $('galleryImage').files[0];
    if (!id && !file) { status('Choose a photo to upload.'); return; }
    const form = new FormData(); form.set('title', $('galleryTitle').value); form.set('caption', $('galleryCaption').value);
    form.set('published', String($('galleryPublished').checked)); if (file) form.set('image', file);
    mutate(() => request(api + (id ? '?id=' + id : ''), { method: 'POST', body: form }));
  });
  $('galleryLoginForm').addEventListener('submit', async event => {
    event.preventDefault(); $('galleryLoginButton').disabled = true; status('Unlocking gallery…');
    try {
      await authRequest({ password: $('galleryPassword').value });
      $('galleryPassword').value = '';
      await loadOwner();
    } catch (e) { status(e.message); }
    finally { $('galleryLoginButton').disabled = false; }
  });
  async function lockGallery() {
    $('galleryManagement').classList.add('hidden');
    $('galleryLoginForm').classList.remove('hidden');
    $('gallerySignOut').classList.add('hidden');
    $('galleryPassword').value = '';
    clearEditor();
    $('ownerGalleryPhotos').replaceChildren();
    photos = [];
    try { await authRequest({ action: 'logout' }); status('Gallery Manager is locked.'); }
    catch (e) { status(e.message); }
  }
  $('gallerySignOut').addEventListener('click', lockGallery);
  // The Suite adds new menu items to the gallery; refresh whichever gallery views are showing.
  document.addEventListener('gallery-changed', () => {
    if (!$('sweetsGalleryDrawer').classList.contains('hidden')) loadCustomer();
    if (!$('galleryManagement').classList.contains('hidden')) loadOwner();
  });
  document.addEventListener('suite-locked', lockGallery);
})();
