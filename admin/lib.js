// Owner's panel for the GitHub Pages site: everything runs in her browser.
// The GitHub key (fine-grained, this repo only, Contents read/write) is stored in admin/config.json encrypted with her password.
// Saving prices or photos commits to the repo; GitHub Pages republishes the site in about a minute.

export const REPO = 'Endermen4ick/psuna-site';
export const BRANCH = 'main';
const API = 'https://api.github.com';
const ITERATIONS = 600000;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// --- page blocks -------------------------------------------------------------
export const block = (page, name) => {
  const m = new RegExp(`<!--${name}-->([\\s\\S]*?)<!--/${name}-->`).exec(page);
  if (!m) throw new Error(`На странице нет блока ${name}`);
  return m[1];
};
export const replaceBlock = (page, name, html) => page.replace(new RegExp(`<!--${name}-->[\\s\\S]*?<!--/${name}-->`), () => `<!--${name}-->${html}<!--/${name}-->`);
export const parsePrices = (html) => [...html.matchAll(/<li><span>([\s\S]*?)<\/span><b[^>]*>([\s\S]*?)<\/b><\/li>/g)].map((m) => ({ name: unesc(m[1]), price: unesc(m[2]) }));
export const parseWorks = (html) => [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
export const renderPrices = (prices) => prices.map((p) => `<li><span>${esc(p.name)}</span><b${/\d/.test(p.price) ? '' : ' class="ask"'}>${esc(p.price)}</b></li>`).join('');
export const renderWorks = (works) => works.map((src, i) => `<figure class="clip"><img class="" src="${esc(src)}" alt="Psuna tattoo, фото ${i + 1}" loading="eager" decoding="async"></figure>`).join('');

export const cleanPrices = (rows) => rows
  .map((p) => ({ name: String(p.name ?? '').trim().slice(0, 120), price: String(p.price ?? '').trim().slice(0, 60) }))
  .filter((p) => p.name && p.price);

// --- base64 for UTF-8 text and binary -------------------------------------------
const bytesToB64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64ToBytes = (b64) => Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
export const textToB64 = (text) => bytesToB64(new TextEncoder().encode(text));
export const b64ToText = (b64) => new TextDecoder().decode(b64ToBytes(b64));

// --- key encryption --------------------------------------------------------------
const deriveKey = async (password, salt) => {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};
export const encryptSecret = async (secret, password) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(password, salt), new TextEncoder().encode(secret)));
  return { v: 1, salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(ct) };
};
export const decryptSecret = async (box, password) => {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(box.iv) }, await deriveKey(password, b64ToBytes(box.salt)), b64ToBytes(box.ct));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
};

// --- GitHub contents API -----------------------------------------------------------
export const makeRepo = (token, fetchImpl = fetch) => {
  const call = async (path, init = {}) => {
    const res = await fetchImpl(`${API}/repos/${REPO}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (!res.ok) {
      const msg = res.status === 401 ? 'Ключ GitHub не подошёл или истёк.' : res.status === 403 ? 'У ключа нет прав на запись в репозиторий.' : `GitHub ответил ошибкой ${res.status}.`;
      throw Object.assign(new Error(msg), { status: res.status });
    }
    return res.status === 204 ? null : res.json();
  };
  return {
    check: () => call(''),
    read: async (path) => {
      const data = await call(`/contents/${path}?ref=${BRANCH}&t=${Date.now()}`);
      return { sha: data.sha, text: b64ToText(data.content) };
    },
    write: (path, b64, message, sha) => call(`/contents/${path}`, { method: 'PUT', body: JSON.stringify({ message, content: b64, branch: BRANCH, ...(sha ? { sha } : {}) }) }),
  };
};
