'use strict';

const $ = (selector, parent = document) => parent.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const app = $('#app');
const state = {
  user: null,
  profile: null,
  prospects: [],
  results: [],
  area: '',
  contactFilter: 'all',
  authMode: 'login'
};
let toastTimer;
let searchInProgress = false;
let osmRetryAfter = 0;

document.title = 'Vitrine · Prospecção de lojas';
document.querySelector('.w').innerHTML = '<a class="logo" href="#/leads"><b>V</b>Vitrine</a><nav aria-label="Principal" id="nav"></nav>';
document.querySelector('footer').innerHTML = 'Lojas consultadas nos registros públicos do <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>. Confira os dados antes de entrar em contato.';

function toast(message, isError = false) {
  const element = $('#t');
  element.textContent = message;
  element.className = isError ? 'toast al' : 'toast';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.className = '';
    element.textContent = '';
  }, 5000);
}

async function api(action, method = 'GET', payload = null) {
  let response;
  try {
    response = await fetch(`api.php?action=${encodeURIComponent(action)}`, {
      method,
      credentials: 'same-origin',
      headers: payload ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
      cache: 'no-store'
    });
  } catch {
    throw new Error('Não foi possível acessar api.php. Envie todos os arquivos para o hosting AeonFree e acesse pelo endereço do site, não por file://.');
  }
  const result = await response.json().catch(() => null);
  if (!result || typeof result !== 'object') {
    throw new Error('api.php não retornou JSON. Publique os arquivos PHP no AeonFree e abra o site pelo endereço hospedado; o backend não funciona em file://.');
  }
  if (!response.ok || !result?.ok) {
    if (response.status === 401 && !['login', 'register', 'session'].includes(action)) {
      state.user = null;
      loginPage('Sua sessão terminou. Entre novamente para acessar seus contatos.');
    }
    throw new Error(result?.error || `O servidor respondeu com erro HTTP ${response.status}. Confira config.php e o banco MySQL.`);
  }
  return result;
}

function loginPage(message = '') {
  $('#nav').innerHTML = '';
  const registering = state.authMode === 'register';
  app.innerHTML = `<section class="hero"><h1>${registering ? 'Criar conta' : 'Entrar na Vitrine'}</h1>
    <p>Faça login para salvar lojas no banco e acessar sua lista de contatos.</p></section>
    ${message ? `<div class="al" role="status">${esc(message)}</div>` : ''}
    <div class="box"><form id="auth-form" style="padding:0">
      <label class="f">Seu e-mail<input name="email" type="email" required maxlength="254" autocomplete="email"></label>
      <label class="f">Senha<input name="password" type="password" required minlength="10" maxlength="72" autocomplete="${registering ? 'new-password' : 'current-password'}"></label>
      <button class="btn p f" type="submit">${registering ? 'Criar conta' : 'Entrar'}</button>
    </form><button class="btn o" id="auth-toggle">${registering ? 'Já tenho uma conta' : 'Criar minha conta'}</button>
    <p class="m">Use uma senha com pelo menos 10 caracteres. Os contatos salvos ficam vinculados à sua conta.</p></div>`;
  $('#auth-toggle').onclick = () => {
    state.authMode = registering ? 'login' : 'register';
    loginPage();
  };
  $('#auth-form').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const action = registering ? 'register' : 'login';
    try {
      await api(action, 'POST', {
        email: String(form.get('email')).trim(),
        password: String(form.get('password'))
      });
      await loadAccount();
      page();
    } catch (error) {
      loginPage(error.message);
    }
  };
}

async function loadAccount() {
  const account = await api('session');
  if (!account.user) {
    state.user = null;
    state.profile = null;
    state.prospects = [];
    return false;
  }
  state.user = account.user;
  state.profile = account.user;
  const contacts = await api('list_leads');
  state.prospects = contacts.leads;
  return true;
}

