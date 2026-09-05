// XREZZKY Chat — communities.js
// Fitur Komunitas: private-by-default, public join langsung,
// private via undangan. Mirror pola groups.js supaya konsisten.

let activeCommunityId = null;
let selectedCMembers = {};
let allCommunities = [];
let communityInvites = [];
let _cmtySearchTimer = null;
let communityInviteCh = null;

async function loadCommunities(){
  const el = document.getElementById('communities-list');
  el.innerHTML = `<div class="convo-empty"><i class="fa fa-spinner fa-spin"></i><p>Memuat komunitas...</p></div>`;
  try {
    const [{data:myMemberships},{data:publicCommunities},{data:invites}] = await Promise.all([
      sb.from('community_members').select('community_id,role,community:community_id(id,name,description,avatar_url,is_public,created_by,created_at)').eq('user_id', ME.id),
      sb.from('communities').select('id,name,description,avatar_url,is_public,created_by,created_at').eq('is_public', true).order('created_at',{ascending:false}),
      sb.from('community_invites').select('id,community_id,sender_id,status,created_at,community:community_id(id,name,avatar_url),sender:sender_id(id,username)').eq('receiver_id', ME.id).eq('status','pending').order('created_at',{ascending:false})
    ]);

    communityInvites = invites || [];
    const myIds = new Set((myMemberships||[]).map(m=>m.community_id));
    allCommunities = [
      ...(myMemberships||[]).map(m=>({...m.community, myRole:m.role, isMember:true})),
      ...(publicCommunities||[]).filter(c=>!myIds.has(c.id)).map(c=>({...c, myRole:null, isMember:false}))
    ];
    renderCommunityList();
  } catch(e) {
    el.innerHTML = `<div class="convo-empty"><i class="fa fa-triangle-exclamation"></i><p>Gagal memuat komunitas</p></div>`;
  }
}

function renderCommunityList(){
  const el = document.getElementById('communities-list');
  const joined   = allCommunities.filter(c=>c.isMember);
  const discover = allCommunities.filter(c=>!c.isMember);
  let html = '';
  if(communityInvites.length){ html += `<div class="people-section-title">Undangan Komunitas</div>` + communityInvites.map(buildCommunityInviteCard).join(''); }
  if(joined.length){ html += `<div class="people-section-title">Komunitas Saya</div>` + joined.map(buildCommunityCard).join(''); }
  if(discover.length){ html += `<div class="people-section-title">Komunitas Publik</div>` + discover.map(buildCommunityCard).join(''); }
  if(!html){ html = `<div class="convo-empty"><i class="fa fa-people-group"></i><p>Belum ada komunitas</p><small>Tap + untuk buat komunitas baru</small></div>`; }
  el.innerHTML = html;
}

function buildCommunityInviteCard(inv){
  return `<div class="people-card" style="cursor:default;">
    <div class="people-card-avatar">${inv.community?.avatar_url?`<img src="${inv.community.avatar_url}" style="object-fit:cover;">`:`<div style="width:46px;height:46px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#ef4444);display:flex;align-items:center;justify-content:center;"><i class="fa fa-people-group" style="color:#fff;"></i></div>`}</div>
    <div class="people-info">
      <div class="people-name">${esc(inv.community?.name||'Komunitas')}</div>
      <div class="people-bio">Diundang oleh @${esc(inv.sender?.username||'?')}</div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      <button class="btn-follow not-followed" style="padding:6px 10px;" onclick="respondCommunityInvite('${inv.id}','${inv.community_id}','${esc(inv.community?.name||'Komunitas')}',true)"><i class="fa fa-check"></i></button>
      <button class="btn-follow" style="padding:6px 10px;background:var(--surface2);color:var(--text3);" onclick="respondCommunityInvite('${inv.id}','${inv.community_id}','${esc(inv.community?.name||'Komunitas')}',false)"><i class="fa fa-xmark"></i></button>
    </div>
  </div>`;
}

