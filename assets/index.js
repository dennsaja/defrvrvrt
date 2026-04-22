// ================= STATE =================
let cfg = JSON.parse(localStorage.getItem('tc_cfg')||'{}');
let currentUser = JSON.parse(localStorage.getItem('tc_user')||'null');
let uploadedB64 = null;
let uploadedB64_2 = null; // foto dokumentasi ke-2 (opsional)
let uploadedBarangB64 = null;
let uploadedBarangB64_2 = null;
let token = localStorage.getItem('token');
let riwayatData = [];
let adminData = [];
let adminFiltered = [];
let tugasData = [];
let tugasTeknisiList = [];
let lastNotVerifiedEmail = '';

// ================= INIT =================
// Decode JWT expiry without library
function getTokenExp(tok) {
  try {
    const payload = JSON.parse(atob(tok.split('.')[1]));
    return payload.exp || 0;
  } catch { return 0; }
}

function isTokenExpired(tok) {
  if (!tok) return true;
  const exp = getTokenExp(tok);
  return exp > 0 && Date.now() / 1000 > exp;
}

function showSessionExpiredModal() {
  // Clear state first
  localStorage.removeItem('token');
  localStorage.removeItem('tc_user');
  token = null; currentUser = null;
  riwayatData = []; adminData = []; adminFiltered = []; barangData = []; adminBarangData = [];

  // Remove existing modal if any
  document.getElementById('sessionModal')?.remove();

  const m = document.createElement('div');
  m.id = 'sessionModal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
  m.innerHTML = `<div style="background:#fff;border-radius:20px;padding:32px 28px;max-width:340px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <div style="width:56px;height:56px;background:var(--red-ll);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
      <svg style="width:24px;height:24px;color:var(--red)"><use href="#ic-lock"/></svg>
    </div>
    <div style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--txt)">Sesi Berakhir</div>
    <div style="font-size:13px;color:var(--txt3);margin-bottom:24px;line-height:1.6">Sesi login Anda telah habis. Silakan login ulang untuk melanjutkan.</div>
    <button onclick="document.getElementById('sessionModal').remove();showPage('login')" style="width:100%;padding:13px;background:var(--red);color:#fff;border:none;border-radius:12px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer">Login Ulang</button>
  </div>`;
  document.body.appendChild(m);
}

function checkAndRefreshToken() {
  if (!token || !currentUser) return false;
  if (isTokenExpired(token)) {
    showSessionExpiredModal();
    return false;
  }
  return true;
}

function init() {
  if (currentUser && token) {
    // Cek apakah token sudah expired
    if (isTokenExpired(token)) {
      showSessionExpiredModal();
      return;
    }
    if (currentUser.role === 'admin') showPage('admin');
    else showPage('dashboard');
  } else {
    showPage('login');
  }
  // Cek token setiap 5 menit saat app aktif
  setInterval(() => {
    if (token && currentUser && isTokenExpired(token)) {
      showSessionExpiredModal();
    }
  }, 5 * 60 * 1000);
}

function showPage(p) {
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  document.getElementById('page-' + p).classList.add('active');
  if (p === 'dashboard') {
    updateNav();
    goTab('dash', document.getElementById('ni-dash'));
    // Init push hanya jika belum pernah di-init
    _initPushOnce();
  }
  if (p === 'admin') {
    renderAdmin();
    _initPushOnce();
  }
}

let _pushInited = false;
async function _initPushOnce() {
  if (_pushInited) return;
  _pushInited = true;
  await initPush();
  // Cek permission yang sudah ada
  if (Notification.permission === 'granted') {
    await subscribePush();
  } else if (Notification.permission === 'default') {
    // Tunda sedikit agar UI sudah tampil dulu, lalu minta permission
    setTimeout(() => requestPushPermission(), 2000);
  }
  // Kalau 'denied' — tidak bisa minta lagi, tampilkan panduan
}

function goTab(tab, el) {
  document.querySelectorAll('.ni').forEach(x => x.classList.remove('active'));
  el.classList.add('active');
  if (tab === 'dash') renderDash();
  else if (tab === 'lap') renderLap();
  else if (tab === 'riw') renderRiw();
  else if (tab === 'tugas') renderTugasTeknisi();
  else if (tab === 'profil') renderProfil();
  else if (tab === 'barang') renderBarang();
}

// ================= DASHBOARD =================
async function renderDash() {
  const con = document.getElementById('con');
  const today = new Date().toISOString().split('T')[0];
  let mine = [];
  let tugasPending = [];
  try {
    const [resLap, resTugas] = await Promise.all([
      fetch('/api/laporan', { headers: { Authorization: 'Bearer ' + token } }),
      fetch('/api/tugas',   { headers: { Authorization: 'Bearer ' + token } })
    ]);
    if (resLap.ok)   { mine = await resLap.json(); localStorage.setItem('tc_lap_cache', JSON.stringify(mine)); }
    else throw new Error();
    if (resTugas.ok) { const td = await resTugas.json(); tugasPending = td.filter(t => t.status === 'pending'); }
  } catch (e) {
    mine = JSON.parse(localStorage.getItem('tc_lap_cache') || '[]').filter(r => r.teknisi === currentUser.username);
  }

  // Update dot indicator di nav
  const dot = document.getElementById('tugas-dot');
  if (dot) {
    if (tugasPending.length > 0) {
      dot.style.display = 'block';
      dot.textContent = tugasPending.length > 9 ? '9+' : tugasPending.length;
    } else {
      dot.style.display = 'none';
    }
  }

  const todayN = mine.filter(r => r.tanggal === today).length;
  const baru   = mine.filter(r => r.jenis_kegiatan === 'Pemasangan Baru').length;
  const prb    = mine.filter(r => r.jenis_kegiatan === 'Perbaikan').length;
  const pml    = mine.filter(r => r.jenis_kegiatan === 'Pemeliharaan').length;

  // Banner notifikasi — tampil jika permission belum granted
  const pushBanner = ('Notification' in window && Notification.permission !== 'granted') ? `
    <div style="background:linear-gradient(135deg,#1e293b,#334155);border-radius:14px;padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;gap:12px;cursor:pointer" onclick="requestPushPermission()">
      <div style="width:40px;height:40px;background:rgba(255,255,255,.1);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🔔</div>
      <div style="flex:1">
        <div style="color:#fff;font-weight:700;font-size:13px;margin-bottom:2px">Aktifkan Notifikasi</div>
        <div style="color:rgba(255,255,255,.6);font-size:11px">Terima notif tugas baru tanpa buka aplikasi</div>
      </div>
      <div style="color:rgba(255,255,255,.5);font-size:18px">›</div>
    </div>` : '';

  const notifTugas = tugasPending.length > 0 ? `
    <div class="notif-tugas" onclick="goTab('tugas',document.getElementById('ni-tugas'))">
      <div class="notif-badge">${tugasPending.length} Tugas Baru</div>
      <div class="notif-ttl">Kamu punya tugas yang belum selesai</div>
      <div class="notif-sub">Tap untuk lihat detail tugas →</div>
    </div>` : '';
  con.innerHTML = `
    <div class="dh">
      <div class="dh-greet">${greet()} </div>
      <div class="dh-name">${currentUser.username}</div>
      <div class="dh-badge"><div class="dot"></div>${todayN} kegiatan hari ini</div>
    </div>
    ${pushBanner}
    ${notifTugas}
    <div class="sgrid">
      <div class="sc"><div class="sc-icon" style="background:#E8F4FF"></div><div class="sc-n">${baru}</div><div class="sc-l">Pemasangan Baru</div></div>
      <div class="sc"><div class="sc-icon" style="background:#FFF8E6"></div><div class="sc-n">${prb}</div><div class="sc-l">Perbaikan</div></div>
      <div class="sc"><div class="sc-icon" style="background:#E6FAF5"></div><div class="sc-n">${pml}</div><div class="sc-l">Pemeliharaan</div></div>
      <div class="sc"><div class="sc-icon" style="background:#F3E8FF"></div><div class="sc-n">${mine.length}</div><div class="sc-l">Total Laporan</div></div>
    </div>
    <div class="sec-ttl">Aktivitas Terbaru</div>
    ${mine.length === 0 ? `<div class="empty"><div class="empty-icon"><svg class="ic-lg"><use href="#ic-report"/></svg></div><div class="et">Belum ada laporan</div><div class="es">Buat laporan kegiatan pertama</div></div>`
    : [...mine].slice(0, 3).map(r => {
      const ico = r.jenis_kegiatan === 'Pemasangan Baru' ? '<svg class="ic" style="color:var(--blue)"><use href="#ic-wifi"/></svg>' : r.jenis_kegiatan === 'Perbaikan' ? '<svg class="ic" style="color:var(--orange)"><use href="#ic-tool"/></svg>' : r.jenis_kegiatan === 'Instalasi CCTV' ? '' : '<svg class="ic" style="color:var(--green)"><use href="#ic-shield"/></svg>';
      const bg  = r.jenis_kegiatan === 'Pemasangan Baru' ? 'var(--blue-l)' : r.jenis_kegiatan === 'Perbaikan' ? 'var(--orange-l)' : r.jenis_kegiatan === 'Instalasi CCTV' ? '#F3E8FF' : 'var(--green-l)';
      const bc  = r.jenis_kegiatan === 'Pemasangan Baru' ? 'bb' : r.jenis_kegiatan === 'Perbaikan' ? 'bp' : r.jenis_kegiatan === 'Instalasi CCTV' ? 'bi' : 'bm';
      return `<div class="ai"><div class="ai-ico" style="background:${bg}">${ico}</div><div><div class="ai-t">${r.jenis_kegiatan}</div><div class="ai-m">${r.nama_client && r.nama_client !== '-' ? '<svg class=\'ic-sm\'><use href=\'#ic-user\'/></svg> ' + r.nama_client + ' · ' : ''} ${r.tanggal} ${r.waktu}</div></div><div class="ai-b ${bc}">${r.jenis_kegiatan.split(' ')[0]}</div></div>`;
    }).join('')}
  `;
}

