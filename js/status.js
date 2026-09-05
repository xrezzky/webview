// XREZZKY Chat — status.js
// Fitur Status/SW: hanya terlihat oleh follower, expire 24 jam,
// cleanup otomatis (DB + media Cloudinary) dijalankan opportunistik.

let myStatuses = [];
let statusFeed = [];         // [{user:{id,username,avatar_url}, items:[status,...], allViewed}]
let statusViewedSet = new Set();
let _viewerQueue = [];       // status list yang lagi dibuka di viewer
let _viewerIndex = 0;
let _viewerTimer = null;
let _viewerUser = null;
let statusCh = null;

const STATUS_MAX_PHOTO_MB = 10;
const STATUS_MAX_VIDEO_MB = 30;
const STATUS_MAX_VIDEO_SEC = 30;
const STATUS_PHOTO_MS = 5000;

// ════════════════════════════════
//  CLEANUP (opportunistic, client-triggered)
// ════════════════════════════════
async function cleanupExpiredStatuses(){
  try {
    const last = parseInt(localStorage.getItem('xrezzky_last_status_cleanup')||'0',10);
    if(Date.now() - last < 5*60*1000) return; // throttle 5 menit
    localStorage.setItem('xrezzky_last_status_cleanup', String(Date.now()));

    const nowIso = new Date().toISOString();
    const {data:expired} = await sb.from('statuses')
      .select('id,type,storage_public_id')
      .lte('expires_at', nowIso)
      .limit(50);
    if(!expired || !expired.length) return;

    // Hapus media Cloudinary dulu (kalau ada), baru hapus baris DB.
    const mediaItems = expired
      .filter(s=>s.type!=='text' && s.storage_public_id)
      .map(s=>({publicId:s.storage_public_id, resourceType: s.type==='video'?'video':'image'}));

    if(mediaItems.length){
      try {
        await fetch('/api/cleanup-status', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({items:mediaItems})
        });
      } catch(e){ /* best-effort — DB tetap dibersihkan walau ini gagal */ }
    }

    await sb.from('statuses').delete().lte('expires_at', nowIso);
  } catch(e) {
    console.warn('cleanupExpiredStatuses:', e.message);
  }
}

// ════════════════════════════════
//  LOAD FEED
// ════════════════════════════════
async function loadStatusFeed(){
  cleanupExpiredStatuses(); // jalan di background, tidak perlu ditunggu

  const el = document.getElementById('status-feed-list');
  const nowIso = new Date().toISOString();

  const [{data:mine}, {data:following}] = await Promise.all([
    sb.from('statuses').select('*').eq('user_id',ME.id).gt('expires_at',nowIso).order('created_at',{ascending:true}),
    sb.from('follows').select('receiver_id').eq('sender_id',ME.id).eq('status','accepted')
  ]);
  myStatuses = mine || [];
  renderMyStatusRow();

  const followingIds = (following||[]).map(f=>f.receiver_id);
  if(!followingIds.length){
    el.innerHTML = `<div class="convo-empty"><i class="fa fa-circle-notch"></i><p>Belum ada status</p><small>Follow orang lain buat lihat status mereka</small></div>`;
    return;
  }

  const [{data:otherStatuses}, {data:myViews}] = await Promise.all([
    sb.from('statuses').select('*,user:user_id(id,username,avatar_url)').in('user_id',followingIds).gt('expires_at',nowIso).order('created_at',{ascending:true}),
    sb.from('status_views').select('status_id').eq('viewer_id',ME.id)
  ]);
  statusViewedSet = new Set((myViews||[]).map(v=>v.status_id));

  const grouped = {};
  (otherStatuses||[]).forEach(s=>{
    if(!grouped[s.user_id]) grouped[s.user_id] = {user:s.user, items:[]};
    grouped[s.user_id].items.push(s);
  });
  statusFeed = Object.values(grouped).map(g=>({
    ...g, allViewed: g.items.every(s=>statusViewedSet.has(s.id))
  })).sort((a,b)=>{
    if(a.allViewed !== b.allViewed) return a.allViewed ? 1 : -1;
    return new Date(b.items[b.items.length-1].created_at) - new Date(a.items[a.items.length-1].created_at);
  });

  if(!statusFeed.length){
    el.innerHTML = `<div class="convo-empty"><i class="fa fa-circle-notch"></i><p>Belum ada status terbaru</p></div>`;
    return;
  }
  el.innerHTML = `<div class="people-section-title">Pembaruan Terbaru</div>` + statusFeed.map(buildStatusFeedRow).join('');
}