function buildCommunityCard(c){
  return `<div class="group-card" onclick="openCommunityInfo('${c.id}')" data-name="${(c.name||'').toLowerCase()}">
    <div class="group-avatar">${c.avatar_url?`<img src="${c.avatar_url}">`:'<i class="fa fa-people-group" style="color:#fff;font-size:20px;"></i>'}</div>
    <div class="group-info">
      <div class="group-name">${esc(c.name)} ${c.is_public?`<span class="badge-public">Publik</span>`:''}</div>
      <div class="group-last">${esc(c.description||'Tap untuk buka')}</div>
    </div>
    <div class="group-meta">
      ${!c.isMember
        ? `<button class="btn-follow not-followed" style="font-size:11px;padding:5px 10px;" onclick="event.stopPropagation();joinCommunity('${c.id}','${esc(c.name)}')"><i class="fa fa-right-to-bracket"></i> Gabung</button>`
        : `<span class="group-count" style="font-size:10px;color:var(--text3);">${c.myRole}</span>`}
    </div>
  </div>`;
}

function filterCommunities(v){
  document.querySelectorAll('#communities-list .group-card').forEach(el=>{
    el.style.display = !v || el.dataset.name?.includes(v.toLowerCase()) ? '' : 'none';
  });
}

async function joinCommunity(communityId, communityName){
  const {error} = await sb.from('community_members').insert({community_id:communityId, user_id:ME.id, role:'member'});
  if(error){ showToast('❌ Gagal gabung: '+error.message); return; }
  showToast(`✅ Berhasil gabung "${communityName}"!`);
  await loadCommunities();
  openCommunityInfo(communityId);
}

async function leaveCommunity(communityId){
  if(!confirm('Keluar dari komunitas ini?')) return;
  await sb.from('community_members').delete().eq('community_id',communityId).eq('user_id',ME.id);
  showToast('Kamu keluar dari komunitas.');
  closeCommunityInfo();
  await loadCommunities();
}

async function openCommunityInfo(communityId){
  activeCommunityId = communityId;
  document.getElementById('modal-community-info').classList.add('open');
  document.getElementById('cmty-info-body').innerHTML = `<div style="text-align:center;padding:30px;"><span class="spinner"></span></div>`;
  const [{data:cmty},{data:members}] = await Promise.all([
    sb.from('communities').select('*').eq('id',communityId).single(),
    sb.from('community_members').select('*,user:user_id(id,username,avatar_url)').eq('community_id',communityId)
  ]);
  if(!cmty) return;
  document.getElementById('cmty-info-title').innerText = cmty.name;
  const myMship = members?.find(m=>m.user_id===ME.id);
  const isAdmin = myMship?.role==='owner' || myMship?.role==='admin';
  const isMember = !!myMship;
  document.getElementById('cmty-info-body').innerHTML = `
    <div style="text-align:center;margin-bottom:20px;">
      <div style="width:72px;height:72px;border-radius:18px;background:linear-gradient(135deg,#f59e0b,#ef4444);display:flex;align-items:center;justify-content:center;font-size:30px;margin:0 auto 10px;">🌐</div>
      <div style="font-size:18px;font-weight:900;">${esc(cmty.name)}</div>
      ${cmty.description?`<div style="font-size:12px;color:var(--text2);margin-top:4px;">${esc(cmty.description)}</div>`:''}
      <div style="margin-top:8px;">${cmty.is_public?`<span class="badge-public">🌐 Publik</span>`:`<span style="font-size:10px;color:var(--text3);background:var(--surface2);padding:2px 8px;border-radius:99px;">🔒 Private</span>`}</div>
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">${members?.length||0} Anggota</div>
    ${(members||[]).map(m=>`
      <div style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;margin-bottom:4px;background:var(--surface);">
        <img src="${m.user?.avatar_url||avatarUrl(m.user?.username||'?')}" style="width:36px;height:36px;border-radius:50%;flex-shrink:0;object-fit:cover;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;">@${esc(m.user?.username||'?')}</div>
          <div style="font-size:10px;color:var(--text3);">${m.role}</div>
        </div>
        ${isAdmin && m.user_id!==ME.id ? `<button onclick="kickCommunityMember('${communityId}','${m.user_id}','${esc(m.user?.username||'?')}')" style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);color:var(--red);border-radius:8px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:inherit;">Keluarkan</button>` : ''}
      </div>`).join('')}
    <div style="padding-top:16px;margin-top:8px;border-top:1px solid var(--border);display:flex;gap:10px;flex-wrap:wrap;">
      ${isAdmin ? `<button onclick="addMembersToCommunity('${communityId}')" style="flex:1;padding:11px;border-radius:12px;background:rgba(59,130,246,.12);color:var(--accent);border:1px solid rgba(59,130,246,.2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;"><i class="fa fa-user-plus"></i> Undang Member</button>` : ''}
      ${isMember ? `<button onclick="leaveCommunity('${communityId}')" style="flex:1;padding:11px;border-radius:12px;background:rgba(239,68,68,.1);color:var(--red);border:1px solid rgba(239,68,68,.2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;"><i class="fa fa-right-from-bracket"></i> Keluar Komunitas</button>` : ''}
    </div>`;
}