// ================= TUGAS TEKNISI =================
async function renderTugasTeknisi() {
  const con = document.getElementById('con');
  con.innerHTML = `<div style="background:#fff;border-radius:var(--rad);padding:14px 16px;margin-bottom:12px;border:1px solid var(--bd);box-shadow:var(--sh)"><div style="font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:700"> Tugas dari Admin</div><div style="font-size:12px;color:var(--t2)">Memuat tugas...</div></div><div class="loading-row"><div class="spin"></div><span>Memuat tugas...</span></div>`;

  try {
    const res = await fetch('/api/tugas', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('Gagal memuat');
    const data = await res.json();

    const pending  = data.filter(t => t.status === 'pending');
    const selesai  = data.filter(t => t.status === 'selesai');

    // Update dot
    const dot = document.getElementById('tugas-dot');
    if (dot) {
      if (pending.length > 0) {
        dot.style.display = 'block';
        dot.textContent = pending.length > 9 ? '9+' : pending.length;
      } else {
        dot.style.display = 'none';
      }
    }

    const header = `<div style="background:#fff;border-radius:var(--rad);padding:14px 16px;margin-bottom:12px;border:1px solid var(--bd);box-shadow:var(--sh)">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:700"> Tugas dari Admin</div>
      <div style="font-size:12px;color:var(--t2)">${pending.length} tugas pending · ${selesai.length} selesai</div>
    </div>`;

    if (data.length === 0) {
      con.innerHTML = header + `<div class="empty"><div class="empty-icon"><svg class="ic-lg"><use href="#ic-task"/></svg></div><div class="et">Belum ada tugas</div><div class="es">Admin belum memberikan tugas</div></div>`;
      return;
    }

    const renderTugasCard = (t, showBtn) => {
      const ico = t.jenis_kegiatan === 'Pemasangan Baru' ? '📶' : t.jenis_kegiatan === 'Instalasi CCTV' ? '📷' : t.jenis_kegiatan === 'Perbaikan' ? '🔧' : '🛡️';
      const tgl = new Date(t.created_at).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
      const isBcast = t.is_broadcast === true;
      const statusLabel = t.status === 'selesai' ? '✅ Selesai' : t.status === 'proses' ? '🔄 Proses' : '⏳ Pending';
      const statusCls   = t.status === 'selesai' ? 'tugas-selesai' : 'tugas-pending';
      return `<div class="tugas-card ${t.status === 'selesai' ? 'status-selesai' : ''}">
        <div class="tugas-card-hdr">
          <div>
            <div class="tugas-jenis">${ico} ${t.jenis_kegiatan}</div>
            <div class="tugas-date">📅 Diberikan ${tgl}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
            ${isBcast ? '<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:50px;background:#E8EAF6;color:var(--adm)">📢 BROADCAST</span>' : ''}
            <span class="tugas-badge ${statusCls}">${statusLabel}</span>
          </div>
        </div>
        <div class="tugas-meta">
          ${t.nama_client && t.nama_client !== '-' ? `<span class="tugas-chip">👤 ${t.nama_client}</span>` : ''}
          ${t.tempat && t.tempat !== '-' ? `<span class="tugas-chip">📍 ${t.tempat}</span>` : ''}
          ${t.link_maps ? `<button onclick="openMaps('${t.link_maps}')" class="tugas-chip" style="color:var(--blue);background:var(--blue-l);border:none;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;padding:4px 10px;border-radius:var(--r-pill)"><svg style="width:12px;height:12px;vertical-align:middle;margin-right:3px"><use href="#ic-map"/></svg>Buka Maps</button>` : ''}
        </div>
        ${t.barang && t.barang !== '-' ? `<div class="tugas-barang">🧰 <strong>Barang dibawa:</strong> ${t.barang}</div>` : ''}
        <div class="tugas-catatan">📝 ${t.catatan}</div>
        ${t.foto ? `<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;color:var(--txt4);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">📎 Foto Referensi</div><img src="${t.foto}" onclick="window.open('${t.foto}','_blank')" style="width:100%;max-height:180px;object-fit:cover;border-radius:10px;cursor:pointer" onerror="this.parentElement.style.display='none'"><div style="font-size:10px;color:var(--txt4);text-align:center;margin-top:4px">Tap untuk buka penuh</div></div>` : ''}
        ${showBtn ? `
        <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
          <div style="font-size:11px;color:var(--txt4);margin-bottom:8px;text-align:center">Upload foto bukti penyelesaian untuk submit</div>
          <button class="btn-selesai" onclick="showSubmitFotoModal('${t.id}')">
            <svg style="width:16px;height:16px;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            Tandai Selesai + Upload Foto
          </button>
        </div>` : ''}
      </div>`;
    };

    let html = header;
    if (pending.length > 0) {
      html += `<div class="sec-ttl"> Tugas Pending (${pending.length})</div>`;
      html += pending.map(t => renderTugasCard(t, true)).join('');
    }
    if (selesai.length > 0) {
      html += `<div class="sec-ttl" style="margin-top:16px"> Selesai (${selesai.length})</div>`;
      html += selesai.map(t => renderTugasCard(t, false)).join('');
    }
    con.innerHTML = html;
  } catch(e) {
    con.innerHTML = `<div style="background:#fff;border-radius:14px;padding:24px;text-align:center;color:var(--r)"> Gagal memuat tugas: ${e.message}</div>`;
  }
}

function showSubmitFotoModal(id) {
  // Buat modal upload foto sebelum tandai selesai
  const mo = document.createElement('div');
  mo.id = 'submitFotoModal';
  mo.className = 'mo';
  mo.style.display = 'flex';
  mo.innerHTML = `
    <div class="mbox" style="max-width:420px">
      <div style="font-size:17px;font-weight:700;margin-bottom:4px;color:var(--txt)">📷 Upload Foto Bukti</div>
      <div style="font-size:12px;color:var(--txt3);margin-bottom:16px">Upload foto dokumentasi sebagai bukti penyelesaian tugas</div>
      <div class="tugas-foto-zone" id="submitFotoZone" onclick="document.getElementById('submitFotoInput').click()">
        <input type="file" id="submitFotoInput" accept="image/*,.heic,.heif,.webp" onchange="handleSubmitFoto(this)">
        <div style="font-size:32px;margin-bottom:8px">📸</div>
        <div style="font-size:13px;font-weight:600;color:var(--txt2);margin-bottom:3px">Tap untuk pilih foto</div>
        <div style="font-size:11px;color:var(--txt4)">JPG, PNG, HEIC, WEBP · Maks 10MB</div>
        <img id="submitFotoPreview" class="tugas-foto-preview">
      </div>
      <div style="font-size:11px;color:var(--orange);background:var(--orange-l);padding:8px 12px;border-radius:var(--r8);margin-bottom:14px;border:1px solid #FFD499">
        ⚠️ Foto wajib diupload sebagai bukti bahwa tugas telah selesai dikerjakan
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('submitFotoModal').remove()" class="btn-modal-action" style="background:#E2E8F0;color:var(--txt);flex:1">Batal</button>
        <button onclick="tandaiTugasSelesai('${id}',this)" id="btnKonfirmSelesai" class="btn-modal-action" style="background:linear-gradient(135deg,var(--adm),#3949ab);flex:2">
          ✅ Konfirmasi Selesai
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(mo);
  window._submitFotoB64 = null;
}

function handleSubmitFoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('File terlalu besar (maks 10MB)', 'err'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    window._submitFotoB64 = e.target.result;
    const prev = document.getElementById('submitFotoPreview');
    const zone = document.getElementById('submitFotoZone');
    if (prev) { prev.src = e.target.result; prev.style.display = 'block'; }
    if (zone) zone.classList.add('ok');
  };
  reader.readAsDataURL(file);
}

async function tandaiTugasSelesai(id, btn) {
  const foto = window._submitFotoB64 || null;
  if (!foto) { toast('Upload foto bukti terlebih dahulu!', 'err'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Memproses...'; }
  try {
    const res = await fetch('/api/tugas', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ id, status: 'selesai', foto_selesai: foto })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Gagal update', 'err'); if(btn){btn.disabled=false;btn.textContent='✅ Konfirmasi Selesai';} return; }
    document.getElementById('submitFotoModal')?.remove();
    window._submitFotoB64 = null;
    if (data.broadcast_deleted) {
      toast('✅ Tugas selesai! Tersimpan di riwayat laporan kamu.', 'ok');
    } else {
      toast('✅ Tugas ditandai selesai!', 'ok');
    }
    renderTugasTeknisi();
  } catch(e) {
    toast('Gagal konek server', 'err');
    if(btn){btn.disabled=false;btn.textContent='✅ Konfirmasi Selesai';}
  }
}

// ================= FORM LAPORAN =================
function renderLap() {
  uploadedB64 = null;
  uploadedB64_2 = null;
  const now = new Date();
  const d = now.toISOString().split('T')[0];
  const t = now.toTimeString().substring(0, 5);
  document.getElementById('con').innerHTML = `
    <div class="fcard" style="margin-bottom:0">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:17px;font-weight:700;margin-bottom:3px">Buat Laporan Kegiatan</div>
      <div style="font-size:12px;color:var(--t2);margin-bottom:16px">Pilih jenis kegiatan terlebih dahulu</div>
      <div class="fsec">Jenis Kegiatan</div>
      <div class="kgrid">
        <div><input type="radio" name="jenis" id="j1" value="Pemasangan Baru" class="kr" onchange="onJenisChange()"><label for="j1" class="kl"><div class="kl-icon"><svg class="ic-sm"><use href="#ic-wifi"/></svg></div><span class="kt">Pemasangan Baru</span></label></div>
        <div><input type="radio" name="jenis" id="j2" value="Perbaikan"       class="kr" onchange="onJenisChange()"><label for="j2" class="kl"><div class="kl-icon"><svg class="ic-sm"><use href="#ic-tool"/></svg></div><span class="kt">Perbaikan</span></label></div>
        <div><input type="radio" name="jenis" id="j3" value="Pemeliharaan"    class="kr" onchange="onJenisChange()"><label for="j3" class="kl"><div class="kl-icon"><svg class="ic-sm"><use href="#ic-shield"/></svg></div><span class="kt">Pemeliharaan</span></label></div>
        <div><input type="radio" name="jenis" id="j4" value="Instalasi CCTV"  class="kr" onchange="onJenisChange()"><label for="j4" class="kl"><span class="ke"></span><span class="kt">Instalasi CCTV</span></label></div>
      </div>

      <div id="jenisFields" style="display:none">
        <div class="fsec">Waktu & Tanggal</div>
        <div class="frow">
          <div class="fg2"><label class="flbl">Tanggal <span class="req">*</span></label><input type="date" class="fi" id="fTgl" value="${d}"></div>
          <div class="fg2"><label class="flbl">Waktu <span class="req">*</span></label><input type="time" class="fi" id="fWkt" value="${t}"></div>
        </div>
        <div class="fg2">
          <label class="flbl">Estimasi Pengerjaan <span class="req">*</span></label>
          <div style="display:flex;gap:8px">
            <input type="number" class="fi" id="fEstVal" placeholder="Contoh: 30" min="1" style="flex:1">
            <select class="fi" id="fEstUnit" style="width:90px">
              <option value="menit">Menit</option>
              <option value="jam">Jam</option>
            </select>
          </div>
        </div>

        <div class="fsec">Data Kegiatan</div>
        <div class="fg2" id="fieldNamaClient">
          <label class="flbl" id="lblNamaClient">Nama Client <span class="req">*</span></label>
          <input type="text" class="fi" id="fCli" placeholder="Nama client / pelanggan">
        </div>
        <div class="fg2" id="fieldTempat" style="display:none">
          <label class="flbl">Tempat <span class="req">*</span></label>
          <input type="text" class="fi" id="fTempat" placeholder="Lokasi / alamat kegiatan">
        </div>
        <div class="fg2" id="fieldPaket" style="display:none">
          <label class="flbl">Paket Internet</label>
          <input type="text" class="fi" id="fPaket" placeholder="Contoh: 20 Mbps, Paket Gold">
        </div>
        <div class="fg2" id="fieldPppoe" style="display:none">
          <label class="flbl">Username PPPoE</label>
          <input type="text" class="fi" id="fPppoe" placeholder="Username PPPoE client">
        </div>
        <div class="fg2">
          <label class="flbl">Catatan Kegiatan <span class="req">*</span></label>
          <textarea class="fi" id="fCat" rows="3" placeholder="Deskripsi kegiatan yang dilakukan..." style="resize:vertical"></textarea>
        </div>

        <div class="fsec">Dokumentasi Foto</div>
        <div class="fg2">
          <label class="flbl">Foto 1 <span class="req">*</span> <span style="font-size:10px;color:var(--txt4);font-weight:400">Wajib</span></label>
          <div class="upl" id="uplZone">
            <input type="file" id="fFoto" accept="image/*,.heic,.heif,.webp,.bmp,.tiff,.tif" onchange="handleUplSlot(this,1)" style="display:none">
            <input type="file" id="fKamera" accept="image/*" capture="environment" onchange="handleUplSlot(this,1)" style="display:none">
            <div class="upl-icon"><svg class="ic-lg"><use href="#ic-camera"/></svg></div>
            <div class="upl-t" id="uplTxt">Foto utama dokumentasi</div>
            <div class="upl-s">JPG, PNG, HEIC, WEBP · Maks 10MB</div>
            <div style="display:flex;gap:8px;margin-top:10px;justify-content:center">
              <button type="button" onclick="event.stopPropagation();document.getElementById('fFoto').click()" class="btn-upl btn-upl-ghost">Pilih File</button>
              <button type="button" onclick="event.stopPropagation();document.getElementById('fKamera').click()" class="btn-upl btn-upl-solid">Kamera</button>
            </div>
            <img id="prevImg" class="prev">
          </div>
        </div>
        <div class="fg2">
          <label class="flbl">Foto 2 <span style="font-size:10px;color:var(--txt4);font-weight:400">Opsional</span></label>
          <div class="upl" id="uplZone2">
            <input type="file" id="fFoto2" accept="image/*,.heic,.heif,.webp,.bmp,.tiff,.tif" onchange="handleUplSlot(this,2)" style="display:none">
            <input type="file" id="fKamera2" accept="image/*" capture="environment" onchange="handleUplSlot(this,2)" style="display:none">
            <div class="upl-icon"><svg class="ic-lg"><use href="#ic-camera"/></svg></div>
            <div class="upl-t" id="uplTxt2">Foto tambahan (opsional)</div>
            <div class="upl-s">JPG, PNG, HEIC, WEBP · Maks 10MB</div>
            <div style="display:flex;gap:8px;margin-top:10px;justify-content:center">
              <button type="button" onclick="event.stopPropagation();document.getElementById('fFoto2').click()" class="btn-upl btn-upl-ghost">Pilih File</button>
              <button type="button" onclick="event.stopPropagation();document.getElementById('fKamera2').click()" class="btn-upl btn-upl-solid">Kamera</button>
            </div>
            <img id="prevImg2" class="prev">
          </div>
        </div>
        <button class="btn-sub" id="btnSub" onclick="submitLap()">Kirim Laporan</button>
      </div>
    </div>`;
}

// Tampilkan/sembunyikan kolom sesuai jenis kegiatan
function onJenisChange() {
  const jenis = document.querySelector('input[name="jenis"]:checked')?.value;
  if (!jenis) return;
  document.getElementById('jenisFields').style.display = 'block';
  const fieldTempat     = document.getElementById('fieldTempat');
  const fieldNamaClient = document.getElementById('fieldNamaClient');
  const lblNamaClient   = document.getElementById('lblNamaClient');
  const fieldPaket      = document.getElementById('fieldPaket');
  const fieldPppoe      = document.getElementById('fieldPppoe');
  if (jenis === 'Pemasangan Baru') {
    fieldTempat.style.display = 'none';
    fieldNamaClient.style.display = 'block';
    fieldPaket.style.display = 'block';
    fieldPppoe.style.display = 'block';
    lblNamaClient.innerHTML = 'Nama Client <span class="req">*</span>';
    document.getElementById('fTempat').value = '';
  } else if (jenis === 'Instalasi CCTV') {
    // Instalasi CCTV: tampilkan client (wajib) + tempat
    fieldTempat.style.display = 'block';
    fieldNamaClient.style.display = 'block';
    fieldPaket.style.display = 'none';
    fieldPppoe.style.display = 'none';
    lblNamaClient.innerHTML = 'Nama Client <span class="req">*</span>';
  } else {
    // Perbaikan / Pemeliharaan
    fieldTempat.style.display = 'block';
    fieldNamaClient.style.display = 'block';
    fieldPaket.style.display = 'none';
    fieldPppoe.style.display = 'none';
    lblNamaClient.innerHTML = 'Nama Client <span style="font-size:9px;font-weight:600;padding:2px 5px;border-radius:4px;background:#E2E8F0;color:var(--t3)">Opsional</span>';
  }
}

// ================= RIWAYAT =================
let riwayatRange = 'today'; // default hari ini
async function renderRiw(range) {
  if (range) riwayatRange = range;
  const con = document.getElementById('con');
  con.innerHTML = `<div style="background:#fff;border-radius:var(--rad);padding:14px 16px;margin-bottom:12px;border:1px solid var(--bd);box-shadow:var(--sh)"><div style="font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:700">Riwayat Laporan</div><div style="font-size:12px;color:var(--t2)">Mengambil data...</div></div><div class="loading-row"><div class="spin"></div><span>Mengambil data...</span></div>`;
  let rows = [];
  try {
    const res = await fetch('/api/laporan?range=' + riwayatRange, { headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) { rows = await res.json(); if (riwayatRange === 'all') localStorage.setItem('tc_lap_cache', JSON.stringify(rows)); }
    else throw new Error();
  } catch (e) {
    rows = JSON.parse(localStorage.getItem('tc_lap_cache') || '[]');
  }
  riwayatData = rows.filter(r => (r.teknisi || r['Teknisi'] || '') === currentUser.username);
  const mine = riwayatData;

  const rangeLabels = { today: 'Hari Ini', month: '1 Bulan', all: 'Semua' };
  const filterBar = `<div style="display:flex;gap:8px;margin-bottom:10px">
    ${['today','month','all'].map(k => `<button onclick="renderRiw('${k}')" style="flex:1;padding:7px 4px;border-radius:10px;border:1.5px solid ${riwayatRange===k?'var(--red)':'var(--bd)'};background:${riwayatRange===k?'var(--red)':'#fff'};color:${riwayatRange===k?'#fff':'var(--t2)'};font-family:inherit;font-size:12px;font-weight:600;cursor:pointer">${rangeLabels[k]}</button>`).join('')}
  </div>`;

  const header = `<div style="background:#fff;border-radius:var(--rad);padding:14px 16px;margin-bottom:12px;border:1px solid var(--bd);box-shadow:var(--sh)">
    <div style="font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:700">Riwayat Laporan</div>
    <div style="font-size:12px;color:var(--t2);margin-bottom:10px">${mine.length} laporan ditemukan · ${rangeLabels[riwayatRange]}</div>
    ${filterBar}
  </div>`;

  if (mine.length === 0) {
    con.innerHTML = header + `<div class="empty"><div class="empty-icon"><svg class="ic-lg"><use href="#ic-history"/></svg></div><div class="et">Belum ada laporan</div><div class="es">${riwayatRange==='today'?'Belum ada laporan hari ini':'Buat laporan kegiatan pertama'}</div></div>`;
    return;
  }
  con.innerHTML = header + mine.map((r, idx) => {
    const j = r.jenis_kegiatan || r['Jenis Kegiatan'] || '-';
    const tgl = r.tanggal || r['Tanggal'] || '-';
    const wkt = (r.waktu || r['Waktu'] || '-').substring(0, 5);
    const cli = r.nama_client || r['Nama Client'] || '-';
    const cat = r.catatan || r['Catatan'] || '-';
    const rid = r.report_id || '';
    const ico = j === 'Pemasangan Baru' ? '<svg class="ic" style="color:var(--blue)"><use href="#ic-wifi"/></svg>' : j === 'Perbaikan' ? '<svg class="ic" style="color:var(--orange)"><use href="#ic-tool"/></svg>' : j === 'Instalasi CCTV' ? '📷' : '<svg class="ic" style="color:var(--green)"><use href="#ic-shield"/></svg>';
    const bc  = j === 'Pemasangan Baru' ? 'bb' : j === 'Perbaikan' ? 'bp' : j === 'Instalasi CCTV' ? 'bi' : 'bm';
    const fotoUrl = r.foto || r['URL Foto'] || '';
    return `<div class="rc" onclick="showDetail(${idx})" style="cursor:pointer;transition:transform .15s" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
      <div class="rt"><div><div class="rtype">${ico} ${j}</div><div class="rdate">${tgl} · ${wkt}${rid ? ` · <span style="font-size:10px;color:var(--t3);font-weight:600">${rid}</span>` : ''}</div></div><div class="rbadge ${bc}">${j === 'Pemasangan Baru' ? 'Baru' : j}</div></div>
      <div class="rbody" style="margin-bottom:6px">${cat.length > 80 ? cat.substring(0, 80) + '...' : cat}</div>
      <div class="rmeta">${cli && cli !== '-' ? `<div class="mc"> ${cli}</div>` : ''}${fotoUrl && fotoUrl !== '-' ? '<div class="mc"> Ada foto</div>' : ''}<div class="mc" style="margin-left:auto;color:var(--red);font-weight:600"><svg class='ic-sm'><use href='#ic-arrow-right'/></svg></div></div>
    </div>`;
  }).join('');
}

// ================= DETAIL =================
function showDetail(idx) {
  const r = riwayatData[idx];
  if (!r) { toast('Data tidak ditemukan', 'err'); return; }
  const j       = r.jenis_kegiatan || r['Jenis Kegiatan'] || '-';
  const tgl     = r.tanggal || r['Tanggal'] || '-';
  const wkt     = (r.waktu || r['Waktu'] || '-').substring(0, 5);
  const cli     = r.nama_client || r['Nama Client'] || '-';
  const tempat  = r.tempat || r['Tempat'] || '-';
  const estimasi= r.estimasi || r['Estimasi'] || '-';
  const cat     = r.catatan || r['Catatan'] || '-';
  const fotoUrl = r.foto || r['URL Foto'] || '';
  const fotoUrl2 = r.foto_2 || '';
  const ts      = r.created_at ? new Date(r.created_at).toLocaleString('id-ID') : '-';
  const rid     = r.report_id || '';
  const paket   = r.paket || '';
  const pppoe   = r.pppoe || '';
  const ico     = j === 'Pemasangan Baru' ? '<svg class="ic" style="color:var(--blue)"><use href="#ic-wifi"/></svg>' : j === 'Perbaikan' ? '<svg class="ic" style="color:var(--orange)"><use href="#ic-tool"/></svg>' : j === 'Instalasi CCTV' ? '📷' : '<svg class="ic" style="color:var(--green)"><use href="#ic-shield"/></svg>';
  const sumber  = r.sumber === 'tugas' ? '📋 Dari Tugas Admin' : null;

  document.getElementById('con').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <button onclick="renderRiw()" style="width:36px;height:36px;border-radius:10px;border:1.5px solid var(--bd);background:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;"><svg class="ic-sm"><use href="#ic-chevron-left"/></svg></button>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:700">Detail Laporan</div>
    </div>
    <div style="background:var(--red);border-radius:18px;padding:22px;margin-bottom:14px;color:#fff">
      <div style="font-size:11px;opacity:.6;margin-bottom:4px">Jenis Kegiatan</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:700;margin-bottom:12px">${ico} ${j}</div>
      ${rid ? `<div style="font-size:11px;opacity:.7;margin-bottom:8px;font-weight:600;letter-spacing:.5px">🔖 ${rid}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <div style="background:rgba(255,255,255,.15);padding:5px 10px;border-radius:50px;font-size:11px"> ${tgl}</div>
        <div style="background:rgba(255,255,255,.15);padding:5px 10px;border-radius:50px;font-size:11px"> ${wkt}</div>
        ${estimasi !== '-' ? `<div style="background:rgba(255,255,255,.15);padding:5px 10px;border-radius:50px;font-size:11px">⏱️ ${estimasi}</div>` : ''}
        ${sumber ? `<div style="background:rgba(255,255,255,.2);padding:5px 10px;border-radius:50px;font-size:11px;font-weight:600">${sumber}</div>` : ''}
      </div>
    </div>
    ${fotoUrl && fotoUrl !== '-' && fotoUrl !== '' ? `
    <div class="fcard" style="margin-bottom:12px;padding:14px">
      <div class="fsec">Foto Dokumentasi</div>
      <div style="display:grid;grid-template-columns:${fotoUrl2 ? '1fr 1fr' : '1fr'};gap:8px">
        <div>
          ${fotoUrl2 ? '<div style="font-size:11px;color:var(--txt4);margin-bottom:5px;font-weight:500">Foto 1</div>' : ''}
          <img src="${fotoUrl}" style="width:100%;max-height:240px;object-fit:cover;border-radius:var(--r8);cursor:pointer" onclick="window.open('${fotoUrl}','_blank')" onerror="this.style.display='none'"/>
        </div>
        ${fotoUrl2 ? '<div><div style="font-size:11px;color:var(--txt4);margin-bottom:5px;font-weight:500">Foto 2</div><img src="'+fotoUrl2+'" style="width:100%;max-height:240px;object-fit:cover;border-radius:var(--r8);cursor:pointer" onclick="window.open(this.src,\'_blank\')" onerror="this.style.display=\'none\'"/></div>' : ''}
      </div>
      <div style="font-size:11px;color:var(--txt3);margin-top:6px;text-align:center">Tap foto untuk buka ukuran penuh</div>
    </div>` : `<div class="fcard" style="margin-bottom:12px;padding:14px"><div class="fsec">Foto Dokumentasi</div><div style="text-align:center;padding:20px;color:var(--txt4)"><div class="empty-icon" style="margin:0 auto 8px"><svg class="ic-lg"><use href="#ic-camera"/></svg></div><div style="font-size:13px">Tidak ada foto</div></div></div>`}
    <div class="fcard" style="margin-bottom:12px;padding:14px">
      <div class="fsec">Informasi Kegiatan</div>
      <div style="display:flex;flex-direction:column;gap:0">
        ${rid ? `<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--t3)">ID Laporan</span><span style="font-size:12px;font-weight:700;color:var(--red)">${rid}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--t3)">Teknisi</span><span style="font-size:13px;font-weight:600">${currentUser.username}</span></div>
        <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--t3)">Tanggal</span><span style="font-size:13px;font-weight:600">${tgl}</span></div>
        <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--t3)">Waktu</span><span style="font-size:13px;font-weight:600">${wkt}</span></div>
        <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--t3)">Estimasi</span><span style="font-size:13px;font-weight:600">${estimasi !== '-' ? estimasi : '—'}</span></div>
        ${cli !== '-' ? `<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--t3)">Nama Client</span><span style="font-size:13px;font-weight:600">${cli}</span></div>` : ''}
        ${tempat !== '-' ? `<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--t3)">Tempat</span><span style="font-size:13px;font-weight:600;text-align:right;max-width:60%">${tempat}</span></div>` : ''}
        ${paket ? `<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--t3)">Paket</span><span style="font-size:13px;font-weight:600">${paket}</span></div>` : ''}
        ${pppoe ? `<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--t3)">PPPoE</span><span style="font-size:13px;font-weight:600">${pppoe}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;padding:9px 0"><span style="font-size:12px;color:var(--t3)">Dibuat</span><span style="font-size:12px;color:var(--t2)">${ts}</span></div>
      </div>
    </div>
    <div class="fcard" style="padding:14px"><div class="fsec">Catatan Kegiatan</div><div style="font-size:13px;color:var(--t2);line-height:1.7;white-space:pre-wrap">${esc(cat)}</div></div>`;
}

// ================= PROFIL =================
async function renderProfil() {
  let mine = JSON.parse(localStorage.getItem('tc_lap_cache') || '[]').filter(r => r.teknisi === currentUser.username);
  try {
    const res = await fetch('/api/laporan', { headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) { const data = await res.json(); localStorage.setItem('tc_lap_cache', JSON.stringify(data)); mine = data; }
  } catch (e) {}

  // Ambil profil terkini dari server
  try {
    const res = await fetch('/api/profile', { headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) { const d = await res.json(); currentUser = { ...currentUser, ...d.user }; localStorage.setItem('tc_user', JSON.stringify(currentUser)); }
  } catch (e) {}

  const avatarHtml = currentUser.foto_profil
    ? `<img src="${currentUser.foto_profil}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,.5);margin:0 auto 10px;display:block">`
    : `<div style="width:80px;height:80px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;font-size:28px;font-weight:700;border:3px solid rgba(255,255,255,.35)">${currentUser.username.substring(0,2).toUpperCase()}</div>`;

  document.getElementById('con').innerHTML = `
    <div style="border-radius:18px;overflow:hidden;margin-bottom:14px;box-shadow:0 4px 24px rgba(72,20,20,.18)">
      <!-- COVER / BANNER -->
      <div style="position:relative;width:100%;height:120px;">
        ${currentUser.foto_cover
          ? `<img src="${currentUser.foto_cover}" style="width:100%;height:120px;object-fit:cover;display:block">`
          : `<div style="width:100%;height:120px;background:var(--red)"></div>`}
        <button onclick="triggerCoverUpload()" style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.45);color:#fff;border:none;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;backdrop-filter:blur(4px)">
           Ganti Cover
        </button>
        <input type="file" id="coverInput" accept="image/*" style="display:none" onchange="handleCoverUpload(this)">
      </div>
      <!-- PROFIL INFO -->
      <div style="background:var(--red);padding:0 20px 20px;text-align:center;color:#fff">
        <div style="position:relative;display:inline-block;margin-top:-36px;margin-bottom:8px">
          ${avatarHtml}
          <button onclick="triggerAvatarUpload()" style="position:absolute;bottom:2px;right:2px;width:26px;height:26px;background:var(--red);border:2px solid #fff;border-radius:50%;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;padding:0"></button>
          <input type="file" id="avatarInput" accept="image/*,.heic,.heif" style="display:none" onchange="handleAvatarUpload(this)">
        </div>
        <div style="font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:700">${currentUser.nama_lengkap || currentUser.username}</div>
        ${currentUser.nama_lengkap ? `<div style="font-size:12px;opacity:.7;margin-top:2px">@${currentUser.username}</div>` : ''}
        <div style="font-size:12px;opacity:.7;margin-top:3px"><svg class=\"ic-sm\" style=\"vertical-align:middle;margin-right:4px\"><use href=\"#ic-phone\"/></svg>${currentUser.phone || '-'}</div>
        <div style="font-size:12px;opacity:.6;margin-top:2px"><svg class=\"ic-sm\" style=\"vertical-align:middle;margin-right:4px\"><use href=\"#ic-mail\"/></svg>${currentUser.email || '-'}</div>
        <div style="font-size:11px;opacity:.5;margin-top:3px">Bergabung ${new Date(currentUser.created_at).toLocaleDateString('id-ID',{year:'numeric',month:'long',day:'numeric'})}</div>
      </div>
    </div>

    <div class="sgrid" style="margin-bottom:14px">
      <div class="sc"><div class="sc-n">${mine.length}</div><div class="sc-l">Total Laporan</div></div>
      <div class="sc"><div class="sc-n">${mine.filter(r=>r.jenis_kegiatan==='Pemasangan Baru').length}</div><div class="sc-l">Pemasangan</div></div>
      <div class="sc"><div class="sc-n">${mine.filter(r=>r.jenis_kegiatan==='Perbaikan').length}</div><div class="sc-l">Perbaikan</div></div>
      <div class="sc"><div class="sc-n">${mine.filter(r=>r.jenis_kegiatan==='Pemeliharaan').length}</div><div class="sc-l">Pemeliharaan</div></div>
      <div class="sc"><div class="sc-n" style="color:#7C3AED">${mine.filter(r=>r.jenis_kegiatan==='Instalasi CCTV').length}</div><div class="sc-l">Inst. CCTV</div></div>
    </div>

    <!-- Form Edit Profil -->
    <div class="fcard" id="editProfilCard" style="display:none">
      <div class="fsec">Edit Profil</div>
      <div class="fg2">
        <label class="flbl">Nama Lengkap</label>
        <input type="text" class="fi" id="editNamaLengkap" value="${currentUser.nama_lengkap || ''}" placeholder="Nama lengkap kamu">
      </div>
      <div class="fg2">
        <label class="flbl">Username <span class="req">*</span></label>
        <input type="text" class="fi" id="editUsername" value="${currentUser.username}" placeholder="Username unik">
        <div style="font-size:11px;color:var(--t3);margin-top:4px">Hanya huruf, angka, underscore (3-20 karakter)</div>
      </div>
      <div class="fg2">
        <label class="flbl">Nomor HP</label>
        <input type="tel" class="fi" id="editPhone" value="${currentUser.phone || ''}" placeholder="08xxxxxxxxxx">
      </div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button onclick="document.getElementById('editProfilCard').style.display='none'" style="flex:1;padding:11px;border:1.5px solid var(--bd);border-radius:var(--rads);background:#fff;font-family:inherit;font-size:13px;font-weight:600;color:var(--t2);cursor:pointer">Batal</button>
        <button onclick="simpanProfil()" id="btnSimpanProfil" style="flex:2;padding:11px;border:none;border-radius:var(--rads);background:var(--red);color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">Simpan Perubahan</button>
      </div>
    </div>

    <div class="fcard">
      <div class="fsec">Pengaturan Akun</div>
      <button onclick="toggleEditProfil()" class="btn-profil-edit">Edit Profil & Nama</button>
      <div class="status-row ${cfg.supaUrl?'status-ok':'status-no'}" style="margin-top:12px"><span>Supabase</span><span>${cfg.supaUrl?'Terhubung':'Belum terhubung'}</span></div>
      <div class="status-row ${cfg.gsUrl?'status-ok':'status-no'}" style="margin-top:6px"><span>Google Sheets</span><span>${cfg.gsUrl?'Terhubung':'Belum terhubung'}</span></div>
      <button onclick="document.getElementById('setupModal').classList.add('show')" style="width:100%;padding:11px;border:1.5px solid var(--bd);border-radius:var(--rads);background:#fff;font-family:inherit;font-size:13px;font-weight:600;color:var(--red);cursor:pointer;margin-top:12px">Ubah Konfigurasi</button>
      <button onclick="doLogout()" style="width:100%;padding:11px;border:1.5px solid #FFCCCC;border-radius:var(--rads);background:#FFF0F0;font-family:inherit;font-size:13px;font-weight:600;color:var(--r);cursor:pointer;margin-top:8px">Keluar</button>
    </div>`;
}

function toggleEditProfil() {
  const card = document.getElementById('editProfilCard');
  card.style.display = card.style.display === 'none' ? 'block' : 'none';
  if (card.style.display === 'block') card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function triggerAvatarUpload() {
  document.getElementById('avatarInput')?.click();
}

async function handleAvatarUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Foto maks 5MB', 'err'); return; }
  showLoading('Mengupload foto profil...');
  try {
    const dataUrl = await readAsDataURL(file);
    const compressed = await compressImage(dataUrl, 400, 0.85);
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ foto_profil: compressed })
    });
    const data = await res.json();
    hideLoading();
    if (!res.ok) { toast(data.error || 'Gagal upload foto', 'err'); return; }
    currentUser = { ...currentUser, ...data.user };
    localStorage.setItem('tc_user', JSON.stringify(currentUser));
    toast('Foto profil berhasil diperbarui!', 'ok');
    renderProfil();
    updateNav();
  } catch (e) {
    hideLoading(); toast('Gagal upload foto', 'err');
  }
  input.value = '';
}