function renderMyStatusRow(){
  const el = document.getElementById('status-my-row');
  if(!el) return;
  const hasStatus = myStatuses.length > 0;
  const avatarSrc = MY_PROFILE?.avatar_url || avatarUrl(MY_PROFILE?.username||'?');
  el.innerHTML = `
    <div class="status-avatar-wrap${hasStatus?' has-status':''}" onclick="${hasStatus?`openStatusViewerFor(ME.id)`:`openCreateStatusSheet()`}">
      <img src="${avatarSrc}" style="object-fit:cover;">
      <div class="status-plus-badge" onclick="event.stopPropagation();openCreateStatusSheet()"><i class="fa fa-plus"></i></div>
    </div>
    <div class="people-info" onclick="${hasStatus?`openStatusViewerFor(ME.id)`:`openCreateStatusSheet()`}">
      <div class="people-name">Status Saya</div>
      <div class="people-bio">${hasStatus?`${myStatuses.length} status aktif · Tap untuk lihat`:'Tap untuk tambah status'}</div>
    </div>`;
}

function buildStatusFeedRow(group){
  const last = group.items[group.items.length-1];
  return `<div class="people-card" onclick="openStatusViewerFor('${group.user.id}')">
    <div class="status-avatar-wrap${group.allViewed?' viewed':''}" style="width:46px;height:46px;">
      <img src="${group.user.avatar_url||avatarUrl(group.user.username)}" style="object-fit:cover;">
    </div>
    <div class="people-info">
      <div class="people-name">${esc(group.user.username)}</div>
      <div class="people-bio">${timeAgoID(last.created_at)}</div>
    </div>
  </div>`;
}

function timeAgoID(ts){
  const diff = Date.now() - new Date(ts).getTime();
  const min = Math.floor(diff/60000);
  if(min < 1) return 'Baru saja';
  if(min < 60) return `${min} menit lalu`;
  const hr = Math.floor(min/60);
  if(hr < 24) return `${hr} jam lalu`;
  return `${Math.floor(hr/24)} hari lalu`;
}

function filterStatusFeed(){} // placeholder kalau nanti mau ditambah search

// ════════════════════════════════
//  BUAT STATUS
// ════════════════════════════════
function openCreateStatusSheet(){
  document.getElementById('modal-status-create-choice').classList.add('open');
}
function closeCreateStatusChoice(){
  document.getElementById('modal-status-create-choice').classList.remove('open');
}

function pickStatusMedia(kind){
  closeCreateStatusChoice();
  const input = document.getElementById('status-media-input');
  input.accept = kind==='video' ? 'video/*' : 'image/*';
  input.dataset.kind = kind;
  input.value = '';
  input.click();
}

async function handleStatusMediaSelected(event){
  const file = event.target.files[0];
  const kind = event.target.dataset.kind;
  if(!file) return;

  if(kind==='photo' && file.size > STATUS_MAX_PHOTO_MB*1024*1024){
    showToast(`❌ Ukuran foto max ${STATUS_MAX_PHOTO_MB}MB.`); event.target.value=''; return;
  }
  if(kind==='video' && file.size > STATUS_MAX_VIDEO_MB*1024*1024){
    showToast(`❌ Ukuran video max ${STATUS_MAX_VIDEO_MB}MB.`); event.target.value=''; return;
  }

  if(kind==='video'){
    const okDuration = await new Promise(resolve=>{
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = ()=>{ URL.revokeObjectURL(v.src); resolve(v.duration <= STATUS_MAX_VIDEO_SEC); };
      v.onerror = ()=>resolve(true); // kalau gagal baca metadata, jangan blokir
      v.src = URL.createObjectURL(file);
    });
    if(!okDuration){ showToast(`❌ Durasi video max ${STATUS_MAX_VIDEO_SEC} detik.`); event.target.value=''; return; }
  }

  const progressToast = ()=>showToast('⏳ Mengunggah status...');
  progressToast();
  try {
    const result = await uploadToCloudinary(file, kind==='video'?'video':'image', true);
    const {error} = await sb.from('statuses').insert({
      user_id: ME.id,
      type: kind==='video' ? 'video' : 'photo',
      content_url: result.secure_url,
      storage_public_id: result.public_id
    });
    if(error) throw new Error(error.message);
    showToast('✅ Status ditambahkan!');
    await loadStatusFeed();
  } catch(e) {
    showToast('❌ Gagal upload status: '+e.message);
  } finally {
    event.target.value = '';
  }
}