function page(message = '') {
  if (!state.user) {
    loginPage(message);
    return;
  }
  $('#nav').innerHTML = `<a href="#/leads">Buscar lojas</a><a href="#/saved">Meus contatos (${state.prospects.length})</a><button class="btn o" id="logout">Sair</button>`;
  document.querySelectorAll('#nav a').forEach(link => link.classList.toggle('on', link.hash === location.hash));
  $('#logout').onclick = async () => {
    try {
      await api('logout', 'POST', {});
      state.user = null;
      state.profile = null;
      state.prospects = [];
      state.results = [];
      loginPage();
    } catch (error) {
      toast(error.message, true);
    }
  };
  if (location.hash === '#/saved') savedPage(message);
  else leadsPage(message);
}

function profilePanel() {
  const profile = state.profile || {};
  return `<section class="sec"><h2>Seus dados profissionais</h2></section>
    <div class="box"><form id="profile-form" style="padding:0">
      <label>Seu nome *<input name="full_name" type="text" required maxlength="120" value="${esc(profile.full_name || '')}"></label>
      <label>Seu e-mail para resposta<input name="reply_email" type="email" maxlength="254" value="${esc(profile.reply_email || state.user.email || '')}"></label>
      <label class="f">Serviço oferecido *<input name="service_description" type="text" required maxlength="200" value="${esc(profile.service_description || 'criação de sites profissionais')}"></label>
      <label class="f">Portfólio<input name="portfolio_url" type="url" maxlength="2048" placeholder="https://..." value="${esc(profile.portfolio_url || '')}"></label>
      <button class="btn o f" type="submit">Salvar perfil no banco</button>
    </form><p class="m">O perfil é armazenado no MySQL do AeonFree. Gmail e WhatsApp abrem mensagens individuais preenchidas para você revisar e enviar — a Vitrine não dispara mensagens automaticamente.</p></div>`;
}

function leadsPage(message = '') {
  app.innerHTML = `<section class="hero"><h1>Buscar lojas nos registros públicos</h1>
    <p>Mostramos lojas do OpenStreetMap sem site informado no cadastro. Isso não confirma que a loja não tenha um site. Contatos aparecem apenas quando foram publicados pelos próprios colaboradores do cadastro.</p>
    <div class="box"><label>Cidade ou bairro<input id="area" type="text" value="${esc(state.area)}" placeholder="Ex.: Fortaleza, CE" autocomplete="address-level2"></label>
      <label>Raio<select id="radius"><option value="2000">2 km</option><option value="5000" selected>5 km</option><option value="10000">10 km</option></select></label>
      <button class="btn p" id="search">Buscar registros públicos</button></div></section>
    ${message ? `<div class="al" role="status">${esc(message)}</div>` : ''}
    ${profilePanel()}
    <section class="sec"><h2>Resultados reais do OpenStreetMap</h2></section>
    <div class="seg" role="group" aria-label="Filtrar resultados por contato">
      <button type="button" data-contact-filter="all" aria-pressed="${state.contactFilter === 'all'}">Todos</button>
      <button type="button" data-contact-filter="with" aria-pressed="${state.contactFilter === 'with'}">Com contato (e-mail ou telefone)</button>
      <button type="button" data-contact-filter="without" aria-pressed="${state.contactFilter === 'without'}">Sem contato</button>
    </div>
    <p class="m" id="count" aria-live="polite">${state.results.length ? `${state.results.length} registros encontrados.` : 'Faça uma busca para consultar os registros atuais.'}</p>
    <div class="grid" id="results">${state.results.map(resultCard).join('')}</div>
    <p class="m" style="margin-top:20px">Dados: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>. As mensagens são preparadas individualmente; revise e envie manualmente. Não fazemos disparos automáticos.</p>`;
  $('#search').onclick = searchShops;
  document.querySelectorAll('[data-contact-filter]').forEach(button => {
    button.onclick = () => {
      state.contactFilter = button.dataset.contactFilter;
      renderResults();
    };
  });
  $('#area').onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); searchShops(); }
  };
  $('#profile-form').onsubmit = saveProfile;
  renderResults();
}