function triggerCoverUpload() {
  toast(' Rekomendasi: 1920×480px · Maks 5MB (JPG/PNG)', 'ok');
  document.getElementById('coverInput')?.click();
}

async function handleCoverUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    toast('Cover maks 5MB. Rekomendasi ukuran: 1920×480px', 'err');
    input.value = '';
    return;
  }
  showLoading('Mengupload cover profil...');
  try {
    const dataUrl = await readAsDataURL(file);
    const compressed = await compressImage(dataUrl, 1920, 0.82);
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ foto_cover: compressed })
    });
    const data = await res.json();
    hideLoading();
    if (!res.ok) { toast(data.error || 'Gagal upload cover', 'err'); return; }
    currentUser = { ...currentUser, ...data.user };
    localStorage.setItem('tc_user', JSON.stringify(currentUser));
    toast(' Cover profil diperbarui!', 'ok');
    renderProfil();
  } catch (e) {
    hideLoading(); toast('Gagal upload cover', 'err');
  }
  input.value = '';
}

async function simpanProfil() {
  const btn = document.getElementById('btnSimpanProfil');
  if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

  const nama_lengkap = document.getElementById('editNamaLengkap')?.value?.trim();
  const username     = document.getElementById('editUsername')?.value?.trim();
  const phone        = document.getElementById('editPhone')?.value?.trim();

  if (!username) { toast('Username wajib diisi', 'err'); if(btn){btn.disabled=false;btn.textContent='Simpan Perubahan';} return; }

  try {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ username, nama_lengkap, phone })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Gagal simpan', 'err'); return; }
    currentUser = { ...currentUser, ...data.user };
    localStorage.setItem('tc_user', JSON.stringify(currentUser));
    toast('Profil berhasil diperbarui!', 'ok');
    renderProfil();
    updateNav();
  } catch (e) {
    toast('Gagal konek ke server', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Simpan Perubahan'; }
  }
}

// ================= ADMIN PANEL =================

// Tampilkan halaman admin dengan loading
// ── ADMIN STATE ───────────────────────────────────────────────────────
let adminActiveTab = 'laporan'; // 'laporan' | 'tugas'
let adminRange = 'today'; // default hari ini

async function renderAdmin(range) {
  if (range) adminRange = range;
  const con = document.getElementById('con-adm');
  con.innerHTML = `<div class="loading-row"><div class="spin" style="border-top-color:var(--adm)"></div><span>Memuat data...</span></div>`;

  try {
    // Ambil laporan, daftar teknisi (dari users), dan tugas sekaligus
    const [resAdmin, resTugas, resUsers] = await Promise.all([
      fetch('/api/admin?range=' + adminRange, { headers: { Authorization: 'Bearer ' + token } }),
      fetch('/api/tugas',  { headers: { Authorization: 'Bearer ' + token } }),
      fetch('/api/users',  { headers: { Authorization: 'Bearer ' + token } })
    ]);
    const resultAdmin = await resAdmin.json();
    if (!resAdmin.ok) {
      con.innerHTML = `<div style="background:#fff;border-radius:14px;padding:24px;text-align:center;color:var(--r)">${resultAdmin.error || 'Server error'}</div>`;
      return;
    }
    adminData     = resultAdmin.data || [];
    adminFiltered = [...adminData];
    if (resTugas.ok) tugasData = await resTugas.json();

    // ambil daftar teknisi dari tabel users
    if (resUsers.ok) {
      const usersData = await resUsers.json();
      tugasTeknisiList = usersData
        .filter(u => u.role !== 'admin')
        .map(u => u.username)
        .sort();
    } else {
      tugasTeknisiList = [...new Set(adminData.map(r => r['Teknisi'] || r.teknisi || '').filter(Boolean))].sort();
    }

    renderAdminTabs();
  } catch (e) {
    con.innerHTML = `<div style="background:#fff;border-radius:14px;padding:24px;text-align:center;color:var(--r)"> Gagal konek: ${e.message}</div>`;
  }
}

function renderAdminTabs() {
  const con = document.getElementById('con-adm');
  const pendingCount = tugasData.filter(t => t.status === 'pending').length;
  const rangeLabels = { today: 'Hari Ini', month: '1 Bulan', all: 'Semua' };
  con.innerHTML = `
    <div class="adm-hdr">
      <div><div class="adm-hdr-t"> Admin Panel</div><div class="adm-hdr-s">PT. Data Semesta · TeknisiApp</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${'Notification' in window && Notification.permission !== 'granted' ? `<button class="adm-refresh" onclick="requestPushPermission()" style="background:rgba(251,191,36,.2);border-color:rgba(251,191,36,.5);color:#92400e">🔔 Aktifkan Notif</button>` : ''}
        <button class="adm-refresh" onclick="renderAdmin()">Refresh</button>
      </div>
    </div>
    <div style="display:flex;gap:6px;padding:0 16px 10px;background:#fff;border-bottom:1px solid var(--bd)">
      ${['today','month','all'].map(k => `<button onclick="renderAdmin('${k}')" style="flex:1;padding:6px 4px;border-radius:10px;border:1.5px solid ${adminRange===k?'var(--adm)':'var(--bd)'};background:${adminRange===k?'var(--adm)':'#fff'};color:${adminRange===k?'#fff':'var(--t2)'};font-family:inherit;font-size:11px;font-weight:700;cursor:pointer">${rangeLabels[k]}</button>`).join('')}
    </div>
    <div class="adm-tab-bar">
      <button class="adm-tab ${adminActiveTab==='laporan'?'active':''}" onclick="switchAdminTab('laporan')"> Laporan <span style="background:rgba(255,255,255,.25);padding:1px 7px;border-radius:50px;font-size:11px;margin-left:4px">${adminData.length}</span></button>
      <button class="adm-tab ${adminActiveTab==='tugas'?'active':''}" onclick="switchAdminTab('tugas')"> Tugas ${pendingCount>0?`<span style="background:#f72e2e;padding:1px 7px;border-radius:50px;font-size:11px;margin-left:4px;color:#fff">${pendingCount}</span>`:''}</button>
      <button class="adm-tab ${adminActiveTab==='akun'?'active':''}" onclick="switchAdminTab('akun')"> Akun Teknisi</button>
      <button class="adm-tab ${adminActiveTab==='barang'?'active':''}" onclick="switchAdminTab('barang')"> Barang</button>
    </div>
    <div id="adm-tab-content"></div>
  `;
  renderAdminTabContent();
}

function switchAdminTab(tab) {
  adminActiveTab = tab;
  document.querySelectorAll('.adm-tab').forEach((b,i) => {
    b.classList.toggle('active', (i===0&&tab==='laporan')||(i===1&&tab==='tugas')||(i===2&&tab==='akun'));
  });
  renderAdminTabContent();
}

function renderAdminTabContent() {
  if (adminActiveTab === 'laporan') renderAdminTable();
  else if (adminActiveTab === 'tugas') renderAdminTugasPanel();
  else if (adminActiveTab === 'barang') renderAdminBarangPanel();
  else renderAdminAkunPanel();
}