const STATUS_BG_COLORS = ['#1e3a5f','#7c2d12','#14532d','#4c1d95','#831843','#1e293b'];
function openTextStatusSheet(){
  closeCreateStatusChoice();
  document.getElementById('status-text-input').value = '';
  document.getElementById('status-text-preview').style.background = STATUS_BG_COLORS[0];
  document.getElementById('status-text-preview').dataset.color = STATUS_BG_COLORS[0];
  document.getElementById('status-text-colors').innerHTML = STATUS_BG_COLORS.map((c,i)=>
    `<div class="status-color-dot${i===0?' active':''}" style="background:${c};" onclick="pickStatusBg('${c}',this)"></div>`
  ).join('');
  document.getElementById('modal-status-text').classList.add('open');
}
function closeTextStatusSheet(){ document.getElementById('modal-status-text').classList.remove('open'); }
function pickStatusBg(c, el){
  document.getElementById('status-text-preview').style.background = c;
  document.getElementById('status-text-preview').dataset.color = c;
  document.querySelectorAll('.status-color-dot').forEach(d=>d.classList.remove('active'));
  el.classList.add('active');
}
function onStatusTextInput(v){
  document.getElementById('status-text-preview-text').innerText = v;
}
async function submitTextStatus(){
  const text = document.getElementById('status-text-input').value.trim();
  if(!text){ showToast('Tulis sesuatu dulu.'); return; }
  if(text.length > 200){ showToast('❌ Maksimal 200 karakter.'); return; }
  const bg = document.getElementById('status-text-preview').dataset.color || STATUS_BG_COLORS[0];
  const {error} = await sb.from('statuses').insert({
    user_id: ME.id, type:'text', text_content:text, bg_color:bg
  });
  if(error){ showToast('❌ Gagal: '+error.message); return; }
  closeTextStatusSheet();
  showToast('✅ Status ditambahkan!');
  await loadStatusFeed();
}

// ════════════════════════════════
//  VIEWER FULL-SCREEN
// ════════════════════════════════
async function openStatusViewerFor(userId){
  let items, user;
  if(userId === ME.id){
    items = myStatuses;
    user = {id:ME.id, username: MY_PROFILE?.username, avatar_url: MY_PROFILE?.avatar_url};
  } else {
    const group = statusFeed.find(g=>g.user.id===userId);
    if(!group){ showToast('Status tidak ditemukan / sudah expired.'); await loadStatusFeed(); return; }
    items = group.items; user = group.user;
  }
  if(!items.length){ showToast('Belum ada status.'); return; }

  _viewerQueue = items; _viewerUser = user; _viewerIndex = 0;
  document.getElementById('status-viewer').classList.add('open');
  document.getElementById('sv-username').innerText = user.username;
  document.getElementById('sv-avatar').src = user.avatar_url || avatarUrl(user.username);
  renderViewerProgressBars();
  showViewerItem(0);
}

function renderViewerProgressBars(){
  const wrap = document.getElementById('sv-progress-wrap');
  wrap.innerHTML = _viewerQueue.map((_,i)=>`<div class="sv-progress-track"><div class="sv-progress-fill" id="sv-bar-${i}"></div></div>`).join('');
}