function renderResults() {
  const results = $('#results');
  const count = $('#count');
  if (!results || !count) return;

  const filtered = state.results.filter(shop => {
    const hasContact = Boolean(String(shop.email || '').trim() || String(shop.phone || '').trim());
    return state.contactFilter === 'with' ? hasContact
      : state.contactFilter === 'without' ? !hasContact
        : true;
  });

  count.textContent = state.results.length
    ? `Exibindo ${filtered.length} de ${state.results.length} registros${state.area ? ` para ${state.area}` : ''}. Contato significa e-mail ou telefone informado no cadastro público.`
    : 'Faça uma busca para consultar os registros atuais.';
  results.innerHTML = filtered.length
    ? filtered.map(resultCard).join('')
    : state.results.length
      ? '<div class="empty"><h3>Nenhum resultado neste filtro</h3><p>Escolha outra opção para ver os demais registros.</p></div>'
      : '';
  document.querySelectorAll('[data-contact-filter]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.contactFilter === state.contactFilter));
  });
  bindSaveButtons();
}

function draftUrl(shop) {
  const profile = state.profile || {};
  if (!shop.email || !profile.full_name || !profile.service_description) return '';
  const subject = `Uma ideia para a presença online da ${shop.name}`;
  const body = outreachMessage(shop.name, profile);
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(shop.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function whatsappUrl(shop) {
  const profile = state.profile || {};
  const phone = normalizeWhatsAppPhone(shop.phone);
  if (!phone || !profile.full_name || !profile.service_description) return '';
  return `https://wa.me/${phone}?text=${encodeURIComponent(outreachMessage(shop.name, profile))}`;
}

function mapsUrl(shop) {
  const latitude = Number(shop.latitude);
  const longitude = Number(shop.longitude);
  const hasCoordinates = shop.latitude !== null && shop.latitude !== ''
    && shop.longitude !== null && shop.longitude !== ''
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  const query = hasCoordinates
    ? `${latitude},${longitude}`
    : [shop.name, shop.address, shop.city].filter(Boolean).join(', ');
  if (!query) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function outreachMessage(name, profile) {
  return `Olá! Falo com a equipe de ${name}?\n\nMeu nome é ${profile.full_name} e trabalho com ${profile.service_description}. Encontrei o contato público da loja no OpenStreetMap e gostaria de apresentar meu trabalho e saber se faz sentido conversar sobre uma presença online.\n\n${profile.portfolio_url ? `Portfólio: ${profile.portfolio_url}\n` : ''}${profile.reply_email ? `Meu contato: ${profile.reply_email}\n` : ''}\nSe este canal não for apropriado ou não tiverem interesse, peço desculpas pela mensagem; não voltarei a entrar em contato.\n\nAtenciosamente,\n${profile.full_name}`;
}

function normalizeWhatsAppPhone(value) {
  const original = String(value || '').trim();
  if (!original) return '';
  const number = original.replace(/\s*(?:ext\.?|ramal|x)\s*\d+\s*$/i, '');
  let digits = number.replace(/\D/g, '');
  const international = number.startsWith('+') || number.startsWith('00');
  if (number.startsWith('00')) digits = digits.slice(2);

  if (digits.startsWith('55')) {
    digits = digits.slice(2);
  } else if (international) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0' ? digits : '';
  }

  if (/^(?:0800|0300|0303)/.test(digits)) return '';

  if (digits.startsWith('0')) {
    if (digits.length === 11 || digits.length === 12) {
      digits = digits.slice(1);
    } else if (digits.length === 13 || digits.length === 14) {
      digits = digits.slice(3);
    }
  }

  return digits.length === 10 || digits.length === 11 ? `55${digits}` : '';
}

function resultCard(shop) {
  const saved = state.prospects.some(contact => contact.osm_type === shop.osm_type && String(contact.osm_id) === String(shop.osm_id));
  const draft = draftUrl(shop);
  const whatsapp = whatsappUrl(shop);
  const maps = mapsUrl(shop);
  return `<article class="card"><div class="cb"><span class="tag">Site não informado no OSM</span>
    <h3>${esc(shop.name)}</h3><p class="m">${esc(shop.category || 'Loja')} · ${esc(shop.address || shop.city || state.area)} · ${shop.distance.toFixed(1)} km</p>
    ${shop.email ? `<p class="m">E-mail público: <a href="mailto:${encodeURIComponent(shop.email)}">${esc(shop.email)}</a></p>` : '<p class="m">E-mail não informado neste registro público.</p>'}
    ${shop.phone ? `<p class="m">Telefone: <a href="tel:${encodeURIComponent(shop.phone)}">${esc(shop.phone)}</a></p>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap">${draft ? `<a class="btn p" href="${esc(draft)}" target="_blank" rel="noopener">Preparar mensagem no Gmail</a>` : ''}${whatsapp ? `<a class="btn o" href="${esc(whatsapp)}" target="_blank" rel="noopener">Abrir mensagem no WhatsApp</a>` : ''}</div>
    ${whatsapp ? '<p class="m">O número precisa estar cadastrado no WhatsApp. A Vitrine não consegue verificar isso; confirme o telefone e tente pelo contato oficial da loja se o link não abrir.</p>' : shop.phone ? '<p class="m">Este telefone não está em formato válido para abrir no WhatsApp. Confira o número no registro público.</p>' : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:auto">
      ${saved ? '<span class="tag">Salvo no banco</span>' : `<button class="btn o" data-save="${esc(shop.osm_type)}/${esc(shop.osm_id)}">Salvar contato no banco</button>`}
      ${maps ? `<a class="btn o" href="${esc(maps)}" target="_blank" rel="noopener">Abrir no Google Maps</a>` : ''}
    </div></div></article>`;
}

async function saveProfile(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const profile = Object.fromEntries(form);
  for (const key of Object.keys(profile)) profile[key] = String(profile[key]).trim();
  if (profile.portfolio_url && !/^https:\/\//i.test(profile.portfolio_url)) {
    toast('O link do portfólio precisa começar com https://.', true);
    return;
  }
  try {
    const result = await api('save_profile', 'POST', profile);
    state.profile = result.profile;
    page('Perfil salvo no banco de dados.');
  } catch (error) {
    toast(error.message, true);
  }
}

async function geocode(area) {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(area)}`, {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Localização indisponível (HTTP ${response.status}).`);
  const locations = await response.json();
  if (!locations.length) throw new Error('Local não encontrado no Brasil. Informe cidade e estado.');
  return locations[0];
}

async function queryStores(query) {
  const endpoints = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];
  const errors = [];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        headers: { Accept: 'application/json' }
      });
      if (response.status === 406 || response.status === 429) {
        osmRetryAfter = Date.now() + 30000;
        throw Object.assign(new Error(`O OpenStreetMap limitou temporariamente a consulta (HTTP ${response.status}). Aguarde 30 segundos antes de tentar novamente.`), { rateLimited: true });
      }
      if (!response.ok) { errors.push(`${new URL(endpoint).hostname}: HTTP ${response.status}`); continue; }
      return await response.json();
    } catch (error) {
      if (error.rateLimited) throw error;
      errors.push(`${new URL(endpoint).hostname}: ${error.message}`);
    }
  }
  throw new Error(`Serviços de mapas indisponíveis (${errors.join('; ')}). Tente novamente mais tarde.`);
}

async function searchShops() {
  const area = $('#area').value.trim();
  const radius = Number($('#radius').value);
  const count = $('#count');
  const results = $('#results');
  if (area.length < 2) { toast('Digite uma cidade ou bairro.', true); return; }
  if (searchInProgress) return;
  if (Date.now() < osmRetryAfter) {
    count.textContent = 'O OpenStreetMap está limitando consultas. Aguarde antes de pesquisar novamente.';
    return;
  }
  searchInProgress = true;
  const searchButton = $('#search');
  searchButton.disabled = true;
  state.area = area;
  state.results = [];
  count.textContent = 'Consultando dados públicos…';
  results.innerHTML = '';
  try {
    const place = await geocode(area);
    const latitude = Number(place.lat), longitude = Number(place.lon);
    const query = `[out:json][timeout:25];nwr(around:${radius},${latitude},${longitude})["shop"]["name"];out center 100;`;
    const data = await queryStores(query);
    const toRadians = degrees => degrees * Math.PI / 180;
    state.results = (data.elements || []).filter(element => {
      const tags = element.tags || {};
      return !String(tags.website || tags['contact:website'] || '').trim();
    }).map(element => {
      const tags = element.tags || {};
      const point = element.center || element;
      const lat = Number(point.lat), lon = Number(point.lon);
      const dLat = toRadians(lat - latitude), dLon = toRadians(lon - longitude);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(latitude)) * Math.cos(toRadians(lat)) * Math.sin(dLon / 2) ** 2;
      const distance = 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
      const address = [
        tags['addr:street'], tags['addr:housenumber'],
        tags['addr:suburb'] || tags['addr:neighbourhood']
      ].filter(Boolean).join(', ');
      return {
        osm_type: element.type,
        osm_id: Number(element.id),
        name: tags.name,
        category: tags.shop || 'Loja',
        address,
        city: tags['addr:city'] || place.name || area,
        email: tags['contact:email'] || tags.email || '',
        phone: tags['contact:phone'] || tags.phone || '',
        latitude: lat,
        longitude: lon,
        distance,
        source_url: `https://www.openstreetmap.org/${element.type}/${element.id}`
      };
    }).filter(shop => shop.name && Number.isFinite(shop.distance)).sort((left, right) => left.distance - right.distance);
    const number = state.results.length;
    count.textContent = number
      ? `${number} ${number === 1 ? 'registro sem site informado no cadastro encontrado' : 'registros sem site informado no cadastro encontrados'} em ${radius / 1000} km de ${place.display_name}. O resultado é limitado aos 100 registros mais próximos.`
      : 'Nenhum registro correspondente foi encontrado. Os dados do OpenStreetMap podem estar incompletos; isso não comprova que não existam lojas.';
    renderResults();
  } catch (error) {
    count.textContent = `A busca não foi concluída: ${error.message}`;
    results.innerHTML = '<div class="al" role="alert">Nenhum resultado de exemplo será mostrado.</div>';
  } finally {
    searchInProgress = false;
    if (searchButton.isConnected) searchButton.disabled = false;
  }
}