// Render tabel utama admin
function renderAdminTable() {
  const con = document.getElementById('adm-tab-content') || document.getElementById('con-adm');
  const data = adminFiltered;
  const teknisiSet = new Set(adminData.map(r => r['Teknisi'] || r.teknisi || ''));
  const teknisiList = [...teknisiSet].sort();
  const baru = adminData.filter(r => (r['Jenis Kegiatan']||'') === 'Pemasangan Baru').length;
  const prb  = adminData.filter(r => (r['Jenis Kegiatan']||'') === 'Perbaikan').length;
  const pml  = adminData.filter(r => (r['Jenis Kegiatan']||'') === 'Pemeliharaan').length;
  const cctv = adminData.filter(r => (r['Jenis Kegiatan']||'') === 'Instalasi CCTV').length;


  con.innerHTML = `
    <div class="adm-stats">
      <div class="adm-stat"><div class="adm-stat-n">${adminData.length}</div><div class="adm-stat-l">Total Laporan</div></div>
      <div class="adm-stat" style="border-color:#0066FF"><div class="adm-stat-n" style="color:#0066FF">${teknisiSet.size}</div><div class="adm-stat-l">Teknisi Aktif</div></div>
      <div class="adm-stat" style="border-color:#00C48C"><div class="adm-stat-n" style="color:#00C48C">${baru}</div><div class="adm-stat-l">Pemasangan Baru</div></div>
      <div class="adm-stat" style="border-color:#F59E0B"><div class="adm-stat-n" style="color:#F59E0B">${prb}</div><div class="adm-stat-l">Perbaikan</div></div>
      <div class="adm-stat" style="border-color:#8B5CF6"><div class="adm-stat-n" style="color:#8B5CF6">${pml}</div><div class="adm-stat-l">Pemeliharaan</div></div>
      ${cctv > 0 ? `<div class="adm-stat" style="border-color:#7C3AED"><div class="adm-stat-n" style="color:#7C3AED">${cctv}</div><div class="adm-stat-l">Inst. CCTV</div></div>` : ''}
    </div>

    <div class="adm-controls">
      <input type="text" class="adm-search" id="admSearch" placeholder="Cari ID, teknisi, client, catatan..." oninput="filterAdmin()">
      <select class="adm-filter" id="admFilterJenis" onchange="filterAdmin()">
        <option value="">Semua Jenis</option>
        <option value="Pemasangan Baru"> Pemasangan Baru</option>
        <option value="Perbaikan"> Perbaikan</option>
        <option value="Pemeliharaan"> Pemeliharaan</option>
        <option value="Instalasi CCTV">📷 Instalasi CCTV</option>
      </select>
      <select class="adm-filter" id="admFilterTeknisi" onchange="filterAdmin()">
        <option value="">Semua Teknisi</option>
        ${teknisiList.map(t => `<option value="${t}">${t}</option>`).join('')}
      </select>
      <button class="adm-refresh" onclick="showDownloadPanel()" style="background:rgba(0,196,140,0.25);border-color:rgba(0,196,140,0.5)"> Export</button>
      <span style="font-size:12px;color:var(--t3);white-space:nowrap;padding:0 4px">${data.length} hasil</span>
    </div>

    <div class="tbl-wrap">
      ${data.length === 0
        ? `<div class="adm-empty"><div class="empty-icon" style="margin:0 auto 12px"><svg class="ic-lg"><use href="#ic-report"/></svg></div><div style="font-weight:600;color:var(--t2)">Tidak ada data</div></div>`
        : `<div style="overflow-x:auto">
           <table class="tbl">
             <thead>
               <tr>
                 <th style="width:36px">No</th>
                 <th>Timestamp</th>
                 <th>Teknisi</th>
                 <th>No HP</th>
                 <th>Jenis</th>
                 <th>Tanggal</th>
                 <th>Waktu</th>
                 <th>Client</th>
                 <th>Catatan</th>
                 <th>Foto</th>
                 <th style="width:90px">Aksi</th>
               </tr>
             </thead>
             <tbody>
               ${data.map((r, i) => buildAdminRow(r, i)).join('')}
             </tbody>
           </table>
           </div>`
      }
    </div>`;
}

// Build satu baris tabel admin
function buildAdminRow(r, i) {
  const j    = r['Jenis Kegiatan'] || r.jenis_kegiatan || '-';
  const tgl  = r['Tanggal'] || r.tanggal || '-';
  const wkt  = (r['Waktu'] || r.waktu || '-').substring(0, 5);
  const cli  = r['Nama Client'] || r.nama_client || '-';
  const cat  = r['Catatan'] || r.catatan || '-';
  const tek  = r['Teknisi'] || r.teknisi || '-';
  const hp   = r['No HP'] || r.phone || '-';
  const ts   = r['Timestamp'] || r.created_at || '-';
  const foto = r['URL Foto'] || r.foto || '';
  const rid  = r.report_id || '';
  const bc   = j === 'Pemasangan Baru' ? 'background:#E8F4FF;color:#0066FF' : j === 'Perbaikan' ? 'background:#FFF8E6;color:#B7791F' : j === 'Instalasi CCTV' ? 'background:#F3E8FF;color:#7C3AED' : 'background:#E6FAF5;color:#00856E';
  const ico  = j === 'Pemasangan Baru' ? '<svg class="ic" style="color:var(--blue)"><use href="#ic-wifi"/></svg>' : j === 'Perbaikan' ? '<svg class="ic" style="color:var(--orange)"><use href="#ic-tool"/></svg>' : j === 'Instalasi CCTV' ? '📷' : '<svg class="ic" style="color:var(--green)"><use href="#ic-shield"/></svg>';
  const idx  = adminFiltered.indexOf(r);
  return `<tr id="arow-${idx}">
    <td style="color:var(--t3);font-size:11px">${i+1}</td>
    <td style="font-size:10px;color:var(--t3);white-space:nowrap">${rid ? `<span style="font-weight:700;color:var(--adm)">${rid}</span><br>` : ''}${ts.substring(0,16).replace('T',' ')}</td>
    <td style="cursor:pointer;color:var(--adm);font-weight:700" onclick="showAdminDetail(${idx})" title="Lihat detail">${tek}</td>
    <td style="font-size:12px">${hp}</td>
    <td><span class="adm-badge" style="${bc}">${ico} ${j}</span></td>
    <td style="white-space:nowrap">${tgl}</td>
    <td style="white-space:nowrap">${wkt}</td>
    <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(cli)}">${esc(cli)}</td>
    <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--t2)" title="${esc(cat)}">${esc(cat)}</td>
    <td>${foto && foto !== '-' && foto.startsWith('http')
      ? `<img class="tbl-foto" src="${foto}" onclick="window.open('${foto}','_blank')" title="Klik buka foto" onerror="this.style.display='none'">`
      : '<span style="font-size:11px;color:var(--t3)">—</span>'}</td>
    <td>
      <div style="display:flex;gap:4px">
        <button onclick="showAdminDetail(${idx})" class="btn-act btn-view" title="Lihat Detail"><svg class=\"ic-sm\"><use href=\"#ic-eye\"/></svg></button>
        <button onclick="showEditModal(${idx})" class="btn-act btn-edit" title="Edit"><svg class=\"ic-sm\"><use href=\"#ic-edit\"/></svg></button>
        <button onclick="confirmDelete(${idx})" class="btn-act btn-del" title="Hapus"><svg class=\"ic-sm\"><use href=\"#ic-trash\"/></svg></button>
      </div>
    </td>
  </tr>`;
}