function showViewerItem(idx){
  clearTimeout(_viewerTimer);
  if(idx < 0){ closeStatusViewer(); return; }
  if(idx >= _viewerQueue.length){ closeStatusViewer(); return; }
  _viewerIndex = idx;
  const s = _viewerQueue[idx];

  // Reset semua bar: yang sebelumnya penuh, yang ini jalan, sisanya kosong
  _viewerQueue.forEach((_,i)=>{
    const bar = document.getElementById('sv-bar-'+i);
    if(!bar) return;
    bar.style.transition = 'none'; bar.style.width = i<idx?'100%':'0%';
  });

  const body = document.getElementById('sv-content');
  body.innerHTML = '';
  if(s.type === 'text'){
    body.innerHTML = `<div class="sv-text-slide" style="background:${s.bg_color||'#1e3a5f'};"><div class="sv-text-content">${esc(s.text_content||'')}</div></div>`;
    runViewerTimer(idx, STATUS_PHOTO_MS);
  } else if(s.type === 'photo'){
    body.innerHTML = `<img src="${s.content_url}" class="sv-media">`;
    runViewerTimer(idx, STATUS_PHOTO_MS);
  } else if(s.type === 'video'){
    body.innerHTML = `<video src="${s.content_url}" class="sv-media" autoplay playsinline></video>`;
    const vid = body.querySelector('video');
    vid.onloadedmetadata = ()=>runViewerTimer(idx, Math.min(vid.duration*1000||STATUS_PHOTO_MS, 60000));
    vid.onended = ()=>showViewerItem(idx+1);
  }

  document.getElementById('sv-time').innerText = timeAgoID(s.created_at);

  // Tombol hapus / lihat viewer cuma untuk status sendiri
  const ownActions = document.getElementById('sv-own-actions');
  if(_viewerUser.id === ME.id){
    ownActions.style.display = 'flex';
    ownActions.querySelector('.sv-viewers-btn').onclick = ()=>openStatusViewersList(s.id);
    ownActions.querySelector('.sv-delete-btn').onclick = ()=>deleteMyStatus(s.id);
  } else {
    ownActions.style.display = 'none';
    recordStatusView(s.id);
  }
}

function runViewerTimer(idx, ms){
  const bar = document.getElementById('sv-bar-'+idx);
  if(bar){
    requestAnimationFrame(()=>{
      bar.style.transition = `width ${ms}ms linear`;
      bar.style.width = '100%';
    });
  }
  _viewerTimer = setTimeout(()=>showViewerItem(idx+1), ms);
}

function viewerNext(){ showViewerItem(_viewerIndex+1); }
function viewerPrev(){ showViewerItem(_viewerIndex-1); }

function closeStatusViewer(){
  clearTimeout(_viewerTimer);
  document.getElementById('status-viewer').classList.remove('open');
  document.getElementById('sv-content').innerHTML = '';
  loadStatusFeed();
}

async function recordStatusView(statusId){
  if(statusViewedSet.has(statusId)) return;
  statusViewedSet.add(statusId);
  const {error} = await sb.from('status_views').insert({status_id:statusId, viewer_id:ME.id});
  if(error && !/duplicate|unique/i.test(error.message||'')) console.warn('recordStatusView:', error.message);
}

async function deleteMyStatus(statusId){
  if(!confirm('Hapus status ini?')) return;
  const s = myStatuses.find(x=>x.id===statusId);
  await sb.from('statuses').delete().eq('id',statusId).eq('user_id',ME.id);
  if(s && s.type!=='text' && s.storage_public_id){
    fetch('/api/cleanup-status', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({items:[{publicId:s.storage_public_id, resourceType:s.type==='video'?'video':'image'}]})
    }).catch(()=>{});
  }
  showToast('Status dihapus.');
  closeStatusViewer();
}

async function openStatusViewersList(statusId){
  const {data} = await sb.from('status_views').select('viewer_id,viewed_at,viewer:viewer_id(id,username,avatar_url)').eq('status_id',statusId).order('viewed_at',{ascending:false});
  const list = data || [];
  document.getElementById('sv-viewers-count').innerText = `Dilihat oleh ${list.length} orang`;
  document.getElementById('sv-viewers-list').innerHTML = list.length ? list.map(v=>`
    <div style="display:flex;align-items:center;gap:10px;padding:8px 4px;">
      <img src="${v.viewer?.avatar_url||avatarUrl(v.viewer?.username||'?')}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;">
      <div style="font-size:13px;font-weight:700;">@${esc(v.viewer?.username||'?')}</div>
    </div>`).join('') : `<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px;">Belum ada yang lihat</div>`;
  document.getElementById('modal-status-viewers').classList.add('open');
}
function closeStatusViewersList(){ document.getElementById('modal-status-viewers').classList.remove('open'); }

function subscribeStatusFeed(){
  if(statusCh) sb.removeChannel(statusCh);
  statusCh = sb.channel('status-feed-'+ME.id)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'statuses'}, ()=>{
      if(document.getElementById('panel-status')?.classList.contains('active')) loadStatusFeed();
    })
    .subscribe();
}
