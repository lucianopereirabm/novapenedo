// Firebase + utilidades comuns (app do promotor e Gestão)
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, updatePassword, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, persistentSingleTabManager, serverTimestamp,
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where,
  onSnapshot, writeBatch, deleteField
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const firebaseConfig = {
  apiKey: "AIzaSyC4iWQTEYl7TsxgTc5Aubbw-1bB4ct4V8U",
  authDomain: "rota-nova-penedo.firebaseapp.com",
  projectId: "rota-nova-penedo",
  storageBucket: "rota-nova-penedo.firebasestorage.app",
  messagingSenderId: "709244094261",
  appId: "1:709244094261:web:fde6961dac02e667edae7c"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});
let _db;
// Banco guardado no celular: o que for registrado sem sinal fica salvo e é enviado sozinho quando a internet voltar,
// mesmo que o app seja fechado nesse meio-tempo.
try {
  _db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  try { _db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }) }); }
  catch (e2) { _db = initializeFirestore(app, {}); }
}
// pede ao celular para não apagar os dados guardados
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
export const db = _db;
export {
  signInWithEmailAndPassword, signOut, onAuthStateChanged, doc, getDoc, getDocs, setDoc, updateDoc,
  deleteDoc, collection, query, where, onSnapshot, writeBatch, deleteField, serverTimestamp
};

// ---------- login dos promotores ----------
export const DOMINIO_PROMOTOR = 'promotor.novapenedo.app';
export const emailPromotor = usuario => `${usuario}@${DOMINIO_PROMOTOR}`;
export const senhaPromotor = codigo => `np-${codigo}-rota`;
export const usuarioDeNome = nome => semAcento(String(nome || '').trim().split(/\s+/)[0]).replace(/[^a-z0-9]/g, '');

// Cria (ou troca o código de) um login de promotor sem derrubar a sessão do administrador
export async function criarAcessoPromotor(usuario, codigo, codigoAntigo) {
  const sec = initializeApp(firebaseConfig, 'sec-' + Date.now());
  const sa = getAuth(sec);
  try {
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(sa, emailPromotor(usuario), senhaPromotor(codigo));
    } catch (e) {
      if (e.code === 'auth/email-already-in-use' && codigoAntigo) {
        cred = await signInWithEmailAndPassword(sa, emailPromotor(usuario), senhaPromotor(codigoAntigo));
        if (codigoAntigo !== codigo) await updatePassword(cred.user, senhaPromotor(codigo));
      } else throw e;
    }
    return cred.user.uid;
  } finally {
    try { await signOut(sa); } catch (e) {}
    try { await deleteApp(sec); } catch (e) {}
  }
}

// ---------- utilidades ----------
export const $ = s => document.querySelector(s);
export const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DIAS_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
export const diaSemana = date => new Date(date + 'T12:00:00').getDay();
export const dataBR = date => { const [y, m, d] = date.split('-'); return d + '/' + m + '/' + y; };
export const hm = ms => ms ? new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
export function dur(a, b) { if (!a || !b) return '—'; const m = Math.max(0, Math.round((b - a) / 60000)); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0'); }
export const brl = n => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const n2 = n => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pctf = n => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
export function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
export function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

export function toast(msg, ms = 3200) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms);
}
export function abreModal(html) {
  let m = $('#modal');
  if (!m) {
    m = document.createElement('div'); m.id = 'modal'; m.className = 'modal';
    m.innerHTML = '<div class="modal-box" id="modal-box"></div>'; document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target.id === 'modal') fechaModal(); });
  }
  $('#modal-box').innerHTML = html; m.hidden = false;
}
export function fechaModal() { const m = $('#modal'); if (m) { m.hidden = true; $('#modal-box').innerHTML = ''; } }
export function confirma(texto, botao) {
  return new Promise(res => {
    abreModal(`<h3>${h(texto)}</h3><div class="row end"><button class="btn" id="cf-n">Cancelar</button><button class="btn primary" id="cf-s">${h(botao)}</button></div>`);
    $('#cf-n').onclick = () => { fechaModal(); res(false); };
    $('#cf-s').onclick = () => { fechaModal(); res(true); };
  });
}
export function erroMsg(e) {
  const c = e && e.code || '';
  if (c.includes('permission-denied')) return 'Sem permissão para essa ação.';
  if (c.includes('unavailable') || c.includes('network')) return 'Sem internet. O registro será enviado quando a conexão voltar.';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-login')) return 'Usuário ou código incorreto.';
  if (c.includes('too-many-requests')) return 'Muitas tentativas. Aguarde alguns minutos e tente de novo.';
  return 'Não deu certo: ' + (e && e.message || 'erro desconhecido');
}