// ── DETAIL MODAL ─────────────────────────────────────────────────────
function showAdminDetail(idx) {
  const r      = adminFiltered[idx];
  if (!r) return;
  const j      = r['Jenis Kegiatan'] || r.jenis_kegiatan || '-';
  const tgl    = r['Tanggal'] || r.tanggal || '-';
  const wkt    = (r['Waktu'] || r.waktu || '-').substring(0, 5);
  const cli    = r['Nama Client'] || r.nama_client || '-';
  const tempat = r['Tempat'] || r.tempat || '-';
  const cat    = r['Catatan'] || r.catatan || '-';
  const tek    = r['Teknisi'] || r.teknisi || '-';
  const hp     = r['No HP'] || r.phone || '-';
  const ts     = r['Timestamp'] || r.created_at || '-';
  const foto   = r['URL Foto'] || r.foto || '';
  const rid    = r.report_id || '';
  const paket  = r.paket || r['Paket'] || '';
  const pppoe  = r.pppoe || r['PPPoE'] || '';
  const ico    = j === 'Pemasangan Baru' ? '<svg class="ic" style="color:var(--blue)"><use href="#ic-wifi"/></svg>' : j === 'Instalasi CCTV' ? '📷' : j === 'Perbaikan' ? '<svg class="ic" style="color:var(--orange)"><use href="#ic-tool"/></svg>' : '<svg class="ic" style="color:var(--green)"><use href="#ic-shield"/></svg>';
  const grad   = j === 'Pemasangan Baru' ? 'linear-gradient(135deg,#0a2463,#0066FF)' : j === 'Instalasi CCTV' ? 'linear-gradient(135deg,#1a1a2e,#4a0080)' : j === 'Perbaikan' ? 'linear-gradient(135deg,#5c3a00,#F59E0B)' : 'linear-gradient(135deg,#003d2e,#00C48C)';

  openModal(`
    <div style="background:${grad};border-radius:14px;padding:20px;color:#fff;margin-bottom:16px">
      <div style="font-size:11px;opacity:.7;margin-bottom:4px">Detail Laporan</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:700;margin-bottom:6px">${ico} ${j}</div>
      ${rid ? `<div style="font-size:12px;opacity:.8;font-weight:700;margin-bottom:8px">🔖 ${rid}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:50px;font-size:11px"> ${tgl}</span>
        <span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:50px;font-size:11px"> ${wkt}</span>
        <span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:50px;font-size:11px"> ${tek}</span>
        <span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:50px;font-size:11px"> ${hp}</span>
      </div>
    </div>

    ${foto && foto.startsWith('http') ? `
    <div style="margin-bottom:14px">
      <div class="modal-sec"> Foto Dokumentasi</div>
      <img src="${foto}" onclick="window.open('${foto}','_blank')"
        style="width:100%;max-height:240px;object-fit:cover;border-radius:12px;cursor:pointer"
        onerror="this.parentElement.style.display='none'">
      <div style="font-size:11px;color:var(--t3);text-align:center;margin-top:5px">Tap untuk buka penuh</div>
    </div>` : ''}

    <div class="modal-card">
      <div class="modal-sec"> Informasi Kegiatan</div>
      ${rid ? `<div class="modal-row"><span class="modal-lbl">ID Laporan</span><span class="modal-val" style="color:var(--adm);font-weight:700">${rid}</span></div>` : ''}
      <div class="modal-row"><span class="modal-lbl">Timestamp</span><span class="modal-val">${ts}</span></div>
      <div class="modal-row"><span class="modal-lbl">Teknisi</span><span class="modal-val">${tek}</span></div>
      <div class="modal-row"><span class="modal-lbl">No HP</span><span class="modal-val">${hp}</span></div>
      <div class="modal-row"><span class="modal-lbl">Tanggal</span><span class="modal-val">${tgl}</span></div>
      <div class="modal-row"><span class="modal-lbl">Waktu</span><span class="modal-val">${wkt}</span></div>
      <div class="modal-row"><span class="modal-lbl">Nama Client</span><span class="modal-val">${cli !== '-' ? cli : '—'}</span></div>
      ${tempat !== '-' ? `<div class="modal-row"><span class="modal-lbl">Tempat</span><span class="modal-val">${tempat}</span></div>` : ''}
      ${paket ? `<div class="modal-row"><span class="modal-lbl">Paket</span><span class="modal-val">${paket}</span></div>` : ''}
      ${pppoe ? `<div class="modal-row"><span class="modal-lbl">PPPoE</span><span class="modal-val">${pppoe}</span></div>` : ''}
    </div>
    <div class="modal-card">
      <div class="modal-sec"> Catatan Kegiatan</div>
      <div style="font-size:13px;color:var(--t2);line-height:1.7;white-space:pre-wrap">${esc(cat)}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button onclick="closeModal();showEditModal(${idx})" class="btn-modal-action" style="background:var(--adm);flex:1">Edit</button>
      <button onclick="closeModal();confirmDelete(${idx})" class="btn-modal-action" style="background:var(--r);flex:1">Hapus</button>
    </div>
  `);
}

// ── EDIT MODAL ────────────────────────────────────────────────────────
function showEditModal(idx) {
  const r      = adminFiltered[idx];
  if (!r) return;
  const j      = r['Jenis Kegiatan'] || r.jenis_kegiatan || '';
  const tgl    = r['Tanggal'] || r.tanggal || '';
  const wkt    = (r['Waktu'] || r.waktu || '').substring(0, 5);
  const cli    = r['Nama Client'] || r.nama_client || '';
  const tempat = r['Tempat'] || r.tempat || '';
  const cat    = r['Catatan'] || r.catatan || '';
  const rid    = r.report_id || '';

  openModal(`
    <div style="font-family:'Space Grotesk',sans-serif;font-size:17px;font-weight:700;margin-bottom:4px">Edit Laporan</div>
    <div style="font-size:12px;color:var(--t3);margin-bottom:16px">Teknisi: <strong>${r['Teknisi']||r.teknisi||'-'}</strong>${rid ? ` · <span style="color:var(--adm);font-weight:700">${rid}</span>` : ''}</div>

    <div class="modal-sec">Jenis Kegiatan</div>
    <select id="editJenis" class="fi" style="margin-bottom:12px">
      <option value="Pemasangan Baru"  ${j==='Pemasangan Baru'?'selected':''}> Pemasangan Baru</option>
      <option value="Instalasi CCTV"   ${j==='Instalasi CCTV'?'selected':''}> Instalasi CCTV</option>
      <option value="Perbaikan"        ${j==='Perbaikan'?'selected':''}> Perbaikan</option>
      <option value="Pemeliharaan"     ${j==='Pemeliharaan'?'selected':''}> Pemeliharaan</option>
    </select>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        <div class="modal-sec">Tanggal</div>
        <input type="date" id="editTgl" class="fi" value="${tgl}">
      </div>
      <div>
        <div class="modal-sec">Waktu</div>
        <input type="time" id="editWkt" class="fi" value="${wkt}">
      </div>
    </div>

    <div class="modal-sec">Nama Client</div>
    <input type="text" id="editCli" class="fi" value="${cli === '-' ? '' : cli}" placeholder="Nama client (opsional)" style="margin-bottom:12px">

    <div class="modal-sec">Tempat / Lokasi</div>
    <input type="text" id="editTempat" class="fi" value="${tempat === '-' ? '' : tempat}" placeholder="Lokasi kegiatan (opsional)" style="margin-bottom:12px">

    <div class="modal-sec">Catatan Kegiatan <span style="color:var(--r)">*</span></div>
    <textarea id="editCat" class="fi" rows="4" style="resize:vertical;margin-bottom:16px">${esc(cat)}</textarea>

    <div style="display:flex;gap:8px">
      <button onclick="closeModal()" class="btn-modal-action" style="background:#E2E8F0;color:var(--t);flex:1">Batal</button>
      <button onclick="doEditLaporan(${idx})" class="btn-modal-action" id="btnEditSave" style="background:var(--adm);flex:2">Simpan Perubahan</button>
    </div>
  `);
}

async function doEditLaporan(idx) {
  const r   = adminFiltered[idx];
  if (!r) return;
  const btn = document.getElementById('btnEditSave');
  if (btn) { btn.disabled=true; btn.textContent='Menyimpan...'; }

  const jenis  = document.getElementById('editJenis')?.value;
  const tgl    = document.getElementById('editTgl')?.value;
  const wkt    = document.getElementById('editWkt')?.value;
  const cli    = document.getElementById('editCli')?.value?.trim() || '-';
  const tempat = document.getElementById('editTempat')?.value?.trim() || '-';
  const cat    = document.getElementById('editCat')?.value?.trim();

  if (!jenis || !tgl || !wkt || !cat) { toast('Isi semua field!','err'); if(btn){btn.disabled=false;btn.textContent='Simpan Perubahan';} return; }

  const supabaseId = r.id;
  if (!supabaseId) { toast('ID laporan tidak ditemukan','err'); return; }

  try {
    const res = await fetch('/api/admin', {
      method: 'PUT',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
      body: JSON.stringify({
        supabaseId,
        data: { 'Jenis Kegiatan': jenis, 'Tanggal': tgl, 'Waktu': wkt, 'Nama Client': cli, 'Tempat': tempat, 'Catatan': cat }
      })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error||'Gagal edit','err'); return; }

    // Update lokal di kedua sisi (adminData & adminFiltered share same objects)
    r['Jenis Kegiatan'] = jenis; r['Tanggal'] = tgl;
    r['Waktu'] = wkt; r['Nama Client'] = cli; r['Tempat'] = tempat; r['Catatan'] = cat;
    r.jenis_kegiatan = jenis; r.tanggal = tgl; r.waktu = wkt;
    r.nama_client = cli; r.tempat = tempat; r.catatan = cat;

    closeModal();
    toast('Laporan berhasil diubah!','ok');
    renderAdminTable();
  } catch(e) {
    toast('Gagal konek server','err');
  } finally {
    if(btn){btn.disabled=false;btn.textContent='Simpan Perubahan';}
  }
}

// ── ADMIN TUGAS PANEL ────────────────────────────────────────────────
function renderAdminTugasPanel() {
  const con = document.getElementById('adm-tab-content') || document.getElementById('con-adm');
  const pending = tugasData.filter(t => t.status === 'pending');
  const selesai = tugasData.filter(t => t.status === 'selesai');

  const renderTugasRow = (t, i) => {
    const ico = t.jenis_kegiatan === 'Pemasangan Baru' ? '📶' : t.jenis_kegiatan === 'Instalasi CCTV' ? '📷' : t.jenis_kegiatan === 'Perbaikan' ? '🔧' : '🛡️';
    const tgl = new Date(t.created_at).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
    const statusBadge = t.status === 'selesai'
      ? `<span class="tugas-badge tugas-selesai">✅ Selesai</span>`
      : t.status === 'proses'
      ? `<span class="tugas-badge" style="background:#E8F4FF;color:#0066FF">🔄 Proses</span>`
      : `<span class="tugas-badge tugas-pending">⏳ Pending</span>`;
    const targetLabel = t.is_broadcast
      ? `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:50px;background:#E8EAF6;color:var(--adm)">📢 Broadcast</span>`
      : `<span style="font-size:12px;font-weight:600;color:var(--adm)">${t.teknisi}</span>`;
    const fotoThumb = t.foto
      ? `<img src="${t.foto}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;cursor:pointer" onclick="window.open('${t.foto}','_blank')" onerror="this.style.display='none'">`
      : `<span style="font-size:11px;color:var(--t3)">—</span>`;
    return `<tr>
      <td style="color:var(--t3);font-size:11px">${i+1}</td>
      <td style="white-space:nowrap;font-size:12px;color:var(--t3)">${tgl}</td>
      <td>${targetLabel}</td>
      <td><span class="adm-badge" style="background:#E8EAF6;color:var(--adm)">${ico} ${t.jenis_kegiatan}</span></td>
      <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t.nama_client||''}">${t.nama_client||'-'}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--t2)" title="${t.catatan}">${t.catatan}</td>
      <td>${fotoThumb}</td>
      <td>${statusBadge}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button onclick="showTugasDetail('${t.id}')" class="btn-act btn-view" title="Lihat Detail">👁️</button>
          <button onclick="showEditTugasModal('${t.id}')" class="btn-act btn-edit" title="Edit">✏️</button>
          <button onclick="confirmDeleteTugas('${t.id}')" class="btn-act btn-del" title="Hapus">🗑️</button>
        </div>
      </td>
    </tr>`;
  };

  con.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
      <div>
        <div style="font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:700"> Kelola Tugas Teknisi</div>
        <div style="font-size:12px;color:var(--t3);margin-top:2px">${tugasData.length} total · ${pending.length} pending · ${selesai.length} selesai</div>
      </div>
      <button onclick="showBuatTugasModal()" class="btn-modal-action" style="background:var(--adm);padding:10px 18px;font-size:13px">
        + Beri Tugas
      </button>
    </div>

    ${tugasData.length === 0
      ? `<div style="background:#fff;border-radius:14px;padding:48px;text-align:center;color:var(--t3)"><div class="empty-icon" style="margin:0 auto 12px"><svg class="ic-lg"><use href="#ic-report"/></svg></div><div style="font-weight:600;color:var(--t2)">Belum ada tugas</div><div style="font-size:13px;margin-top:6px">Klik tombol "Beri Tugas" untuk membuat tugas baru</div></div>`
      : `<div class="tbl-wrap"><div style="overflow-x:auto"><table class="tbl">
          <thead><tr>
            <th style="width:36px">No</th>
            <th>Dibuat</th>
            <th>Target</th>
            <th>Jenis</th>
            <th>Client</th>
            <th>Catatan</th>
            <th>Foto</th>
            <th>Status</th>
            <th style="width:90px">Aksi</th>
          </tr></thead>
          <tbody>${tugasData.map((t,i) => renderTugasRow(t,i)).join('')}</tbody>
        </table></div></div>`
    }
  `;
}

function showTugasDetail(id) {
  const t = tugasData.find(x => x.id === id);
  if (!t) return;
  const ico = t.jenis_kegiatan === 'Pemasangan Baru' ? '📶' : t.jenis_kegiatan === 'Instalasi CCTV' ? '📷' : t.jenis_kegiatan === 'Perbaikan' ? '🔧' : '🛡️';
  const tgl = new Date(t.created_at).toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });
  const targetInfo = t.is_broadcast
    ? '<span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:50px;font-size:11px">📢 Broadcast Semua</span>'
    : `<span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:50px;font-size:11px">👤 ${t.teknisi}</span>`;
  const statusBadge = t.status === 'selesai'
    ? '<span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:50px;font-size:11px">✅ Selesai</span>'
    : t.status === 'proses'
    ? '<span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:50px;font-size:11px">🔄 Proses</span>'
    : '<span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:50px;font-size:11px">⏳ Pending</span>';
  openModal(`
    <div style="background:linear-gradient(135deg,var(--adm),#3949ab);border-radius:14px;padding:20px;color:#fff;margin-bottom:16px">
      <div style="font-size:11px;opacity:.7;margin-bottom:4px">Detail Tugas</div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:20px;font-weight:700;margin-bottom:10px">${ico} ${t.jenis_kegiatan}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${targetInfo}
        <span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:50px;font-size:11px">📅 ${tgl}</span>
        ${statusBadge}
      </div>
    </div>
    ${t.foto ? `<div style="margin-bottom:14px"><div class="modal-sec">📎 Foto Referensi (dari Admin)</div><img src="${t.foto}" onclick="window.open('${t.foto}','_blank')" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px;cursor:pointer" onerror="this.parentElement.style.display='none'"><div style="font-size:11px;color:var(--t3);text-align:center;margin-top:5px">Tap untuk buka penuh</div></div>` : ''}
    ${t.foto_selesai ? `<div style="margin-bottom:14px"><div class="modal-sec" style="color:var(--green)">📸 Foto Bukti (dari Teknisi)</div><img src="${t.foto_selesai}" onclick="window.open('${t.foto_selesai}','_blank')" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px;cursor:pointer;border:2px solid var(--green)" onerror="this.parentElement.style.display='none'"><div style="font-size:11px;color:var(--t3);text-align:center;margin-top:5px">Tap untuk buka penuh</div></div>` : ''}
    <div class="modal-card">
      <div class="modal-sec">📋 Info Tugas</div>
      ${t.nama_client && t.nama_client !== '-' ? `<div class="modal-row"><span class="modal-lbl">Nama Client</span><span class="modal-val">${t.nama_client}</span></div>` : ''}
      ${t.tempat && t.tempat !== '-' ? `<div class="modal-row"><span class="modal-lbl">Tempat</span><span class="modal-val">${t.tempat}</span></div>` : ''}
      ${t.link_maps ? `<div class="modal-row"><span class="modal-lbl">Link Maps</span><a href="${t.link_maps}" target="_blank" style="font-size:13px;font-weight:600;color:var(--adm)">🗺️ Buka Maps</a></div>` : ''}
      ${t.barang && t.barang !== '-' ? `<div class="modal-row"><span class="modal-lbl">Barang Dibawa</span><span class="modal-val">${t.barang}</span></div>` : ''}
      ${t.diselesaikan_oleh ? `<div class="modal-row"><span class="modal-lbl">Diselesaikan oleh</span><span class="modal-val" style="color:var(--g);font-weight:700">${t.diselesaikan_oleh}</span></div>` : ''}
    </div>
    <div class="modal-card">
      <div class="modal-sec">📝 Catatan</div>
      <div style="font-size:13px;color:var(--t2);line-height:1.7;white-space:pre-wrap">${t.catatan}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button onclick="closeModal();showEditTugasModal('${t.id}')" class="btn-modal-action" style="background:var(--adm);flex:1">✏️ Edit</button>
      <button onclick="closeModal();confirmDeleteTugas('${t.id}')" class="btn-modal-action" style="background:var(--r);flex:1">🗑️ Hapus</button>
    </div>
  `);
}

function showBuatTugasModal() {
  const opts = tugasTeknisiList.length > 0
    ? tugasTeknisiList.map(t => `<option value="${t}">${t}</option>`).join('')
    : `<option value="">— Belum ada teknisi terdaftar —</option>`;

  openModal(`
    <div style="font-family:'Space Grotesk',sans-serif;font-size:17px;font-weight:700;margin-bottom:4px">📌 Beri Tugas ke Teknisi</div>
    <div style="font-size:12px;color:var(--t3);margin-bottom:16px">Tugas akan muncul di halaman teknisi yang dituju</div>

    <div class="modal-sec">Target Penugasan <span style="color:var(--r)">*</span></div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1.5px solid var(--adm);background:var(--adml);border-radius:var(--rads);cursor:pointer" id="lbl-spesifik" onclick="setTugasTarget('spesifik')">
        <input type="radio" name="tugasTarget" value="spesifik" checked style="accent-color:var(--adm)">
        <div><div style="font-size:13px;font-weight:600">👤 Pilih Teknisi</div><div style="font-size:10px;color:var(--t3)">Hanya satu teknisi</div></div>
      </label>
      <label style="flex:1;display:flex;align-items:center;gap:8px;padding:10px 12px;border:1.5px solid #E2E8F0;background:#fff;border-radius:var(--rads);cursor:pointer" id="lbl-broadcast" onclick="setTugasTarget('broadcast')">
        <input type="radio" name="tugasTarget" value="broadcast" style="accent-color:var(--adm)">
        <div><div style="font-size:13px;font-weight:600">📢 Broadcast Semua</div><div style="font-size:10px;color:var(--t3)">Semua teknisi lihat</div></div>
      </label>
    </div>

    <div id="tugasTeknisiWrap" style="margin-bottom:12px">
      <div class="modal-sec">Pilih Teknisi <span style="color:var(--r)">*</span></div>
      <select id="tugasTeknisi" class="fi">
        <option value="">— Pilih Teknisi —</option>
        ${opts}
      </select>
    </div>

    <div id="tugasBroadcastInfo" style="display:none;background:#E8EAF6;border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--adm)">
      📢 Tugas ini akan muncul ke <strong>semua teknisi</strong>. Siapa pun yang pertama menyelesaikan akan tercatat di riwayat laporan mereka, lalu tugas dihapus otomatis dari semua teknisi.
    </div>

    <div class="modal-sec">Jenis Kegiatan <span style="color:var(--r)">*</span></div>
    <select id="tugasJenis" class="fi" style="margin-bottom:12px" onchange="onTugasJenisChange()">
      <option value="">— Pilih Jenis —</option>
      <option value="Pemasangan Baru">📶 Pemasangan Baru</option>
      <option value="Instalasi CCTV">📷 Instalasi CCTV</option>
      <option value="Perbaikan">🔧 Perbaikan</option>
      <option value="Pemeliharaan">🛡️ Pemeliharaan</option>
    </select>

    <div id="tugasClientTempat" style="display:none">
      <div class="modal-sec">Nama Client</div>
      <input type="text" id="tugasClient" class="fi" placeholder="Nama client / pelanggan" style="margin-bottom:12px">
      <div class="modal-sec">Tempat / Lokasi</div>
      <input type="text" id="tugasTempat" class="fi" placeholder="Alamat / lokasi kegiatan" style="margin-bottom:12px">
    </div>

    <div class="modal-sec">Link Maps <span style="font-size:10px;color:var(--t3);font-weight:400">(opsional)</span></div>
    <input type="url" id="tugasMaps" class="fi" placeholder="https://maps.google.com/..." style="margin-bottom:12px">

    <div class="modal-sec">Barang yang Dibawa <span style="font-size:10px;color:var(--t3);font-weight:400">(opsional)</span></div>
    <input type="text" id="tugasBarang" class="fi" placeholder="Cth: Kabel UTP 10m, Switch 8 port" style="margin-bottom:12px">

    <div class="modal-sec">Catatan <span style="color:var(--r)">*</span></div>
    <textarea id="tugasCatatan" class="fi" rows="3" placeholder="Deskripsi pekerjaan yang harus dilakukan..." style="resize:vertical;margin-bottom:12px"></textarea>

    <div class="modal-sec">Foto Referensi <span style="font-size:10px;color:var(--txt4);font-weight:400">Opsional — panduan visual untuk teknisi</span></div>
    <div class="upl" id="tugasUplZone" style="margin-bottom:16px">
      <input type="file" id="tugasFotoInput" accept="image/*,.heic,.heif,.webp,.bmp" style="display:none" onchange="handleTugasFoto(this)">
      <input type="file" id="tugasKameraInput" accept="image/*" capture="environment" style="display:none" onchange="handleTugasFoto(this)">
      <div class="upl-icon"><svg class="ic-lg"><use href="#ic-camera"/></svg></div>
      <div class="upl-t" id="tugasUplTxt">Foto panduan / referensi</div>
      <div class="upl-s">JPG, PNG, HEIC, WEBP · Maks 10MB</div>
      <div style="display:flex;gap:8px;margin-top:10px;justify-content:center">
        <button type="button" onclick="event.stopPropagation();document.getElementById('tugasFotoInput').click()" class="btn-upl btn-upl-ghost">Pilih File</button>
        <button type="button" onclick="event.stopPropagation();document.getElementById('tugasKameraInput').click()" class="btn-upl btn-upl-solid">Kamera</button>
      </div>
      <img id="tugasFotoPreview" class="prev" style="display:none;max-height:120px">
    </div>

    <div style="display:flex;gap:8px">
      <button onclick="closeModal()" class="btn-modal-action" style="background:#E2E8F0;color:var(--t);flex:1">Batal</button>
      <button onclick="doKirimTugas()" class="btn-modal-action" id="btnKirimTugas" style="background:var(--adm);flex:2">📌 Kirim Tugas</button>
    </div>
  `);
  window._tugasFotoB64 = null;
}

function setTugasTarget(mode) {
  const wrap = document.getElementById('tugasTeknisiWrap');
  const info  = document.getElementById('tugasBroadcastInfo');
  const lblS  = document.getElementById('lbl-spesifik');
  const lblB  = document.getElementById('lbl-broadcast');
  if (mode === 'broadcast') {
    wrap.style.display    = 'none';
    info.style.display    = 'block';
    lblB.style.border     = '1.5px solid var(--adm)';
    lblB.style.background = 'var(--adml)';
    lblS.style.border     = '1.5px solid #E2E8F0';
    lblS.style.background = '#fff';
  } else {
    wrap.style.display    = 'block';
    info.style.display    = 'none';
    lblS.style.border     = '1.5px solid var(--adm)';
    lblS.style.background = 'var(--adml)';
    lblB.style.border     = '1.5px solid #E2E8F0';
    lblB.style.background = '#fff';
  }
}

function handleTugasFoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('File terlalu besar (maks 10MB)', 'err'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    window._tugasFotoB64 = e.target.result;
    const prev = document.getElementById('tugasFotoPreview');
    const txt  = document.getElementById('tugasUplTxt');
    const zone = document.getElementById('tugasUplZone');
    if (prev) { prev.src = e.target.result; prev.style.display = 'block'; }
    if (txt)  txt.textContent = '\u2705 ' + file.name;
    if (zone) zone.classList.add('ok');
  };
  reader.readAsDataURL(file);
}

function onTugasJenisChange() {
  const jenis = document.getElementById('tugasJenis')?.value;
  const block = document.getElementById('tugasClientTempat');
  if (!block) return;
  block.style.display = jenis ? 'block' : 'none';
}

async function doKirimTugas() {
  const btn        = document.getElementById('btnKirimTugas');
  const isBroadcast = document.querySelector('input[name="tugasTarget"]:checked')?.value === 'broadcast';
  const teknisi    = isBroadcast ? null : document.getElementById('tugasTeknisi')?.value?.trim();
  const jenis      = document.getElementById('tugasJenis')?.value;
  const client     = document.getElementById('tugasClient')?.value?.trim();
  const tempat     = document.getElementById('tugasTempat')?.value?.trim();
  const maps       = document.getElementById('tugasMaps')?.value?.trim();
  const barang     = document.getElementById('tugasBarang')?.value?.trim();
  const catatan    = document.getElementById('tugasCatatan')?.value?.trim();
  const foto       = window._tugasFotoB64 || null;

  if (!isBroadcast && !teknisi) { toast('Pilih teknisi dulu!', 'err'); return; }
  if (!jenis)   { toast('Pilih jenis kegiatan!', 'err'); return; }
  if (!catatan) { toast('Catatan wajib diisi!', 'err'); return; }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Mengirim...'; }
  try {
    const res = await fetch('/api/tugas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        teknisi:        teknisi || null,
        is_broadcast:   isBroadcast,
        jenis_kegiatan: jenis,
        nama_client:    client || '-',
        tempat:         tempat || '-',
        link_maps:      maps   || null,
        barang:         barang || '-',
        catatan,
        foto
      })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Gagal kirim', 'err'); return; }
    tugasData.unshift(data.data);
    closeModal();
    toast(isBroadcast ? '📢 Tugas broadcast dikirim ke semua teknisi!' : '✅ Tugas berhasil dikirim!', 'ok');
    renderAdminTabs();
    renderAdminTabContent();
  } catch(e) {
    toast('Gagal konek server', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📌 Kirim Tugas'; }
  }
}

function showEditTugasModal(id) {
  const t = tugasData.find(x => x.id === id);
  if (!t) return;
  openModal(`
    <div style="font-family:'Space Grotesk',sans-serif;font-size:17px;font-weight:700;margin-bottom:4px">Edit Tugas</div>
    <div style="font-size:12px;color:var(--t3);margin-bottom:16px">Teknisi: <strong>${t.teknisi}</strong></div>

    <div class="modal-sec">Jenis Kegiatan <span style="color:var(--r)">*</span></div>
    <select id="etJenis" class="fi" style="margin-bottom:12px">
      <option value="Pemasangan Baru" ${t.jenis_kegiatan==='Pemasangan Baru'?'selected':''}> Pemasangan Baru</option>
      <option value="Instalasi CCTV"  ${t.jenis_kegiatan==='Instalasi CCTV'?'selected':''}> Instalasi CCTV</option>
      <option value="Perbaikan"       ${t.jenis_kegiatan==='Perbaikan'?'selected':''}> Perbaikan</option>
      <option value="Pemeliharaan"    ${t.jenis_kegiatan==='Pemeliharaan'?'selected':''}> Pemeliharaan</option>
    </select>

    <div class="modal-sec">Nama Client</div>
    <input type="text" id="etClient" class="fi" value="${t.nama_client === '-' ? '' : (t.nama_client||'')}" placeholder="Nama client" style="margin-bottom:12px">

    <div class="modal-sec">Tempat / Lokasi</div>
    <input type="text" id="etTempat" class="fi" value="${t.tempat === '-' ? '' : (t.tempat||'')}" placeholder="Lokasi kegiatan" style="margin-bottom:12px">

    <div class="modal-sec">Link Maps <span style="font-size:10px;color:var(--t3);">(opsional)</span></div>
    <input type="url" id="etMaps" class="fi" value="${t.link_maps||''}" placeholder="https://maps.google.com/..." style="margin-bottom:12px">

    <div class="modal-sec">Barang yang Dibawa</div>
    <input type="text" id="etBarang" class="fi" value="${t.barang === '-' ? '' : (t.barang||'')}" placeholder="Cth: Kabel UTP 10m" style="margin-bottom:12px">

    <div class="modal-sec">Catatan <span style="color:var(--r)">*</span></div>
    <textarea id="etCatatan" class="fi" rows="4" style="resize:vertical;margin-bottom:12px">${t.catatan||''}</textarea>

    <div class="modal-sec">Status</div>
    <select id="etStatus" class="fi" style="margin-bottom:16px">
      <option value="pending"  ${t.status==='pending'?'selected':''}> Pending</option>
      <option value="selesai"  ${t.status==='selesai'?'selected':''}> Selesai</option>
    </select>

    <div style="display:flex;gap:8px">
      <button onclick="closeModal()" class="btn-modal-action" style="background:#E2E8F0;color:var(--t);flex:1">Batal</button>
      <button onclick="doEditTugas('${id}')" class="btn-modal-action" id="btnEditTugas" style="background:var(--adm);flex:2"> Simpan</button>
    </div>
  `);
}

async function doEditTugas(id) {
  const btn = document.getElementById('btnEditTugas');
  if (btn) { btn.disabled=true; btn.textContent='Menyimpan...'; }
  const jenis   = document.getElementById('etJenis')?.value;
  const client  = document.getElementById('etClient')?.value?.trim();
  const tempat  = document.getElementById('etTempat')?.value?.trim();
  const maps    = document.getElementById('etMaps')?.value?.trim();
  const barang  = document.getElementById('etBarang')?.value?.trim();
  const catatan = document.getElementById('etCatatan')?.value?.trim();
  const status  = document.getElementById('etStatus')?.value;
  if (!catatan) { toast('Catatan wajib diisi!','err'); if(btn){btn.disabled=false;btn.textContent=' Simpan';} return; }
  try {
    const res = await fetch('/api/tugas', {
      method: 'PUT',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
      body: JSON.stringify({ id, jenis_kegiatan:jenis, nama_client:client||'-', tempat:tempat||'-', link_maps:maps||null, barang:barang||'-', catatan, status })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error||'Gagal edit','err'); return; }
    const idx = tugasData.findIndex(x => x.id === id);
    if (idx >= 0) tugasData[idx] = data.data;
    closeModal();
    toast(' Tugas berhasil diubah!','ok');
    renderAdminTabs();
    renderAdminTabContent();
  } catch(e) {
    toast('Gagal konek server','err');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent=' Simpan'; }
  }
}

function confirmDeleteTugas(id) {
  const t = tugasData.find(x => x.id === id);
  if (!t) return;
  openModal(`
    <div style="text-align:center;padding:8px 0">
      <div style="width:56px;height:56px;background:var(--red-ll);border-radius:var(--r16);display:flex;align-items:center;justify-content:center;margin:0 auto 16px"><svg class="ic-lg" style="color:var(--red)"><use href="#ic-trash"/></svg></div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;margin-bottom:8px">Hapus Tugas?</div>
      <div style="font-size:13px;color:var(--t2);line-height:1.6;margin-bottom:16px">
        Hapus tugas <strong>${t.jenis_kegiatan}</strong> untuk <strong>${t.teknisi}</strong>?
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="closeModal()" class="btn-modal-action" style="background:#E2E8F0;color:var(--t);flex:1">Batal</button>
        <button onclick="doDeleteTugas('${id}')" id="btnDelTugas" class="btn-modal-action" style="background:var(--r);flex:1">Ya, Hapus</button>
      </div>
    </div>
  `);
}

async function doDeleteTugas(id) {
  const btn = document.getElementById('btnDelTugas');
  if (btn) { btn.disabled=true; btn.textContent='Menghapus...'; }
  try {
    const res = await fetch('/api/tugas', {
      method: 'DELETE',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error||'Gagal hapus','err'); return; }
    tugasData = tugasData.filter(x => x.id !== id);
    closeModal();
    toast(' Tugas berhasil dihapus','ok');
    renderAdminTabs();
    renderAdminTabContent();
  } catch(e) {
    toast('Gagal konek server','err');
  } finally {
    if (btn) { btn.disabled=false; }
  }
}

// ── AKUN TEKNISI PANEL ───────────────────────────────────────────────
let akunList = [];

async function renderAdminAkunPanel() {
  const con = document.getElementById('adm-tab-content');
  if (!con) return;
  con.innerHTML = `<div class="loading-row"><div class="spin" style="border-top-color:var(--adm)"></div><span>Memuat data akun...</span></div>`;
  try {
    const res = await fetch('/api/users', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) { con.innerHTML = `<div style="background:#fff;border-radius:14px;padding:24px;text-align:center;color:var(--r)"> Gagal memuat akun</div>`; return; }
    akunList = await res.json();
    renderAkunList();
  } catch(e) {
    con.innerHTML = `<div style="background:#fff;border-radius:14px;padding:24px;text-align:center;color:var(--r)"> ${e.message}</div>`;
  }
}

function renderAkunList() {
  const con = document.getElementById('adm-tab-content');
  if (!con) return;
  const teknisi = akunList.filter(u => u.role !== 'admin');
  const admins  = akunList.filter(u => u.role === 'admin');

  con.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:700"> Daftar Akun Teknisi</div>
      <div style="font-size:12px;color:var(--t3)">${teknisi.length} teknisi · ${admins.length} admin</div>
    </div>
    ${teknisi.length === 0 ? `<div style="background:#fff;border-radius:14px;padding:24px;text-align:center;color:var(--t3)">Belum ada akun teknisi</div>` :
      teknisi.map(u => buildAkunCard(u)).join('')
    }
    ${admins.length > 0 ? `
      <div style="font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:700;color:var(--t3);margin:16px 0 8px"> Akun Admin</div>
      ${admins.map(u => buildAkunCard(u, true)).join('')}
    ` : ''}
  `;
}

function buildAkunCard(u, isAdmin = false) {
  const avatar = u.foto_profil
    ? `<img src="${u.foto_profil}" style="width:46px;height:46px;border-radius:50%;object-fit:cover;border:2px solid var(--bd);flex-shrink:0">`
    : `<div style="width:46px;height:46px;border-radius:50%;background:${isAdmin?'var(--adm)':'var(--p)'};display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:700;flex-shrink:0">${(u.username||'?').substring(0,2).toUpperCase()}</div>`;
  const joined = u.created_at ? new Date(u.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'}) : '-';
  const verified = u.is_verified ? `<span style="background:#E6FAF5;color:#00856E;font-size:10px;font-weight:700;padding:2px 7px;border-radius:50px">v Terverifikasi</span>` : `<span style="background:#FFF8E6;color:#B7791F;font-size:10px;font-weight:700;padding:2px 7px;border-radius:50px"> Belum verif</span>`;

  return `<div style="background:#fff;border-radius:14px;padding:14px;border:1px solid var(--bd);box-shadow:var(--sh);margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:12px">
      ${avatar}
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
          <div style="font-weight:700;font-size:14px">${u.nama_lengkap || u.username}</div>
          ${verified}
        </div>
        ${u.nama_lengkap ? `<div style="font-size:11px;color:var(--t3);margin-bottom:2px">@${u.username}</div>` : ''}
        <div style="font-size:11px;color:var(--t3)"> ${u.phone||'-'} ·  ${u.email||'-'}</div>
        <div style="font-size:11px;color:var(--t3);margin-top:2px"> Bergabung ${joined}</div>
      </div>
      ${!isAdmin ? `<button onclick="showAkunDetail('${u.id}')" style="padding:7px 12px;background:var(--adml);color:var(--adm);border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0"> Detail</button>` : ''}
    </div>
  </div>`;
}

function showAkunDetail(id) {
  const u = akunList.find(x => x.id === id);
  if (!u) return;
  const joined = u.created_at ? new Date(u.created_at).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}) : '-';
  const avatar = u.foto_profil
    ? `<img src="${u.foto_profil}" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,.4)">`
    : `<div style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;border:3px solid rgba(255,255,255,.3);color:#fff">${(u.username||'?').substring(0,2).toUpperCase()}</div>`;
  const coverBg = u.foto_cover ? `url('${u.foto_cover}') center/cover` : 'linear-gradient(135deg,#481414,#f93f3f)';

  const mo = document.getElementById('tugasDetailModal') || (() => {
    const el = document.createElement('div');
    el.id = 'akunDetailModal';
    el.className = 'mo';
    el.style.cssText = 'display:flex';
    document.body.appendChild(el);
    return el;
  })();

  const modalEl = document.getElementById('akunDetailModal') || mo;
  modalEl.id = 'akunDetailModal';
  modalEl.className = 'mo';
  modalEl.style.display = 'flex';

  modalEl.innerHTML = `
    <div class="mbox" style="padding:0;overflow:hidden;max-width:420px">
      <!-- Cover mini -->
      <div style="background:${coverBg};height:80px;position:relative">
        <button onclick="document.getElementById('akunDetailModal').style.display='none'" style="position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,.4);border:none;color:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center">×</button>
      </div>
      <!-- Avatar -->
      <div style="padding:0 20px 20px">
        <div style="margin-top:-36px;margin-bottom:10px">${avatar}</div>
        <div style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700">${u.nama_lengkap || u.username}</div>
        ${u.nama_lengkap ? `<div style="font-size:12px;color:var(--t3);margin-bottom:8px">@${u.username}</div>` : '<div style="margin-bottom:8px"></div>'}
        <div style="display:flex;flex-direction:column;gap:0;background:var(--s2);border-radius:10px;overflow:hidden;border:1px solid var(--bd);margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;padding:9px 12px;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--t3)">Email</span><span style="font-size:12px;font-weight:600">${u.email||'-'}</span></div>
          <div style="display:flex;justify-content:space-between;padding:9px 12px;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--t3)">No. HP</span><span style="font-size:12px;font-weight:600">${u.phone||'-'}</span></div>
          <div style="display:flex;justify-content:space-between;padding:9px 12px;border-bottom:1px solid var(--bd)"><span style="font-size:12px;color:var(--t3)">Status</span><span style="font-size:12px;font-weight:600">${u.is_verified ? ' Terverifikasi' : 'Belum terhubung verifikasi'}</span></div>
          <div style="display:flex;justify-content:space-between;padding:9px 12px"><span style="font-size:12px;color:var(--t3)">Bergabung</span><span style="font-size:12px;font-weight:600">${joined}</span></div>
        </div>
        <button onclick="confirmHapusAkun('${u.id}','${(u.nama_lengkap||u.username).replace(/'/g,"\'")}')"
          style="width:100%;padding:11px;background:#FFF0F0;border:1.5px solid #FFCCCC;border-radius:10px;font-family:inherit;font-size:13px;font-weight:700;color:var(--r);cursor:pointer">
          Hapus Akun Ini
        </button>
      </div>
    </div>
  `;
}

