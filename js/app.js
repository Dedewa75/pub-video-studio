// Interface : choix du métier, message client, formulaire, génération des vidéos.
(function () {
  const $ = (id) => document.getElementById(id);
  const state = { metier: null, photos: [], logo: null, count: 1, busy: false };
  const LS = 'pvs_form_v1';

  // ---------- navigation ----------
  function go(n) {
    for (let i = 1; i <= 4; i++) $('step' + i).classList.toggle('hidden', i !== n);
    document.querySelectorAll('#steps button').forEach((b) => b.classList.toggle('active', +b.dataset.step === n));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  document.querySelectorAll('#steps button, [data-go]').forEach((b) => b.addEventListener('click', () => {
    const n = +(b.dataset.step || b.dataset.go);
    if (n > 1 && !state.metier) { toast("Choisis d'abord un métier"); return; }
    go(n);
  }));
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
  }

  // ---------- compatibilité ----------
  if (!('VideoEncoder' in window)) {
    $('warn').textContent = "⚠️ Ce navigateur ne peut pas fabriquer de MP4. Ouvre l'appli dans Google Chrome ou Microsoft Edge (à jour) sur ton PC.";
    $('warn').classList.remove('hidden');
  }

  // ---------- étape 1 : métiers ----------
  function renderGrid(filter = '') {
    const f = filter.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    $('grid').innerHTML = '';
    METIERS.filter((m) => m.nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(f)).forEach((m) => {
      const b = document.createElement('button');
      b.className = 'card'; b.style.setProperty('--c', m.accent);
      b.innerHTML = `<span class="emo">${m.emoji}</span><span>${m.nom}</span>`;
      b.onclick = () => chooseMetier(m);
      $('grid').appendChild(b);
    });
  }
  $('search').addEventListener('input', (e) => renderGrid(e.target.value));
  $('autreBtn').onclick = () => {
    const n = $('autreNom').value.trim();
    if (!n) { toast('Tape le nom du métier'); return; }
    chooseMetier(METIER_AUTRE(n));
  };

  function chooseMetier(m) {
    state.metier = m;
    document.documentElement.style.setProperty('--accent', m.accent);
    $('m2').textContent = m.emoji + ' ' + m.nom; $('m3').textContent = m.emoji + ' ' + m.nom;
    fillDefaults(m);
    updateBrief();
    go(2);
  }

  // ---------- étape 2 : message client ----------
  function briefText() {
    const m = state.metier; if (!m) return '';
    const prenom = $('clientPrenom').value.trim(), sig = $('signature').value.trim();
    const L = [];
    L.push(`Bonjour${prenom ? ' ' + prenom : ''},`);
    L.push('');
    L.push(`Pour créer votre vidéo publicitaire (format TikTok / Instagram Reels) pour votre activité « ${m.nom} », j'ai besoin de quelques éléments :`);
    L.push('');
    L.push('📸 PHOTOS – 3 à 5 photos nettes et bien éclairées :');
    m.photos.forEach((p) => L.push('   • ' + p));
    L.push('   (Vos propres photos de préférence, pas des images prises sur Internet.)');
    L.push('');
    L.push("🎨 LOGO – votre logo, idéalement en PNG sur fond transparent. Pas de logo ? Pas de souci, j'en prépare un simple.");
    L.push('');
    L.push('🏢 VOS COORDONNÉES :');
    ['Nom exact de l\'entreprise', 'Numéro de téléphone', 'Adresse e-mail', 'Site web (si vous en avez un)', 'Adresse ou zone d\'intervention', 'Instagram / Facebook (si vous en avez)'].forEach((x) => L.push('   • ' + x));
    L.push('');
    L.push(`✅ VOS 4 SERVICES PRINCIPAUX (ex. : ${m.services.slice(0, 4).join(', ')})`);
    L.push('');
    L.push(`💬 UNE PHRASE QUI VOUS REPRÉSENTE (ex. : « ${m.slogans[0].join(' ').toLowerCase()} »)`);
    L.push('');
    L.push(`📊 QUELQUES CHIFFRES (ex. : années d'expérience, nombre de clients, note Google)`);
    L.push('');
    L.push(`🎁 UNE OFFRE À METTRE EN AVANT (ex. : « ${m.offre.join(' ').toLowerCase()} »)`);
    L.push('');
    L.push('🎨 Une couleur que vous aimez pour la vidéo (sinon je choisis selon votre logo).');
    L.push('');
    L.push('Dès réception, je vous prépare la vidéo. Merci et à très vite !');
    if (sig) { L.push(''); L.push(sig); }
    return L.join('\n');
  }
  function updateBrief() {
    $('brief').value = briefText();
    const txt = encodeURIComponent($('brief').value);
    $('waBtn').href = 'https://wa.me/?text=' + txt;
    $('mailBtn').href = 'mailto:?subject=' + encodeURIComponent('Votre vidéo publicitaire – infos nécessaires') + '&body=' + txt;
  }
  ['signature', 'clientPrenom'].forEach((id) => $(id).addEventListener('input', () => { localStorage.setItem('pvs_sig', $('signature').value); updateBrief(); }));
  $('brief').addEventListener('input', () => {
    const txt = encodeURIComponent($('brief').value);
    $('waBtn').href = 'https://wa.me/?text=' + txt;
    $('mailBtn').href = 'mailto:?subject=' + encodeURIComponent('Votre vidéo publicitaire – infos nécessaires') + '&body=' + txt;
  });
  $('copyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText($('brief').value); toast('Message copié ✅'); }
    catch (e) { $('brief').select(); document.execCommand('copy'); toast('Message copié ✅'); }
  };
  $('signature').value = localStorage.getItem('pvs_sig') || '';

  // ---------- étape 3 : formulaire ----------
  const servBox = $('f_services'), statBox = $('f_stats');
  for (let i = 0; i < 5; i++) { const inp = document.createElement('input'); inp.type = 'text'; inp.id = 'f_sv' + i; inp.placeholder = 'Service ' + (i + 1); inp.style.marginBottom = '8px'; servBox.appendChild(inp); }
  for (let i = 0; i < 3; i++) {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<label>Valeur ${i + 1}<input type="text" id="f_stv${i}"></label><label>Légende ${i + 1}<input type="text" id="f_stl${i}"></label>`;
    statBox.appendChild(row);
  }

  function fillDefaults(m) {
    $('f_tag').value = m.tag;
    $('f_s1').value = m.slogans[0][0]; $('f_s2').value = m.slogans[0][1];
    for (let i = 0; i < 5; i++) $('f_sv' + i).value = m.services[i] || '';
    $('f_o1').value = m.offre[0]; $('f_o2').value = m.offre[1];
    m.stats.forEach((s, i) => { $('f_stv' + i).value = (s[1] || '') + s[0] + (s[2] || ''); $('f_stl' + i).value = s[3]; });
    $('f_accent').value = m.accent;
    $('f_music').value = m.music;
    if (!$('f_cta').value) $('f_cta').value = 'Demandez votre devis';
    const saved = JSON.parse(localStorage.getItem(LS) || '{}');
    ['f_phone', 'f_email', 'f_site', 'f_insta', 'f_adresse', 'f_nom'].forEach((id) => { if (saved[id] && !$(id).value) $(id).value = saved[id]; });
  }
  document.querySelectorAll('#step3 input[type=text]').forEach((inp) => inp.addEventListener('change', () => {
    const s = {}; ['f_nom', 'f_phone', 'f_email', 'f_site', 'f_insta', 'f_adresse'].forEach((id) => s[id] = $(id).value);
    localStorage.setItem(LS, JSON.stringify(s));
  }));

  // photos
  function loadImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => res({ img, url }); img.onerror = () => rej(new Error('Image illisible : ' + file.name)); img.src = url;
    });
  }
  async function addPhotos(files) {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      if (state.photos.length >= 6) { toast('6 photos maximum'); break; }
      try { state.photos.push(await loadImage(f)); } catch (e) { toast(e.message); }
    }
    renderThumbs();
  }
  function renderThumbs() {
    $('thumbs').innerHTML = '';
    state.photos.forEach((p, i) => {
      const d = document.createElement('div'); d.className = 'thumb';
      d.innerHTML = `<img src="${p.url}"><span class="n">${i + 1}</span><div class="bar"><button data-a="l">◀</button><button data-a="x">✕</button><button data-a="r">▶</button></div>`;
      d.querySelectorAll('button').forEach((b) => b.onclick = (e) => {
        e.preventDefault();
        const a = b.dataset.a;
        if (a === 'x') state.photos.splice(i, 1);
        if (a === 'l' && i > 0) [state.photos[i - 1], state.photos[i]] = [state.photos[i], state.photos[i - 1]];
        if (a === 'r' && i < state.photos.length - 1) [state.photos[i + 1], state.photos[i]] = [state.photos[i], state.photos[i + 1]];
        renderThumbs();
      });
      $('thumbs').appendChild(d);
    });
  }
  $('f_photos').addEventListener('change', (e) => { addPhotos([...e.target.files]); e.target.value = ''; });
  $('f_logo').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { state.logo = await loadImage(f); $('logoLabel').textContent = '✅ ' + f.name + ' (cliquer pour changer)'; } catch (err) { toast(err.message); }
  });
  [['dropPhotos', (fs) => addPhotos(fs)], ['dropLogo', async (fs) => { if (fs[0]) { state.logo = await loadImage(fs[0]); $('logoLabel').textContent = '✅ ' + fs[0].name; } }]].forEach(([id, fn]) => {
    const el = $(id);
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); fn([...e.dataTransfer.files]); });
  });
  document.querySelectorAll('#count button').forEach((b) => b.onclick = () => {
    state.count = +b.dataset.n;
    document.querySelectorAll('#count button').forEach((x) => x.classList.toggle('active', x === b));
  });

  // ---------- collecte des données ----------
  function parseStat(txt) {
    const m = String(txt).trim().match(/^([^\d]*)([\d.,]+)(.*)$/);
    if (!m) return [txt, '', '', ''];
    return [m[2], m[1], m[3], ''];
  }
  function collect() {
    const m = state.metier;
    const nom = $('f_nom').value.trim();
    if (!nom) throw new Error("Remplis le nom de l'entreprise");
    if (!state.photos.length) throw new Error('Ajoute au moins 1 photo');
    const s1 = $('f_s1').value.trim().toUpperCase(), s2 = $('f_s2').value.trim().toUpperCase();
    const slogans = [[s1 || m.slogans[0][0], s2 || m.slogans[0][1]], ...m.slogans.filter((s) => s[0] !== s1)];
    const stats = [];
    for (let i = 0; i < 3; i++) {
      const v = $('f_stv' + i).value.trim(); if (!v) continue;
      const p = parseStat(v); p[3] = $('f_stl' + i).value.trim(); stats.push(p);
    }
    return {
      nom: nom.toUpperCase(), emoji: m.emoji, tag: $('f_tag').value.trim() || m.tag, slogans,
      services: [0, 1, 2, 3, 4].map((i) => $('f_sv' + i).value.trim()).filter(Boolean),
      offre: [$('f_o1').value.trim().toUpperCase() || m.offre[0], $('f_o2').value.trim().toUpperCase()],
      stats, phone: $('f_phone').value, email: $('f_email').value, site: $('f_site').value,
      adresse: $('f_adresse').value, insta: $('f_insta').value, cta: $('f_cta').value.trim() || 'Contactez-nous',
      accent: $('f_accent').value, music: $('f_music').value,
      photos: state.photos.map((p) => p.img), logo: state.logo ? state.logo.img : null, logoRemoveWhite: $('f_logoWhite').checked,
    };
  }

  // ---------- aperçu ----------
  let stopFn = null;
  $('previewBtn').onclick = async () => {
    $('formMsg').textContent = '';
    try {
      const D = collect();
      if (document.fonts) await document.fonts.load('900 60px Montserrat').catch(() => {});
      const project = await VideoEngine.build(D, 0);
      $('previewWrap').classList.remove('hidden');
      stopFn = VideoEngine.preview($('previewCanvas'), project);
    } catch (e) { $('formMsg').textContent = '⚠️ ' + e.message; }
  };
  $('stopPreview').onclick = () => { if (stopFn) stopFn(); $('previewWrap').classList.add('hidden'); };

  // ---------- génération ----------
  function slug(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'video'; }
  $('genBtn').onclick = async () => {
    if (state.busy) return;
    $('formMsg').textContent = '';
    let D;
    try { D = collect(); } catch (e) { $('formMsg').textContent = '⚠️ ' + e.message; return; }
    if (stopFn) stopFn();
    state.busy = true; $('genBtn').disabled = true;
    go(4);
    if (document.fonts) await document.fonts.load('900 60px Montserrat').catch(() => {});
    const box = $('results'); box.innerHTML = '';
    const items = [];
    for (let i = 0; i < state.count; i++) {
      const el = document.createElement('div'); el.className = 'res';
      el.innerHTML = `<h3>Vidéo ${i + 1}</h3><div class="prog"><i></i></div><div class="state">En attente…</div>`;
      box.appendChild(el); items.push(el);
    }
    for (let i = 0; i < state.count; i++) {
      const el = items[i], bar = el.querySelector('.prog i'), st = el.querySelector('.state');
      try {
        st.textContent = 'Fabrication…';
        const project = await VideoEngine.build(D, i);
        const t0 = performance.now();
        const blob = await VideoEngine.renderMp4(project, (p) => { bar.style.width = (p * 100).toFixed(0) + '%'; });
        const url = URL.createObjectURL(blob), name = `${slug(D.nom)}_video${i + 1}.mp4`;
        el.querySelector('.prog').remove();
        st.remove();
        el.insertAdjacentHTML('beforeend', `<video src="${url}" controls playsinline></video><div class="actions"><a class="btn primary" href="${url}" download="${name}">⬇ Télécharger</a></div><div class="state">${(blob.size / 1e6).toFixed(1)} Mo – ${((performance.now() - t0) / 1000).toFixed(0)} s</div>`);
      } catch (e) {
        console.error(e);
        st.textContent = '❌ ' + (e.message || e);
      }
    }
    state.busy = false; $('genBtn').disabled = false;
  };

  renderGrid();
  // accès pour les tests automatiques
  window.__pvs = { state, collect, chooseMetier, go };
})();