function bindSaveButtons() {
  document.querySelectorAll('[data-save]').forEach(button => {
    button.onclick = async () => {
      const [type, rawId] = button.dataset.save.split('/');
      const shop = state.results.find(item => item.osm_type === type && String(item.osm_id) === rawId);
      if (!shop) { toast('Esse resultado expirou. Consulte os registros novamente.', true); return; }
      button.disabled = true;
      try {
        await api('save_lead', 'POST', shop);
        const contacts = await api('list_leads');
        state.prospects = contacts.leads;
        page('Contato salvo no banco.');
      } catch (error) {
        button.disabled = false;
        toast(error.message, true);
      }
    };
  });
}

const leadStatuses = [
  ['new', 'Novo'], ['contacted', 'Contatado'], ['replied', 'Respondeu'],
  ['not_interested', 'Sem interesse'], ['customer', 'Cliente']
];

function savedPage(message = '') {
  const cards = state.prospects.map(contact => `<article class="card"><div class="cb">
    <span class="tag">${esc(contact.category || 'Loja')} · OpenStreetMap</span><h3>${esc(contact.name)}</h3>
    <p class="m">${esc([contact.address, contact.city].filter(Boolean).join(' · '))}</p>
    ${contact.email ? `<p class="m">E-mail: <a href="mailto:${encodeURIComponent(contact.email)}">${esc(contact.email)}</a></p>` : '<p class="m">E-mail público não informado.</p>'}
    ${contact.phone ? `<p class="m">Telefone: <a href="tel:${encodeURIComponent(contact.phone)}">${esc(contact.phone)}</a></p>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap">${draftUrl(contact) ? `<a class="btn p" href="${esc(draftUrl(contact))}" target="_blank" rel="noopener">Preparar mensagem no Gmail</a>` : ''}${whatsappUrl(contact) ? `<a class="btn o" href="${esc(whatsappUrl(contact))}" target="_blank" rel="noopener">Abrir mensagem no WhatsApp</a>` : ''}</div>
    ${whatsappUrl(contact) ? '<p class="m">O número precisa estar cadastrado no WhatsApp; confirme o telefone se o link não abrir.</p>' : contact.phone ? '<p class="m">Este telefone não está em formato válido para abrir no WhatsApp.</p>' : ''}
    <label>Status<select data-status="${contact.id}">${leadStatuses.map(([value, label]) => `<option value="${value}" ${contact.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label>Notas<textarea data-notes="${contact.id}" rows="3" maxlength="4000">${esc(contact.notes)}</textarea></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn o" data-update="${contact.id}">Salvar alterações</button>
    ${mapsUrl(contact) ? `<a class="btn o" href="${esc(mapsUrl(contact))}" target="_blank" rel="noopener">Abrir no Google Maps</a>` : ''}
    <button class="btn d" data-delete="${contact.id}">Remover</button></div>
    </div></article>`).join('');
  app.innerHTML = `<section class="hero"><h1>Meus contatos</h1><p>Os registros salvos e suas notas ficam no banco AeonFree associados à sua conta.</p></section>
    ${message ? `<div class="al" role="status">${esc(message)}</div>` : ''}
    ${cards ? `<div class="grid">${cards}</div>` : '<div class="empty"><h3>Nenhum contato salvo</h3><p>Os contatos só aparecem nesta lista depois que você salvar um registro real.</p><a class="btn p" href="#/leads">Buscar lojas</a></div>'}`;
  document.querySelectorAll('[data-update]').forEach(button => {
    button.onclick = async () => {
      const id = Number(button.dataset.update);
      const status = $(`[data-status="${id}"]`).value;
      const notes = $(`[data-notes="${id}"]`).value.trim();
      try {
        await api('update_lead', 'POST', { id, status, notes });
        const contacts = await api('list_leads');
        state.prospects = contacts.leads;
        page('Contato atualizado no banco.');
      } catch (error) { toast(error.message, true); }
    };
  });
  document.querySelectorAll('[data-delete]').forEach(button => {
    button.onclick = async () => {
      const contact = state.prospects.find(item => String(item.id) === button.dataset.delete);
      if (!contact || !confirm(`Remover "${contact.name}" dos seus contatos?`)) return;
      try {
        await api('delete_lead', 'POST', { id: contact.id });
        const contacts = await api('list_leads');
        state.prospects = contacts.leads;
        page('Contato removido.');
      } catch (error) { toast(error.message, true); }
    };
  });
}

async function start() {
  app.innerHTML = '<div class="empty">Conectando ao servidor do AeonFree…</div>';
  try {
    const account = await api('session');
    if (!account.user) { loginPage(); return; }
    const hasAccount = await loadAccount();
    if (hasAccount) page();
    else loginPage();
  } catch (error) {
    $('#nav').innerHTML = '';
    app.innerHTML = `<div class="al" role="alert">O servidor não está pronto: ${esc(error.message)}<p>Importe <b>database.sql</b> pelo phpMyAdmin do AeonFree e confirme os dados MySQL em <b>config.php</b>. Envie <b>index.php</b>, <b>app.html</b>, <b>vitrine-app.js</b>, <b>api.php</b>, <b>config.php</b> e <b>.htaccess</b> para a pasta pública do site.</p></div>`;
  }
}

window.addEventListener('hashchange', () => {
  if (state.user) page();
});
if (!location.hash) location.hash = '#/leads';
start();