function confirmHapusAkun(id, nama) {
  const mo = document.getElementById('akunDetailModal');
  if (mo) mo.style.display = 'none';
  const conf = document.createElement('div');
  conf.id = 'akunConfModal';
  conf.className = 'mo';
  conf.style.display = 'flex';
  conf.innerHTML = `
    <div class="mbox" style="max-width:340px;text-align:center">
      <div style="font-size:36px;margin-bottom:10px"></div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:700;margin-bottom:6px">Hapus Akun?</div>
      <div style="font-size:13px;color:var(--t2);margin-bottom:18px">Akun <strong>${nama}</strong> beserta semua laporannya akan dihapus permanen.</div>
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('akunConfModal').remove();document.getElementById('akunDetailModal')&&(document.getElementById('akunDetailModal').style.display='none');"
          style="flex:1;padding:11px;border:1.5px solid var(--bd);border-radius:10px;background:#fff;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer;color:var(--t2)">Batal</button>
        <button id="btnHapusAkun" onclick="doHapusAkun('${id}')"
          style="flex:1;padding:11px;border:none;border-radius:10px;background:var(--r);color:#fff;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer">Hapus</button>
      </div>
    </div>
  `;
  document.body.appendChild(conf);
}

async function doHapusAkun(id) {
  const btn = document.getElementById('btnHapusAkun');
  if (btn) { btn.disabled=true; btn.textContent='Menghapus...'; }
  try {
    const res = await fetch('/api/users', {
      method: 'DELETE',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error||'Gagal hapus akun','err'); if(btn){btn.disabled=false;btn.textContent='Hapus';} return; }
    document.getElementById('akunConfModal')?.remove();
    akunList = akunList.filter(u => u.id !== id);
    toast(' Akun berhasil dihapus','ok');
    renderAkunList();
  } catch(e) {
    toast('Gagal konek server','err');
    if(btn){btn.disabled=false;btn.textContent='Hapus';}
  }
}

// ── DELETE CONFIRM ────────────────────────────────────────────────────
function confirmDelete(idx) {
  const r = adminFiltered[idx];

  if (!r) return;
  const tek = r['Teknisi'] || '-';
  const tgl = r['Tanggal'] || '-';
  const j   = r['Jenis Kegiatan'] || '-';
  const rid = r.report_id ? ` · ${r.report_id}` : '';

  openModal(`
    <div style="text-align:center;padding:8px 0">
      <div style="width:56px;height:56px;background:var(--red-ll);border-radius:var(--r16);display:flex;align-items:center;justify-content:center;margin:0 auto 16px"><svg class="ic-lg" style="color:var(--red)"><use href="#ic-trash"/></svg></div>
      <div style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;margin-bottom:8px;color:var(--t)">Hapus Laporan?</div>
      <div style="font-size:13px;color:var(--t2);line-height:1.6;margin-bottom:8px">
        Kamu akan menghapus laporan milik <strong>${tek}</strong><br>
        <strong>${j}</strong> tanggal <strong>${tgl}</strong>${rid}
      </div>
      <div style="background:#FFF0F0;border:1px solid #FFCCCC;border-radius:10px;padding:10px;font-size:12px;color:var(--r);margin-bottom:20px">
        ⚠️ Data akan dihapus permanen dari database. Tindakan ini tidak bisa dibatalkan.
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="closeModal()" class="btn-modal-action" style="background:#E2E8F0;color:var(--t);flex:1">Batal</button>
        <button onclick="doDeleteLaporan(${idx})" id="btnDelConfirm" class="btn-modal-action" style="background:var(--r);flex:1">Ya, Hapus</button>
      </div>
    </div>
  `);
}

async function doDeleteLaporan(idx) {
  const r   = adminFiltered[idx];
  if (!r) return;
  const btn = document.getElementById('btnDelConfirm');
  if (btn) { btn.disabled=true; btn.textContent='Menghapus...'; }

  const supabaseId = r.id;
  if (!supabaseId) { toast('ID laporan tidak ditemukan','err'); return; }

  try {
    const res = await fetch('/api/admin', {
      method: 'DELETE',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
      body: JSON.stringify({ supabaseId })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error||'Gagal hapus','err'); return; }

    // Hapus dari array lokal (adminData & adminFiltered share same objects)
    const aiIdx = adminData.indexOf(r);
    if (aiIdx >= 0) adminData.splice(aiIdx, 1);
    filterAdmin(); // re-filter dan re-render
    closeModal();
    toast('Laporan berhasil dihapus!','ok');
  } catch(e) {
    toast('Gagal konek server','err');
  } finally {
    if(btn){btn.disabled=false;btn.textContent='Ya, Hapus';}
  }
}

// ── DOWNLOAD EXCEL ────────────────────────────────────────────────────
function showDownloadPanel() {
  openModal(`
    <div style="font-family:'Space Grotesk',sans-serif;font-size:17px;font-weight:700;margin-bottom:4px"> Export Laporan ke Excel</div>
    <div style="font-size:12px;color:var(--t3);margin-bottom:20px">Pilih rentang waktu untuk data yang akan diexport</div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">
      <button onclick="downloadExcel('today')"   class="btn-dl-range"><strong>Hari Ini</strong><br><span>${new Date().toLocaleDateString('id-ID')}</span></button>
      <button onclick="downloadExcel('week')"    class="btn-dl-range"><strong>7 Hari Terakhir</strong><br><span>1 Minggu</span></button>
      <button onclick="downloadExcel('month')"   class="btn-dl-range"><strong>30 Hari Terakhir</strong><br><span>1 Bulan</span></button>
      <button onclick="downloadExcel('year')"    class="btn-dl-range"><strong>365 Hari Terakhir</strong><br><span>1 Tahun</span></button>
    </div>
    <button onclick="downloadExcel('all')" class="btn-dl-all">Download Semua Data (${adminData.length} laporan)</button>

    <div style="margin-top:14px">
      <div class="modal-sec">Atau pilih rentang kustom</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
        <div>
          <label style="font-size:11px;color:var(--t3);display:block;margin-bottom:4px">Dari tanggal</label>
          <input type="date" id="dlFrom" class="fi">
        </div>
        <div>
          <label style="font-size:11px;color:var(--t3);display:block;margin-bottom:4px">Sampai tanggal</label>
          <input type="date" id="dlTo" class="fi" value="${new Date().toISOString().split('T')[0]}">
        </div>
      </div>
      <button onclick="downloadExcel('custom')" class="btn-modal-action" style="width:100%;margin-top:10px;background:var(--adm)"> Download Rentang Kustom</button>
    </div>
    <button onclick="closeModal()" style="width:100%;padding:10px;border:none;background:none;color:var(--t3);font-family:inherit;font-size:13px;cursor:pointer;margin-top:8px">Tutup</button>
  `);
}

function downloadExcel(range) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let filtered = [];

  if (range === 'all') {
    filtered = [...adminData];
  } else if (range === 'today') {
    filtered = adminData.filter(r => {
      const d = parseRowDate(r);
      return d && d >= today && d < new Date(today.getTime() + 86400000);
    });
  } else if (range === 'week') {
    const from = new Date(today.getTime() - 6 * 86400000);
    filtered = adminData.filter(r => { const d = parseRowDate(r); return d && d >= from; });
  } else if (range === 'month') {
    const from = new Date(today.getTime() - 29 * 86400000);
    filtered = adminData.filter(r => { const d = parseRowDate(r); return d && d >= from; });
  } else if (range === 'year') {
    const from = new Date(today.getTime() - 364 * 86400000);
    filtered = adminData.filter(r => { const d = parseRowDate(r); return d && d >= from; });
  } else if (range === 'custom') {
    const from = document.getElementById('dlFrom')?.value;
    const to   = document.getElementById('dlTo')?.value;
    if (!from || !to) { toast('Pilih tanggal dari dan sampai!','err'); return; }
    const fromD = new Date(from); fromD.setHours(0,0,0,0);
    const toD   = new Date(to);   toD.setHours(23,59,59,999);
    filtered = adminData.filter(r => { const d = parseRowDate(r); return d && d >= fromD && d <= toD; });
  }

  if (filtered.length === 0) { toast('Tidak ada data di rentang waktu ini','err'); return; }

  const labels = {
    'today': 'Hari_Ini', 'week': '7_Hari', 'month': '30_Hari',
    'year': '1_Tahun', 'all': 'Semua', 'custom': 'Kustom'
  };
  generateExcel(filtered, `Laporan_DataSemestaApp_${labels[range]}_${today.toISOString().split('T')[0]}.xlsx`);
  toast(`Mengunduh ${filtered.length} laporan...`, 'ok');
  closeModal();
}