function closeCommunityInfo(){ document.getElementById('modal-community-info').classList.remove('open'); }

async function kickCommunityMember(communityId,userId,username){
  if(!confirm(`Keluarkan @${username}?`)) return;
  await sb.from('community_members').delete().eq('community_id',communityId).eq('user_id',userId);
  showToast(`@${username} dikeluarkan.`);
  openCommunityInfo(communityId);
}

// ── Buat Komunitas ──
function openCreateCommunity(){
  selectedCMembers = {};
  ['cmty-name','cmty-desc','cmty-member-search'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const cb=document.getElementById('cmty-public'); if(cb) cb.checked=false;
  const track=document.getElementById('cmty-pub-track'); if(track) track.style.background='var(--border2)';
  const thumb=document.getElementById('cmty-pub-thumb'); if(thumb) thumb.style.left='2px';
  document.getElementById('cmty-member-results').innerHTML='';
  document.getElementById('cmty-selected-members').innerHTML='';
  const btn=document.getElementById('btn-create-community');
  if(btn){ btn.innerHTML='<i class="fa fa-plus"></i> Buat Komunitas'; btn.onclick=()=>createCommunity(); }
  document.getElementById('modal-create-community').classList.add('open');
}
function closeCreateCommunity(){ document.getElementById('modal-create-community').classList.remove('open'); }

document.addEventListener('DOMContentLoaded',()=>{
  const cb=document.getElementById('cmty-public');
  if(cb) cb.addEventListener('change',function(){
    document.getElementById('cmty-pub-track').style.background=this.checked?'var(--accent)':'var(--border2)';
    document.getElementById('cmty-pub-thumb').style.left=this.checked?'22px':'2px';
  });
});

function searchCommunityMembers(v){
  clearTimeout(_cmtySearchTimer);
  const el=document.getElementById('cmty-member-results');
  if(!v||v.length<2){ el.innerHTML=''; return; }
  _cmtySearchTimer=setTimeout(async()=>{
    const {data}=await sb.from('users').select('id,username,avatar_url').ilike('username','%'+v+'%').neq('id',ME.id).limit(8);
    if(!data?.length){ el.innerHTML=`<div style="font-size:11px;color:var(--text3);padding:8px;">Tidak ditemukan</div>`; return; }
    el.innerHTML=data.map(u=>`
      <div class="user-result" onclick="addCommunityMember('${u.id}','${esc(u.username)}')"
        style="padding:8px;${selectedCMembers[u.id]?'opacity:.4;pointer-events:none;':''}">
        <img src="${u.avatar_url||avatarUrl(u.username)}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">
        <div><div style="font-size:13px;font-weight:700;">@${esc(u.username)}</div></div>
        ${selectedCMembers[u.id]?`<span style="margin-left:auto;color:var(--green);font-size:11px;">✓</span>`:''}
      </div>`).join('');
  },300);
}

function addCommunityMember(uid,username){
  if(selectedCMembers[uid]) return;
  selectedCMembers[uid] = {username};
  renderSelectedCMembers();
  document.getElementById('cmty-member-results').innerHTML='';
  document.getElementById('cmty-member-search').value='';
}
function removeCommunityMember(uid){ delete selectedCMembers[uid]; renderSelectedCMembers(); }
function renderSelectedCMembers(){
  const el=document.getElementById('cmty-selected-members');
  el.innerHTML=Object.entries(selectedCMembers).map(([uid,u])=>`
    <div style="display:flex;align-items:center;gap:6px;background:var(--surface2);padding:5px 10px;border-radius:99px;font-size:12px;">
      @${esc(u.username)}
      <i class="fa fa-xmark" style="cursor:pointer;color:var(--text3);" onclick="removeCommunityMember('${uid}')"></i>
    </div>`).join('');
}

async function createCommunity(){
  const name=document.getElementById('cmty-name').value.trim();
  if(!name){ showToast('Nama komunitas wajib diisi.'); return; }
  const btn=document.getElementById('btn-create-community');
  btn.disabled=true; btn.innerHTML='<span class="spinner"></span>';
  const {data:cmty,error}=await sb.from('communities').insert({
    name, description:document.getElementById('cmty-desc').value.trim(),
    is_public:document.getElementById('cmty-public').checked, created_by:ME.id
  }).select().single();
  if(error||!cmty){ btn.disabled=false; btn.innerHTML='<i class="fa fa-plus"></i> Buat Komunitas'; showToast('❌ Gagal: '+(error?.message||'unknown')); return; }
  await sb.from('community_members').insert({community_id:cmty.id,user_id:ME.id,role:'owner'});

  const memberIds=Object.keys(selectedCMembers);
  if(memberIds.length){
    const inviteRows=memberIds.map(uid=>({community_id:cmty.id,sender_id:ME.id,receiver_id:uid,status:'pending'}));
    const {error:invErr}=await sb.from('community_invites').upsert(inviteRows,{onConflict:'community_id,receiver_id'});
    if(invErr) showToast('⚠️ Komunitas dibuat, tapi sebagian undangan gagal terkirim: '+invErr.message);
  }

  btn.disabled=false; btn.innerHTML='<i class="fa fa-plus"></i> Buat Komunitas';
  closeCreateCommunity();
  showToast(memberIds.length?`✅ Komunitas "${name}" dibuat! Undangan terkirim ke ${memberIds.length} orang.`:`✅ Komunitas "${name}" berhasil dibuat!`);
  await loadCommunities();
  openCommunityInfo(cmty.id);
}

async function addMembersToCommunity(communityId){
  closeCommunityInfo(); openCreateCommunity();
  document.getElementById('cmty-name').value='_add_members_';
  document.getElementById('btn-create-community').innerHTML='<i class="fa fa-user-plus"></i> Undang Member';
  document.getElementById('btn-create-community').onclick=async()=>{
    if(!Object.keys(selectedCMembers).length){ showToast('Pilih member dulu.'); return; }
    const inviteRows=Object.keys(selectedCMembers).map(uid=>({community_id:communityId,sender_id:ME.id,receiver_id:uid,status:'pending'}));
    const {error}=await sb.from('community_invites').upsert(inviteRows,{onConflict:'community_id,receiver_id'});
    if(error){ showToast('❌ Gagal mengundang: '+error.message); return; }
    closeCreateCommunity(); showToast('✅ Undangan terkirim!');
    document.getElementById('btn-create-community').onclick=()=>createCommunity();
    openCommunityInfo(communityId);
  };
}

// ── Undangan Komunitas ──
async function respondCommunityInvite(inviteId, communityId, communityName, accept){
  const status = accept ? 'accepted' : 'rejected';
  const {error} = await sb.from('community_invites').update({status, responded_at:new Date().toISOString()}).eq('id', inviteId);
  if(error){ showToast('❌ Gagal: '+error.message); return; }

  if(accept){
    const {error:memErr} = await sb.from('community_members').insert({community_id:communityId, user_id:ME.id, role:'member'});
    if(memErr && !/duplicate|unique/i.test(memErr.message||'')){ showToast('❌ Gagal gabung komunitas: '+memErr.message); return; }
    showToast(`✅ Kamu bergabung ke "${communityName}"!`);
  } else {
    showToast(`Undangan "${communityName}" ditolak.`);
  }
  await loadCommunities();
}

function subscribeCommunityInvites(){
  if(communityInviteCh) sb.removeChannel(communityInviteCh);
  communityInviteCh = sb.channel('community-invites-'+ME.id)
    .on('postgres_changes',{event:'*',schema:'public',table:'community_invites',filter:`receiver_id=eq.${ME.id}`},
      async (payload) => {
        if(payload.eventType==='INSERT') showToast('📩 Kamu mendapat undangan komunitas baru!');
        await loadCommunities();
      }
    ).subscribe();
}