// Distância em metros entre duas coordenadas
export function distancia(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export function pegaGPS(timeout = 20000) {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('Este celular não tem GPS disponível no navegador.'));
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lng: p.coords.longitude, prec: Math.round(p.coords.accuracy), ts: p.timestamp }),
      e => rej(new Error(e.code === 1 ? 'Permita o acesso à localização para fazer o check-in (cadeado ao lado do endereço > Localização > Permitir).' : 'Não consegui pegar o GPS. Vá para um lugar aberto e tente de novo.')),
      { enableHighAccuracy: true, timeout, maximumAge: 10000 }
    );
  });
}

// Reduz a foto para ~55 KB (cabe no banco gratuito)
export async function comprime(fonte, alvo = 56000) {
  let img;
  if (fonte instanceof HTMLCanvasElement) img = fonte;
  else {
    const url = URL.createObjectURL(fonte);
    try { img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  const W0 = img.naturalWidth || img.width, H0 = img.naturalHeight || img.height;
  let lado = 1100, q = 0.7, out = '';
  for (let t = 0; t < 12; t++) {
    const k = Math.min(1, lado / Math.max(W0, H0));
    const c = document.createElement('canvas'); c.width = Math.round(W0 * k); c.height = Math.round(H0 * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL('image/jpeg', q);
    if (out.length <= alvo) break;
    if (q > 0.45) q -= 0.1; else lado = Math.round(lado * 0.82);
  }
  return out;
}

// Câmera ao vivo (não aceita foto da galeria). Retorna canvas ou null.
export function tiraFoto({ frontal = false, titulo = 'Tirar foto' } = {}) {
  return new Promise(async resolve => {
    let stream;
    const fim = r => { if (stream) stream.getTracks().forEach(t => t.stop()); fechaModal(); resolve(r); };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: frontal ? 'user' : { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
    } catch (e) {
      abreModal(`<h3>Câmera bloqueada</h3><p class="muted">Permita o uso da câmera para este site (cadeado ao lado do endereço > Câmera > Permitir) e tente de novo.</p><div class="row end"><button class="btn primary" id="cam-ok">Entendi</button></div>`);
      $('#cam-ok').onclick = () => fim(null); return;
    }
    abreModal(`<div class="spread"><h3>${h(titulo)}</h3><button class="btn ghost" id="cam-x">Cancelar</button></div>
      <div class="cam"><video id="cam-v" playsinline autoplay muted></video></div>
      <button class="btn primary big" id="cam-ok">Tirar foto</button>`);
    const v = $('#cam-v'); v.srcObject = stream; if (frontal) v.style.transform = 'scaleX(-1)';
    $('#cam-x').onclick = () => fim(null);
    $('#cam-ok').onclick = () => {
      if (!v.videoWidth) return;
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      const g = c.getContext('2d'); g.drawImage(v, 0, 0);
      const s = new Date().toLocaleString('pt-BR');
      g.font = `${Math.round(c.height / 28)}px sans-serif`; g.fillStyle = 'rgba(0,0,0,.55)';
      g.fillRect(0, c.height - c.height / 18, c.width, c.height / 18);
      g.fillStyle = '#fff'; g.fillText(s, 12, c.height - c.height / 60);
      fim(c);
    };
  });
}