function parseRowDate(r) {
  // Coba dari kolom Tanggal (format YYYY-MM-DD)
  const tgl = r['Tanggal'] || r.tanggal || '';
  if (tgl && /\d{4}-\d{2}-\d{2}/.test(tgl)) return new Date(tgl);
  // Fallback dari Timestamp (format DD/MM/YYYY atau lainnya)
  const ts = r['Timestamp'] || r.created_at || '';
  if (ts) {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// Generate file .xlsx menggunakan SheetJS (binary xlsx asli)
function generateExcel(data, filename) {
  const rows = data.map((r, i) => ({
    'No':             i + 1,
    'Timestamp':      r['Timestamp']     || r.created_at     || '',
    'Teknisi':        r['Teknisi']       || r.teknisi        || '',
    'No HP':          r['No HP']         || r.phone          || '',
    'Jenis Kegiatan': r['Jenis Kegiatan']|| r.jenis_kegiatan || '',
    'Tanggal':        r['Tanggal']       || r.tanggal        || '',
    'Waktu':          (r['Waktu']        || r.waktu          || '').substring(0, 5),
    'Nama Client':    r['Nama Client']   || r.nama_client    || '',
    'Catatan':        r['Catatan']       || r.catatan        || '',
    'URL Foto':       r['URL Foto']      || r.foto           || '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);

  // Lebar kolom
  ws['!cols'] = [
    {wch:5},{wch:20},{wch:14},{wch:14},{wch:16},
    {wch:12},{wch:8},{wch:16},{wch:36},{wch:40}
  ];

  // Freeze baris pertama (header)
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  // Style header — warna biru gelap, teks putih bold
  const range = XLSX.utils.decode_range(ws['!ref']);
  for (let C = range.s.c; C <= range.e.c; C++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
    if (!cell) continue;
    cell.s = {
      fill: { fgColor: { rgb: '1A237E' } },
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan TeknisiApp');
  XLSX.writeFile(wb, filename);
}

// ── FILTER ────────────────────────────────────────────────────────────
function filterAdmin() {
  const q    = (document.getElementById('admSearch')?.value || '').toLowerCase();
  const jenis = document.getElementById('admFilterJenis')?.value || '';
  const tek   = document.getElementById('admFilterTeknisi')?.value || '';

  adminFiltered = adminData.filter(r => {
    const j   = r['Jenis Kegiatan'] || r.jenis_kegiatan || '';
    const t   = r['Teknisi'] || r.teknisi || '';
    const cl  = r['Nama Client'] || r.nama_client || '';
    const ca  = r['Catatan'] || r.catatan || '';
    const hp  = r['No HP'] || r.phone || '';
    const rid = r.report_id || '';
    const matchQ   = !q || [t, cl, ca, j, hp, rid].some(v => v.toLowerCase().includes(q));
    const matchJ   = !jenis || j === jenis;
    const matchTek = !tek || t === tek;
    return matchQ && matchJ && matchTek;
  });
  renderAdminTable();
}

// ── MODAL HELPER ──────────────────────────────────────────────────────
function openModal(html) {
  let mo = document.getElementById('adminModal');
  if (!mo) {
    mo = document.createElement('div');
    mo.id = 'adminModal';
    mo.className = 'mo';
    mo.innerHTML = '<div class="mbox" id="adminModalBox" style="max-width:520px"></div>';
    mo.addEventListener('click', e => { if (e.target === mo) closeModal(); });
    document.body.appendChild(mo);
  }
  document.getElementById('adminModalBox').innerHTML = html;
  mo.classList.add('show');
}

function closeModal() {
  document.getElementById('adminModal')?.classList.remove('show');
}


// ================= AUTH =================
async function doLogin() {
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Memproses...';
  document.getElementById('resendBox').style.display = 'none';
  lastNotVerifiedEmail = '';

  try {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;

    if (!username || !password) {
      setAlert('loginAlert', 'Username dan password wajib diisi!', 'e'); return;
    }

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const rawText = await res.text();
    let data;
    try { data = JSON.parse(rawText); }
    catch { setAlert('loginAlert', 'Server error: ' + rawText, 'e'); return; }

    // Akun belum terverifikasi
    if (res.status === 403 && data.not_verified) {
      lastNotVerifiedEmail = data.email || '';
      setAlert('loginAlert', 'Akun belum terverifikasi. Cek email kamu!', 'e');
      document.getElementById('resendBox').style.display = 'block';
      return;
    }

    if (!res.ok) {
      setAlert('loginAlert', data.message || 'Login gagal', 'e'); return;
    }

    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    localStorage.setItem('tc_user', JSON.stringify(currentUser));

    // Arahkan berdasarkan role
    if (currentUser.role === 'admin') showPage('admin');
    else showPage('dashboard');

  } catch (err) {
    setAlert('loginAlert', 'Tidak bisa konek ke server. Cek koneksi internet.', 'e');
  } finally {
    btn.disabled = false; btn.textContent = 'Masuk';
  }
}

async function resendVerify() {
  const btn = document.getElementById('btnResend');
  if (!lastNotVerifiedEmail) {
    toast('Email tidak diketahui. Daftar ulang.', 'err'); return;
  }
  btn.disabled = true; btn.textContent = 'Mengirim...';

  try {
    const res = await fetch('/api/resend-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: lastNotVerifiedEmail })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Gagal kirim', 'err'); return; }
    toast(' Email verifikasi terkirim! Cek inbox kamu.', 'ok');
    document.getElementById('resendBox').style.display = 'none';
  } catch (e) {
    toast('Gagal konek ke server', 'err');
  } finally {
    btn.disabled = false; btn.textContent = 'Kirim Ulang Email Verifikasi';
  }
}

async function doRegister() {
  const btn = document.getElementById('regBtn');
  btn.disabled = true; btn.textContent = 'Memproses...';

  const u   = document.getElementById('rUser').value.trim();
  const ph  = document.getElementById('rPhone').value.trim();
  const em  = document.getElementById('rEmail').value.trim();
  const p   = document.getElementById('rPass').value;
  const p2  = document.getElementById('rPass2').value;

  if (!u || !ph || !em || !p || !p2) { setAlert('regAlert','Semua field wajib diisi!','e'); btn.disabled=false; btn.textContent=' Daftar Sekarang'; return; }
  if (p.length < 6)                  { setAlert('regAlert','Password minimal 6 karakter!','e'); btn.disabled=false; btn.textContent=' Daftar Sekarang'; return; }
  if (p !== p2)                      { setAlert('regAlert','Password tidak sama','e'); btn.disabled=false; btn.textContent=' Daftar Sekarang'; return; }
  if (!/^08\d{8,11}$/.test(ph))      { setAlert('regAlert','Format HP: 08xxxxxxxxxx','e'); btn.disabled=false; btn.textContent=' Daftar Sekarang'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { setAlert('regAlert','Format email tidak valid','e'); btn.disabled=false; btn.textContent=' Daftar Sekarang'; return; }

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, phone: ph, email: em, password: p })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      setAlert('regAlert', data.error || data.message || 'Gagal mendaftar', 'e'); return;
    }
    if (data.warning) {
      setAlert('regAlert', ' ' + data.warning, 'w'); return;
    }
    setAlert('regAlert', ` Akun dibuat! Cek email <strong>${em}</strong> dan klik link verifikasi sebelum login.`, 's');
    setTimeout(() => showPage('login'), 3500);
  } catch (e) {
    setAlert('regAlert', 'Tidak bisa konek ke server', 'e');
  } finally {
    btn.disabled = false; btn.textContent = 'Daftar Sekarang';
  }
}

function updateNav() {
  if (!currentUser) return;
  const displayName = currentUser.nama_lengkap || currentUser.username;
  document.getElementById('navUn').textContent = currentUser.username;
  const av = document.getElementById('navAv');
  if (av) {
    if (currentUser.foto_profil) {
      av.innerHTML = `<img src="${currentUser.foto_profil}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">`;
      av.style.background = 'transparent';
      av.style.padding = '0';
    } else {
      av.innerHTML = displayName.substring(0, 2).toUpperCase();
      av.style.background = '';
      av.style.padding = '';
    }
  }
}

function doLogout() {
  unsubscribePush();
  localStorage.removeItem('token');
  localStorage.removeItem('tc_user');
  currentUser = null; token = null; riwayatData = []; adminData = []; adminFiltered = []; barangData = []; adminBarangData = [];
  showPage('login');
}

// ================= UPLOAD =================
function readAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(blob);
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function compressImage(dataUrl, maxWidth, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function handleUpl(input) {
  // Legacy single-slot handler — delegates to slot 1
  await handleUplSlot(input, 1);
}

async function handleUplSlot(input, slot) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('File terlalu besar! Maks 10MB', 'err'); return; }

  const zoneId  = slot === 2 ? 'uplZone2'  : 'uplZone';
  const txtId   = slot === 2 ? 'uplTxt2'   : 'uplTxt';
  const prevId  = slot === 2 ? 'prevImg2'  : 'prevImg';

  const uplTxt = document.getElementById(txtId);
  if (uplTxt) uplTxt.textContent = 'Memproses...';

  try {
    let blob = file;
    const isHEIC = /heic|heif/i.test(file.type) || /\.heic$|\.heif$/i.test(file.name);
    if (isHEIC) {
      if (!window.heic2any) await loadScript('https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js');
      try {
        blob = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
        if (Array.isArray(blob)) blob = blob[0];
      } catch (e) { blob = file; }
    }
    const dataUrl = await readAsDataURL(blob);
    const compressed = await compressImage(dataUrl, 1200, 0.82);

    if (slot === 2) uploadedB64_2 = compressed;
    else uploadedB64 = compressed;

    const prev = document.getElementById(prevId);
    const zone = document.getElementById(zoneId);
    const txt  = document.getElementById(txtId);
    const sizeKB = Math.round((compressed.length * 3) / 4 / 1024);
    if (prev) { prev.src = compressed; prev.style.display = 'block'; }
    if (zone) zone.classList.add('ok');
    if (txt) txt.textContent = `${file.name} (${sizeKB} KB)`;
  } catch (err) {
    console.error('Upload error:', err);
    toast('Gagal memproses foto: ' + err.message, 'err');
    const txt = document.getElementById(txtId);
    if (txt) txt.textContent = slot === 2 ? 'Foto tambahan (opsional)' : 'Foto utama dokumentasi';
  }
  input.value = '';
}


async function submitLap() {
  const jenis   = document.querySelector('input[name="jenis"]:checked')?.value;
  const tanggal = document.getElementById('fTgl')?.value;
  const waktu   = document.getElementById('fWkt')?.value;
  const estVal  = document.getElementById('fEstVal')?.value?.trim();
  const estUnit = document.getElementById('fEstUnit')?.value || 'menit';
  const client  = document.getElementById('fCli')?.value?.trim() || '-';
  const tempat  = document.getElementById('fTempat')?.value?.trim() || '-';
  const catatan = document.getElementById('fCat')?.value?.trim();
  const paket   = document.getElementById('fPaket')?.value?.trim() || '';
  const pppoe   = document.getElementById('fPppoe')?.value?.trim() || '';

  if (!jenis) { toast('Pilih jenis kegiatan!', 'err'); return; }
  if (!tanggal || !waktu) { toast('Tanggal dan waktu wajib diisi!', 'err'); return; }
  if (!estVal || isNaN(estVal) || Number(estVal) < 1) { toast('Estimasi pengerjaan wajib diisi!', 'err'); return; }
  if (!catatan) { toast('Catatan kegiatan wajib diisi!', 'err'); return; }

  // Validasi kolom per jenis
  if ((jenis === 'Pemasangan Baru' || jenis === 'Instalasi CCTV') && !client.trim()) {
    toast('Nama client wajib untuk ' + jenis + '!', 'err'); return;
  }
  if ((jenis === 'Perbaikan' || jenis === 'Pemeliharaan') && (!tempat || tempat === '-')) {
    toast('Tempat wajib untuk ' + jenis + '!', 'err'); return;
  }
  if (!uploadedB64) { toast('Foto dokumentasi wajib diupload!', 'err'); return; }

  const estimasi = `${estVal} ${estUnit}`;
  const btn = document.getElementById('btnSub');
  if (btn) { btn.disabled = true; btn.textContent = 'Mengirim...'; }
  showLoading('Menyimpan laporan...');

  try {
    const body = { jenis_kegiatan: jenis, tanggal, waktu, nama_client: client, tempat, estimasi, catatan, foto: uploadedB64, foto_2: uploadedB64_2 || undefined };
    if (jenis === 'Pemasangan Baru') { body.paket = paket; body.pppoe = pppoe; }
    const res = await fetch('/api/laporan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    hideLoading();
    if (!res.ok) { toast('Gagal: ' + (data.error || 'Server error'), 'err'); return; }
    toast('Laporan berhasil dikirim! ID: ' + (data.data?.report_id || ''), 'ok');
    const cache = JSON.parse(localStorage.getItem('tc_lap_cache') || '[]');
    cache.unshift({ ...data.data, teknisi: currentUser.username, jenis_kegiatan: jenis, tanggal, waktu, nama_client: client, tempat, estimasi, catatan, paket, pppoe, created_at: new Date().toISOString() });
    localStorage.setItem('tc_lap_cache', JSON.stringify(cache));
    setTimeout(() => goTab('riw', document.getElementById('ni-riw')), 1500);
  } catch (err) {
    hideLoading(); toast('Gagal konek ke server', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Kirim Laporan'; }
  }
}


// ================= SETUP MODAL =================
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b,i) => b.classList.toggle('active', (i===0&&tab==='supa')));
  const ts = document.getElementById('tab-supa');
  if (ts) ts.classList.toggle('active', tab==='supa');
  const tsh = document.getElementById('tab-sheets');
  if (tsh) tsh.classList.toggle('active', false);
}
function saveSupabase() {
  const url = document.getElementById('sUrl').value.trim();
  const key = document.getElementById('sKey').value.trim();
  if (!url||!key) { toast('URL dan Key wajib diisi','err'); return; }
  cfg.supaUrl=url; cfg.supaKey=key;
  localStorage.setItem('tc_cfg', JSON.stringify(cfg));
  toast('Supabase disimpan','ok');
  setTimeout(()=>document.getElementById('setupModal').classList.remove('show'),800);
}
function skipToSheets() { document.getElementById('setupModal').classList.remove('show'); }
function saveSheets() { document.getElementById('setupModal').classList.remove('show'); }
function skipSheets() { document.getElementById('setupModal').classList.remove('show'); }

// ================= HELPERS =================
function setAlert(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  const cls = type==='e'?'ae':type==='w'?'aw':'as';
  el.className = 'alert ' + cls;
  el.innerHTML = msg;
}
function toast(msg, type = '') {
  // Selalu pakai elemen yang sama di luar #con-adm
  let t = document.getElementById('toast');
  if (!t) return;
  // Reset dulu — batalkan timer sebelumnya
  if (t._toastTimer) clearTimeout(t._toastTimer);
  t.className = 'toast'; // reset tanpa show dulu
  t.textContent = msg;
  // Force reflow agar animasi restart dari awal
  void t.offsetWidth;
  t.className = 'toast' + (type ? ' ' + type : '') + ' show';
  t._toastTimer = setTimeout(() => {
    t.classList.remove('show');
    t._toastTimer = null;
  }, 3000);
}
function showLoading(txt='Memproses...') {
  const el = document.getElementById('ltxt'); if (el) el.textContent = txt;
  document.getElementById('lov')?.classList.add('show');
}
function hideLoading() { document.getElementById('lov')?.classList.remove('show'); }
function greet() {
  const h = new Date().getHours();
  if (h<12) return 'Selamat Pagi,'; if (h<15) return 'Selamat Siang,';
  if (h<18) return 'Selamat Sore,'; return 'Selamat Malam,';
}



// ================= LAPORAN BARANG (TEKNISI) =================
let barangData = [];

async function renderBarang() {
  const con = document.getElementById('con');
  con.innerHTML = `
    <div style="background:var(--white);border-radius:var(--r12);padding:14px 16px;margin-bottom:12px;border:1px solid var(--border);box-shadow:var(--sh-sm);display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:16px;font-weight:700">Laporan Barang</div>
        <div style="font-size:12px;color:var(--txt3)">Pengambilan & penggunaan barang</div>
      </div>
      <button onclick="showFormBarang()" style="padding:9px 16px;background:var(--red);color:#fff;border:none;border-radius:var(--r8);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer">+ Tambah</button>
    </div>
    <div class="loading-row"><div class="spin"></div><span>Memuat...</span></div>`;

  try {
    const res = await fetch('/api/barang', { headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) barangData = await res.json();
    else throw new Error();
  } catch (e) {
    barangData = [];
  }

  const header = `
    <div style="background:var(--white);border-radius:var(--r12);padding:14px 16px;margin-bottom:12px;border:1px solid var(--border);box-shadow:var(--sh-sm);display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:16px;font-weight:700">Laporan Barang</div>
        <div style="font-size:12px;color:var(--txt3)">${barangData.length} laporan</div>
      </div>
      <button onclick="showFormBarang()" style="padding:9px 16px;background:var(--red);color:#fff;border:none;border-radius:var(--r8);font-family:inherit;font-size:13px;font-weight:600;cursor:pointer">+ Tambah</button>
    </div>`;

  if (barangData.length === 0) {
    con.innerHTML = header + `<div class="empty"><div class="empty-icon"><svg class="ic-lg"><use href="#ic-box"/></svg></div><div class="et">Belum ada laporan barang</div><div class="es">Catat pengambilan barang dengan tombol Tambah</div></div>`;
    return;
  }

  con.innerHTML = header + barangData.map((r, idx) => `
    <div class="rc" style="cursor:default">
      <div class="rt">
        <div>
          <div class="rtype" style="display:flex;align-items:center;gap:6px">
            <svg class="ic-sm" style="color:var(--orange)"><use href="#ic-package"/></svg>
            ${esc(r.nama_barang)}
          </div>
          <div class="rdate">${r.tanggal} · ${r.barang_id || ''}</div>
        </div>
        <span class="rbadge" style="background:var(--orange-l);color:#7A4A00">Barang</span>
      </div>
      <div class="rbody" style="margin-bottom:6px">${esc(r.keperluan || '-')}</div>
      <div class="rmeta">
        ${r.foto ? '<div class="mc"><svg class="ic-sm"><use href="#ic-camera"/></svg> Foto 1</div>' : ''}
        ${r.foto_2 ? '<div class="mc"><svg class="ic-sm"><use href="#ic-camera"/></svg> Foto 2</div>' : ''}
        <button onclick="showDetailBarang(${idx})" class="mc" style="margin-left:auto;color:var(--red);border:none;background:var(--red-ll);cursor:pointer;font-family:inherit;font-size:11px;font-weight:600">Lihat Detail</button>
      </div>
    </div>`).join('');
}

function showFormBarang() {
  uploadedBarangB64 = null;
  uploadedBarangB64_2 = null;
  const d = new Date().toISOString().split('T')[0];
  const con = document.getElementById('con');
  con.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <button onclick="renderBarang()" style="width:36px;height:36px;border-radius:10px;border:1.5px solid var(--border);background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center">
        <svg class="ic-sm"><use href="#ic-chevron-left"/></svg>
      </button>
      <div style="font-size:16px;font-weight:700">Laporan Pengambilan Barang</div>
    </div>
    <div class="fcard">
      <div class="fsec">Informasi Barang</div>
      <div class="fg2">
        <label class="flbl">Nama Barang <span class="req">*</span></label>
        <input type="text" class="fi" id="bNama" placeholder="Cth: Kabel UTP Cat6, Switch TP-Link 8 port">
      </div>
      <div class="fg2">
        <label class="flbl">Tanggal Pengambilan <span class="req">*</span></label>
        <input type="date" class="fi" id="bTgl" value="${d}">
      </div>
      <div class="fg2">
        <label class="flbl">Keperluan <span class="req">*</span></label>
        <textarea class="fi" id="bKeperluan" rows="3" placeholder="Jelaskan untuk kegiatan apa barang ini digunakan..." style="resize:vertical"></textarea>
      </div>

      <div class="fsec">Foto Barang</div>
      <div class="fg2">
        <label class="flbl">Foto Barang 1 <span class="req">*</span></label>
        <div class="upl" id="bUplZone1">
          <input type="file" id="bFoto1" accept="image/*,.heic,.heif,.webp" onchange="handleUplBarang(this,1)" style="display:none">
          <input type="file" id="bKamera1" accept="image/*" capture="environment" onchange="handleUplBarang(this,1)" style="display:none">
          <div class="upl-icon"><svg class="ic-lg"><use href="#ic-camera"/></svg></div>
          <div class="upl-t" id="bUplTxt1">Foto kondisi barang</div>
          <div class="upl-s">JPG, PNG, HEIC · Maks 10MB</div>
          <div style="display:flex;gap:8px;margin-top:10px;justify-content:center">
            <button type="button" onclick="event.stopPropagation();document.getElementById('bFoto1').click()" class="btn-upl btn-upl-ghost">Pilih File</button>
            <button type="button" onclick="event.stopPropagation();document.getElementById('bKamera1').click()" class="btn-upl btn-upl-solid">Kamera</button>
          </div>
          <img id="bPrev1" class="prev">
        </div>
      </div>
      <div class="fg2">
        <label class="flbl">Foto Barang 2 <span style="font-size:10px;color:var(--txt4);font-weight:400">Opsional</span></label>
        <div class="upl" id="bUplZone2">
          <input type="file" id="bFoto2" accept="image/*,.heic,.heif,.webp" onchange="handleUplBarang(this,2)" style="display:none">
          <input type="file" id="bKamera2b" accept="image/*" capture="environment" onchange="handleUplBarang(this,2)" style="display:none">
          <div class="upl-icon"><svg class="ic-lg"><use href="#ic-camera"/></svg></div>
          <div class="upl-t" id="bUplTxt2">Foto tambahan (opsional)</div>
          <div class="upl-s">JPG, PNG, HEIC · Maks 10MB</div>
          <div style="display:flex;gap:8px;margin-top:10px;justify-content:center">
            <button type="button" onclick="event.stopPropagation();document.getElementById('bFoto2').click()" class="btn-upl btn-upl-ghost">Pilih File</button>
            <button type="button" onclick="event.stopPropagation();document.getElementById('bKamera2b').click()" class="btn-upl btn-upl-solid">Kamera</button>
          </div>
          <img id="bPrev2" class="prev">
        </div>
      </div>

      <button class="btn-sub" id="btnSubmitBarang" onclick="submitBarang()">Kirim Laporan Barang</button>
    </div>`;
}

async function handleUplBarang(input, slot) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('File terlalu besar! Maks 10MB', 'err'); return; }
  const zoneId = slot === 2 ? 'bUplZone2' : 'bUplZone1';
  const txtId  = slot === 2 ? 'bUplTxt2'  : 'bUplTxt1';
  const prevId = slot === 2 ? 'bPrev2'    : 'bPrev1';
  const txt = document.getElementById(txtId);
  if (txt) txt.textContent = 'Memproses...';
  try {
    const dataUrl = await readAsDataURL(file);
    const compressed = await compressImage(dataUrl, 1200, 0.82);
    if (slot === 2) uploadedBarangB64_2 = compressed;
    else uploadedBarangB64 = compressed;
    const prev = document.getElementById(prevId);
    const zone = document.getElementById(zoneId);
    const sizeKB = Math.round((compressed.length * 3) / 4 / 1024);
    if (prev) { prev.src = compressed; prev.style.display = 'block'; }
    if (zone) zone.classList.add('ok');
    if (txt) txt.textContent = file.name + ' (' + sizeKB + ' KB)';
  } catch(e) {
    toast('Gagal memproses foto', 'err');
  }
  input.value = '';
}

async function submitBarang() {
  const nama     = document.getElementById('bNama')?.value?.trim();
  const tanggal  = document.getElementById('bTgl')?.value;
  const keperluan = document.getElementById('bKeperluan')?.value?.trim();

  if (!nama)      { toast('Nama barang wajib diisi!', 'err'); return; }
  if (!tanggal)   { toast('Tanggal wajib diisi!', 'err'); return; }
  if (!keperluan) { toast('Keperluan wajib diisi!', 'err'); return; }
  if (!uploadedBarangB64) { toast('Foto barang wajib diupload!', 'err'); return; }

  const btn = document.getElementById('btnSubmitBarang');
  if (btn) { btn.disabled = true; btn.textContent = 'Mengirim...'; }
  showLoading('Menyimpan laporan barang...');

  try {
    const res = await fetch('/api/barang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ nama_barang: nama, tanggal, keperluan, foto: uploadedBarangB64, foto_2: uploadedBarangB64_2 || undefined })
    });
    const data = await res.json();
    hideLoading();
    if (!res.ok) { toast('Gagal: ' + (data.error || 'Server error'), 'err'); return; }
    toast('Laporan barang berhasil dikirim!', 'ok');
    uploadedBarangB64 = null;
    uploadedBarangB64_2 = null;
    setTimeout(() => renderBarang(), 1200);
  } catch (err) {
    hideLoading();
    toast('Gagal konek ke server', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Kirim Laporan Barang'; }
  }
}

function showDetailBarang(idx) {
  const r = barangData[idx];
  if (!r) return;
  const con = document.getElementById('con');
  con.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <button onclick="renderBarang()" style="width:36px;height:36px;border-radius:10px;border:1.5px solid var(--border);background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center">
        <svg class="ic-sm"><use href="#ic-chevron-left"/></svg>
      </button>
      <div style="font-size:16px;font-weight:700">Detail Laporan Barang</div>
    </div>

    <div style="background:var(--orange);border-radius:var(--r16);padding:20px;margin-bottom:14px;color:#fff;position:relative;overflow:hidden">
      <div style="font-size:11px;opacity:.75;margin-bottom:4px">ID Laporan</div>
      <div style="font-size:14px;font-weight:700;margin-bottom:6px;font-family:monospace">${esc(r.barang_id || '-')}</div>
      <div style="font-size:20px;font-weight:700;margin-bottom:10px">${esc(r.nama_barang)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:var(--r-pill);font-size:11px">${r.tanggal}</span>
        <span style="background:rgba(255,255,255,.2);padding:4px 10px;border-radius:var(--r-pill);font-size:11px">${esc(r.teknisi)}</span>
      </div>
    </div>

    ${(r.foto || r.foto_2) ? `
    <div class="fcard" style="margin-bottom:12px;padding:14px">
      <div class="fsec">Foto Barang</div>
      <div style="display:grid;grid-template-columns:${r.foto && r.foto_2 ? '1fr 1fr' : '1fr'};gap:10px">
        ${r.foto ? `<div><div style="font-size:11px;color:var(--txt4);margin-bottom:6px">Foto 1</div><img src="${r.foto}" onclick="window.open('${r.foto}','_blank')" style="width:100%;border-radius:var(--r8);cursor:pointer;object-fit:cover;aspect-ratio:1" onerror="this.style.display='none'"></div>` : ''}
        ${r.foto_2 ? `<div><div style="font-size:11px;color:var(--txt4);margin-bottom:6px">Foto 2</div><img src="${r.foto_2}" onclick="window.open('${r.foto_2}','_blank')" style="width:100%;border-radius:var(--r8);cursor:pointer;object-fit:cover;aspect-ratio:1" onerror="this.style.display='none'"></div>` : ''}
      </div>
    </div>` : ''}

    <div class="fcard" style="padding:14px">
      <div class="fsec">Informasi Barang</div>
      <div style="display:flex;flex-direction:column;gap:0">
        <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--txt3)">Teknisi</span><span style="font-size:13px;font-weight:600">${esc(r.teknisi)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--txt3)">Tanggal</span><span style="font-size:13px;font-weight:600">${r.tanggal}</span></div>
        <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border)"><span style="font-size:12px;color:var(--txt3)">Nama Barang</span><span style="font-size:13px;font-weight:600">${esc(r.nama_barang)}</span></div>
        <div style="padding:9px 0"><span style="font-size:12px;color:var(--txt3);display:block;margin-bottom:6px">Keperluan</span><div style="font-size:13px;color:var(--txt2);line-height:1.6;white-space:pre-wrap">${esc(r.keperluan || '-')}</div></div>
      </div>
    </div>`;
}

// ================= ADMIN BARANG PANEL =================
let adminBarangData = [];

async function renderAdminBarangPanel() {
  const con = document.getElementById('adm-tab-content') || document.getElementById('con-adm');
  con.innerHTML = `<div class="loading-row"><div class="spin" style="border-top-color:var(--adm)"></div><span>Memuat laporan barang...</span></div>`;

  try {
    const res = await fetch('/api/barang', { headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) adminBarangData = await res.json();
    else throw new Error(await res.text());
  } catch (e) {
    con.innerHTML = `<div style="padding:24px;color:var(--red)">Gagal memuat: ${e.message}</div>`;
    return;
  }

  const data = adminBarangData;
  const teknisiSet = new Set(data.map(r => r.teknisi || ''));

  con.innerHTML = `
    <div class="adm-stats">
      <div class="adm-stat"><div class="adm-stat-n">${data.length}</div><div class="adm-stat-l">Total Laporan Barang</div></div>
      <div class="adm-stat" style="border-color:var(--orange)"><div class="adm-stat-n" style="color:var(--orange)">${teknisiSet.size}</div><div class="adm-stat-l">Teknisi</div></div>
    </div>

    <div class="adm-controls">
      <div class="adm-search-wrap">
        <svg class="ic-sm"><use href="#ic-search"/></svg>
        <input type="text" class="adm-search" id="barangSearch" placeholder="Cari nama barang, teknisi, keperluan..." oninput="filterBarangAdmin()">
      </div>
      <span style="font-size:12px;color:var(--txt3);white-space:nowrap">${data.length} laporan</span>
    </div>

    <div class="tbl-wrap">
      ${data.length === 0
        ? `<div class="adm-empty"><div class="empty-icon" style="margin:0 auto 12px"><svg class="ic-lg"><use href="#ic-box"/></svg></div><div style="font-weight:600;color:var(--txt2)">Belum ada laporan barang</div></div>`
        : `<div style="overflow-x:auto"><table class="tbl">
            <thead><tr>
              <th>No</th><th>ID Barang</th><th>Tanggal</th><th>Teknisi</th><th>Nama Barang</th><th>Keperluan</th><th>Foto</th><th>Aksi</th>
            </tr></thead>
            <tbody id="barangTbody">
              ${data.map((r, i) => buildBarangRow(r, i)).join('')}
            </tbody>
          </table></div>`}
    </div>`;
}

function buildBarangRow(r, i) {
  const foto = r.foto || '';
  const foto2 = r.foto_2 || '';
  return `<tr>
    <td style="color:var(--txt4);font-size:11px">${i+1}</td>
    <td style="font-size:11px;font-family:monospace;color:var(--adm);font-weight:600">${esc(r.barang_id||'-')}</td>
    <td style="white-space:nowrap">${r.tanggal||'-'}</td>
    <td style="font-weight:600">${esc(r.teknisi||'-')}</td>
    <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.nama_barang)}">${esc(r.nama_barang)}</td>
    <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--txt3)" title="${esc(r.keperluan||'')}">${esc(r.keperluan||'-')}</td>
    <td>
      <div style="display:flex;gap:4px">
        ${foto ? `<img src="${foto}" onclick="window.open('${foto}','_blank')" class="tbl-foto" title="Foto 1">` : '<span style="font-size:11px;color:var(--txt4)">—</span>'}
        ${foto2 ? `<img src="${foto2}" onclick="window.open('${foto2}','_blank')" class="tbl-foto" title="Foto 2">` : ''}
      </div>
    </td>
    <td>
      <button onclick="confirmDeleteBarang('${r.id}')" class="btn-act btn-del" title="Hapus">
        <svg class="ic-sm"><use href="#ic-trash"/></svg>
      </button>
    </td>
  </tr>`;
}

function filterBarangAdmin() {
  const q = (document.getElementById('barangSearch')?.value || '').toLowerCase();
  const filtered = adminBarangData.filter(r =>
    [r.nama_barang, r.teknisi, r.keperluan, r.barang_id].some(v => (v||'').toLowerCase().includes(q))
  );
  const tbody = document.getElementById('barangTbody');
  if (tbody) tbody.innerHTML = filtered.map((r, i) => buildBarangRow(r, i)).join('');
}

async function confirmDeleteBarang(id) {
  if (!confirm('Hapus laporan barang ini? Tindakan tidak bisa dibatalkan.')) return;
  try {
    const res = await fetch('/api/barang', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ id })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.error || 'Gagal hapus', 'err'); return; }
    toast('Laporan barang dihapus', 'ok');
    renderAdminBarangPanel();
  } catch(e) {
    toast('Gagal konek server', 'err');
  }
}


// ── XSS Protection ────────────────────────────────────────────────
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ================= WEB PUSH NOTIFICATIONS =================
let _swReg = null;
let _pushEndpoint = null;

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push tidak didukung browser ini');
    return;
  }
  try {
    // Register service worker
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    // Tunggu SW aktif
    await navigator.serviceWorker.ready;
    _swReg = reg;

    // Dengarkan pesan dari SW (klik notif)
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.type === 'NOTIF_CLICK') {
        if (currentUser && currentUser.role !== 'admin') {
          goTab('tugas', document.getElementById('ni-tugas'));
        } else if (currentUser && currentUser.role === 'admin') {
          renderAdmin();
        }
      }
    });
    console.log('✅ Service Worker terdaftar');
  } catch(e) {
    console.warn('SW register gagal:', e.message);
  }
}

async function subscribePush() {
  if (!_swReg) return;
  try {
    const res = await fetch('/api/push');
    if (!res.ok) return;
    const { publicKey } = await res.json();
    if (!publicKey) { console.warn('VAPID public key kosong — cek env VAPID_PUBLIC_KEY'); return; }

    // Pakai subscription yang sudah ada jika masih valid
    let sub = await _swReg.pushManager.getSubscription();
    if (!sub) {
      sub = await _swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    _pushEndpoint = sub.endpoint;

    // Kirim/update subscription ke server
    await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
    console.log('✅ Push notification aktif');
  } catch(e) {
    console.warn('Subscribe push gagal:', e.message);
  }
}

async function requestPushPermission() {
  if (!_swReg) return;
  if (Notification.permission === 'denied') {
    showPushDeniedBanner();
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      await subscribePush();
      hidePushDeniedBanner();
    } else if (perm === 'denied') {
      showPushDeniedBanner();
    }
  } catch(e) { console.warn('Push permission gagal:', e); }
}

function showPushDeniedBanner() {
  if (document.getElementById('push-denied-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'push-denied-banner';
  banner.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);width:calc(100% - 32px);max-width:480px;background:#1e293b;color:#fff;border-radius:14px;padding:12px 16px;z-index:9999;display:flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,.3);font-family:inherit';
  banner.innerHTML = `
    <div style="font-size:22px">🔔</div>
    <div style="flex:1">
      <div style="font-size:13px;font-weight:700;margin-bottom:2px">Notifikasi Diblokir</div>
      <div style="font-size:11px;opacity:.75">Aktifkan notifikasi di pengaturan browser agar bisa terima tugas baru</div>
    </div>
    <button onclick="document.getElementById('push-denied-banner').remove()" style="background:transparent;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0">×</button>
  `;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 8000);
}

function hidePushDeniedBanner() {
  document.getElementById('push-denied-banner')?.remove();
}

async function unsubscribePush() {
  try {
    if (_swReg) {
      const sub = await _swReg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
    }
  } catch(e) {}
}


// Buka Google Maps — app native lebih diprioritaskan
function openMaps(url) {
  if (!url) return;
  // Jika URL sudah berisi koordinat atau google maps, buka langsung
  // Coba buka app Google Maps native dulu, fallback ke browser
  try {
    const u = new URL(url);
    // Ekstrak query params dari berbagai format URL gmaps
    let query = u.searchParams.get('q') || u.searchParams.get('query') || '';
    const lat  = u.searchParams.get('lat');
    const lng  = u.searchParams.get('lng');
    if (!query && lat && lng) query = lat + ',' + lng;
    // Coba buka dengan intent gmaps (Android) atau universal link (iOS)
    const geoUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || url)}`;
    window.open(geoUrl, '_blank');
  } catch(e) {
    window.open(url, '_blank');
  }
}

init();