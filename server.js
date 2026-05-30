/**
 * Kit Panela Shop - production backend.
 * Uses Supabase as the single source of truth for orders, gateways and settings.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminSavePassword = process.env.ADMIN_SAVE_PASSWORD || '530348';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const app = express();
const PORT = process.env.PORT || 3000;
const CHECKOUT_PATH = path.join(__dirname, 'checkout.html');
const LANDING_PATH = path.join(__dirname, 'Kit Panela.html');

app.disable('etag');
app.use(express.json({ limit: '10mb' }));

function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
}

app.use(express.static(__dirname, {
  etag: false,
  lastModified: false,
  setHeaders: res => noStore(res)
}));

function requireDatabase(res) {
  if (supabase) return true;
  res.status(500).json({
    success: false,
    error: 'Supabase nao configurado. Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.'
  });
  return false;
}

function formatCurrencyAmount(amount) {
  return Number(amount || 0).toFixed(2);
}

function formatOrder(row) {
  return {
    id: row.order_id,
    name: row.customer_name,
    product: row.product_name,
    date: row.created_at || row.date,
    amount: Number(row.amount || 0),
    status: row.status || 'pending',
    created_at: row.created_at || row.date,
    trafficSource: row.traffic_source || null,
    paymentMethod: row.payment_method || null
  };
}

function sha256Normalized(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function sha256Digits(value) {
  const digits = toDigits(value);
  if (!digits) return null;
  return crypto.createHash('sha256').update(digits).digest('hex');
}

async function getTrackingSettings() {
  const { data, error } = await supabase
    .from('tracking_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();

  if (error) throw error;
  return data || {};
}

function buildTikTokUser(order) {
  const user = {};
  const email = sha256Normalized(order.customer_email);
  const phone = sha256Digits(order.customer_phone);
  const externalId = sha256Digits(order.customer_cpf);

  if (email) user.email = email;
  if (phone) user.phone = phone;
  if (externalId) user.external_id = externalId;
  return user;
}

async function sendTikTokPaidPurchase(order) {
  const settings = await getTrackingSettings();
  const pixelId = String(settings.tiktok_pixel_id || '').trim();
  const accessToken = String(settings.tiktok_access_token || '').trim();

  if (!pixelId || !accessToken) {
    return { status: 'skipped', reason: 'TikTok Pixel ID ou token nao configurado.' };
  }

  const amount = Number(order.amount || 0);
  const productName = String(order.product_name || 'Produto');
  const payload = {
    event_source: 'web',
    event_source_id: pixelId,
    data: [
      {
        event: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: `paid_${String(order.order_id || '').replace(/[^a-zA-Z0-9_-]/g, '')}`,
        user: buildTikTokUser(order),
        properties: {
          currency: 'BRL',
          value: amount,
          content_type: 'product',
          contents: [
            {
              content_id: productName,
              content_name: productName,
              quantity: 1,
              price: amount
            }
          ]
        }
      }
    ]
  };

  try {
    const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
      method: 'POST',
      headers: {
        'Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code) {
      console.warn('[TRACKING] TikTok Purchase rejected:', data.message || response.statusText || data);
      return {
        status: 'failed',
        reason: data.message || response.statusText || 'TikTok recusou o evento Purchase.'
      };
    }
    return { status: 'sent', event: 'Purchase', eventId: payload.data[0].event_id };
  } catch (error) {
    console.warn('[TRACKING] TikTok Purchase failed:', error.message);
    return { status: 'failed', reason: error.message };
  }
}

function sanitizeGateway(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    apiUrl: row.api_url || '',
    publicKey: row.public_key || '',
    webhook: row.webhook_url || '',
    logoUrl: row.logo_url || '',
    autoApprove: row.auto_approve !== false,
    isActive: row.is_active === true,
    secretConfigured: Boolean(row.secret_key),
    updatedAt: row.updated_at
  };
}

function sanitizeProduct(row) {
  const images = Array.isArray(row.images) ? row.images : [];
  const comments = Array.isArray(row.comments) ? row.comments : [];
  const fields = row.fields && typeof row.fields === 'object' && !Array.isArray(row.fields) ? row.fields : {};
  const elements = row.elements && typeof row.elements === 'object' && !Array.isArray(row.elements) ? row.elements : {};
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    subtitle: row.subtitle || '',
    description: row.description || '',
    price: Number(row.price || 0),
    originalPrice: Number(row.original_price || 0),
    discount: Number(row.discount || 0),
    coupon: Number(row.coupon || 0),
    imageUrl: row.image_url || '',
    images,
    comments,
    fields,
    elements,
    analysisNotes: row.analysis_notes || '',
    isActive: row.is_active !== false,
    viewCount: Number(row.view_count || 0),
    orderCount: Number(row.order_count || 0),
    url: `/produto/${row.slug}`,
    updatedAt: row.updated_at
  };
}

const funnelStageLabels = {
  product_view: 'Pagina do produto',
  checkout_opened: 'Checkout aberto',
  checkout_contact: 'Dados pessoais',
  checkout_address: 'Endereco',
  checkout_payment: 'Gerando Pix',
  checkout_pix_ready: 'Pix gerado',
  checkout_error: 'Erro no checkout'
};

function sanitizeShortText(value, max = 180) {
  return String(value || '').trim().slice(0, max);
}

async function recordFunnelEvent(req, event = {}) {
  if (!supabase) return null;
  const stage = sanitizeShortText(event.stage || event.eventType, 60);
  if (!stage) return null;
  const row = {
    event_type: sanitizeShortText(event.eventType || stage, 60),
    stage,
    product_slug: sanitizeShortText(event.productSlug, 120) || null,
    product_name: sanitizeShortText(event.productName, 220) || null,
    session_id: sanitizeShortText(event.sessionId, 120) || null,
    order_id: sanitizeShortText(event.orderId, 80) || null,
    traffic_source: sanitizeShortText(event.trafficSource, 120) || null,
    path: sanitizeShortText(event.path || req.originalUrl, 220) || null,
    user_agent: sanitizeShortText(req.headers['user-agent'], 500) || null
  };
  const { data, error } = await supabase.from('funnel_events').insert([row]).select().single();
  if (error) {
    console.error('[FUNNEL] Error recording event:', error.message);
    return null;
  }
  return data;
}

function summarizeFunnelEvents(events) {
  const totals = {
    productViews: 0,
    checkoutStarts: 0,
    pixGenerated: 0,
    checkoutErrors: 0
  };
  const latestBySession = new Map();

  events.forEach(event => {
    if (event.stage === 'product_view') totals.productViews += 1;
    if (event.stage === 'checkout_opened') totals.checkoutStarts += 1;
    if (event.stage === 'checkout_pix_ready') totals.pixGenerated += 1;
    if (event.stage === 'checkout_error') totals.checkoutErrors += 1;

    const sessionKey = event.session_id || `${event.stage}:${event.id}`;
    const current = latestBySession.get(sessionKey);
    if (!current || new Date(event.created_at) > new Date(current.created_at)) {
      latestBySession.set(sessionKey, event);
    }
  });

  const stageTotals = {};
  latestBySession.forEach(event => {
    stageTotals[event.stage] = (stageTotals[event.stage] || 0) + 1;
  });

  const stageOrder = ['product_view', 'checkout_opened', 'checkout_contact', 'checkout_address', 'checkout_payment', 'checkout_pix_ready', 'checkout_error'];
  const stages = stageOrder.map(stage => ({
    stage,
    label: funnelStageLabels[stage] || stage,
    count: stageTotals[stage] || 0
  }));

  return {
    totals,
    stages,
    recent: events.slice(0, 8).map(event => ({
      stage: event.stage,
      label: funnelStageLabels[event.stage] || event.stage,
      productName: event.product_name || event.product_slug || 'Produto',
      orderId: event.order_id || null,
      createdAt: event.created_at
    })),
    updatedAt: new Date().toISOString()
  };
}

function productPayloadFromBody(body) {
  const {
    name,
    slug,
    subtitle,
    description,
    price,
    originalPrice,
    discount,
    coupon,
    imageUrl,
    images,
    comments,
    fields,
    elements,
    analysisNotes,
    isActive
  } = body;
  const hasOwn = key => Object.prototype.hasOwnProperty.call(body, key);
  const row = {
    slug: slugify(slug || name),
    name,
    subtitle: subtitle || '',
    description: description || '',
    price: Number(price || 0),
    original_price: Number(originalPrice || 0),
    discount: Number(discount || 0),
    coupon: Number(coupon || 0),
    analysis_notes: analysisNotes || '',
    is_active: isActive !== false,
    updated_at: new Date().toISOString()
  };
  if (hasOwn('imageUrl')) row.image_url = imageUrl || '';
  if (hasOwn('images')) row.images = Array.isArray(images) ? images : [];
  if (hasOwn('comments')) row.comments = Array.isArray(comments) ? comments : [];
  if (hasOwn('fields')) row.fields = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
  if (hasOwn('elements')) row.elements = elements && typeof elements === 'object' && !Array.isArray(elements) ? elements : {};
  return row;
}

function stripUnknownProductColumn(row, message) {
  const lower = String(message || '').toLowerCase();
  const optionalColumns = ['elements', 'fields', 'comments', 'images'];
  const missing = optionalColumns.find(column => lower.includes(column));
  if (!missing || !(missing in row)) return null;
  delete row[missing];
  if (missing === 'images') delete row.image_url;
  return missing;
}

async function saveProductRow(operation, row, id) {
  const payload = { ...row };
  let lastError = null;
  const omittedColumns = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const query = operation === 'insert'
      ? supabase.from('product_pages').insert(payload)
      : supabase.from('product_pages').update(payload).eq('id', id);
    const { data, error } = await query.select().single();
    if (!error) return { data, omittedColumns };
    lastError = error;
    const omittedColumn = stripUnknownProductColumn(payload, error.message);
    if (!omittedColumn) break;
    omittedColumns.push(omittedColumn);
  }
  throw lastError;
}

function buildProductRuntimeScript(product) {
  const productJson = JSON.stringify(product).replace(/</g, '\\u003c');
  return `
<script>
window.__PRODUCT_PAGE__ = ${productJson};
(function () {
  var product = window.__PRODUCT_PAGE__ || {};
  var fields = product.fields || {};
  var elements = product.elements || {};
  var elementDefaults = { gallery: true, priceBar: true, savings: true, badges: true, shipping: true, protection: true, store: true, comments: true, details: true, cartButton: true };
  function money(value) {
    return 'R$ ' + Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function text(selector, value) {
    if (value === undefined || value === null || value === '') return;
    var el = document.querySelector(selector);
    if (el) el.textContent = value;
  }
  function html(selector, value) {
    if (value === undefined || value === null || value === '') return;
    var el = document.querySelector(selector);
    if (el) el.innerHTML = value;
  }
  function attr(selector, name, value) {
    if (!value) return;
    var el = document.querySelector(selector);
    if (el) el.setAttribute(name, value);
  }
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }
  function splitLines(value) {
    return String(value || '').split(/\\r?\\n/).map(function (line) { return line.trim(); }).filter(Boolean);
  }
  function enabled(key) {
    return elements[key] === undefined ? elementDefaults[key] !== false : elements[key] !== false;
  }
  function setVisible(selector, key) {
    document.querySelectorAll(selector).forEach(function (el) {
      el.style.display = enabled(key) ? '' : 'none';
    });
  }
  function polishButtons() {
    var style = document.getElementById('product-page-polish') || document.createElement('style');
    style.id = 'product-page-polish';
    style.textContent = '.bb-cart{white-space:normal!important;text-overflow:clip!important;line-height:1.05!important;font-size:11px!important;text-align:center}.bb-buy{font-size:13px!important}.rv{background:#fff}.rv-stars,.rv-stars-row{letter-spacing:1px}';
    document.head.appendChild(style);
  }
  function specsFromFields() {
    if (Array.isArray(fields.specs)) return fields.specs;
    return splitLines(fields.specsText).map(function (line) {
      var parts = line.split(':');
      return { key: (parts.shift() || '').trim(), value: parts.join(':').trim() };
    }).filter(function (item) { return item.key || item.value; });
  }
  function renderSpecs() {
    var specs = specsFromFields();
    if (!specs.length) return;
    var box = document.querySelector('.pd-specs');
    if (!box) return;
    box.innerHTML = specs.map(function (item) {
      return '<div class="pd-spec-key">' + escapeHtml(item.key) + '</div><div class="pd-spec-val">' + escapeHtml(item.value) + '</div>';
    }).join('');
  }
  function renderProtection() {
    var items = splitLines(fields.protectionItemsText);
    if (!items.length) return;
    var box = document.querySelector('.cp-grid');
    if (!box) return;
    box.innerHTML = items.map(function (line) {
      return '<div class="cp-item"><span>&#10003;</span><span>' + escapeHtml(line) + '</span></div>';
    }).join('');
  }
  function renderDescription() {
    var desc = product.description || fields.description || '';
    var bullets = Array.isArray(fields.bullets) ? fields.bullets : splitLines(fields.bulletsText);
    if (!desc && !bullets.length) return;
    var box = document.querySelector('.pd-desc-text');
    if (!box) return;
    var markup = '';
    if (desc) {
      splitLines(desc).forEach(function (line) {
        markup += '<p>' + escapeHtml(line) + '</p>';
      });
    }
    if (bullets.length) {
      markup += '<h3>' + escapeHtml(fields.bulletsTitle || 'Destaques') + '</h3>';
      bullets.forEach(function (line) {
        markup += '<div class="pd-bullet"><span class="dot">&bull;</span><p>' + escapeHtml(line) + '</p></div>';
      });
    }
    box.innerHTML = markup;
  }
  function renderGallery() {
    var gallery = Array.isArray(product.images) && product.images.length ? product.images : (product.imageUrl ? [product.imageUrl] : []);
    if (!gallery.length) return;
    var row = document.querySelector('#carTrack .row');
    if (!row) return;
    row.innerHTML = gallery.map(function (src) {
      return '<div class="car-slide"><div class="car-slide-inner"><img src="' + escapeHtml(src) + '" alt="' + escapeHtml(product.name || 'Produto') + '"></div></div>';
    }).join('');
    text('#carCur', '1');
    text('#carTotal', String(gallery.length));
  }
  function renderComments() {
    if (!Array.isArray(product.comments) || !product.comments.length) return;
    var section = document.querySelector('.rv');
    if (!section) {
      section = document.createElement('section');
      section.className = 'rv';
      var store = document.querySelector('.si');
      (store && store.parentNode ? store.parentNode : document.body).insertBefore(section, store || null);
    }
    var avg = product.comments.reduce(function (sum, item) { return sum + Number(item.rating || 5); }, 0) / product.comments.length;
    var stars = '&#9733;&#9733;&#9733;&#9733;&#9733;';
    var header = '<div class="rv-head"><div class="rv-title">Avalia&ccedil;&otilde;es dos clientes <span class="rv-title-count">(' + product.comments.length + ')</span></div><div class="rv-vermais">Ver mais &gt;</div></div>'
      + '<div class="rv-rating-row"><span class="rv-rating">' + avg.toFixed(1).replace('.', ',') + '</span><span class="rv-rating-of">/5</span><span class="rv-stars-row">' + stars + '</span></div>';
    var items = product.comments.map(function (item) {
      var rating = Math.max(1, Math.min(5, Number(item.rating || 5)));
      var photos = item.image ? '<div class="rv-photos"><img class="rv-photo" src="' + escapeHtml(item.image) + '" alt=""></div>' : '';
      return '<div class="rv-item">'
        + '<div class="rv-head-row">' + (item.avatar ? '<img class="rv-avatar" src="' + escapeHtml(item.avatar) + '" alt="">' : '')
        + '<span class="rv-name">' + escapeHtml(item.name || 'Cliente') + '</span><span class="rv-confirmed">Compra verificada</span></div>'
        + '<div class="rv-stars">' + Array(rating + 1).join('&#9733;') + '</div>'
        + '<div class="rv-text">' + escapeHtml(item.text || '') + '</div>' + photos + '</div>';
    }).join('');
    section.innerHTML = header + items;
  }
  function applyCheckoutLinks() {
    var target = '/checkout?product=' + encodeURIComponent(product.slug || '');
    document.querySelectorAll('.bb-cart, .bb-buy, a[href*="checkout"], button').forEach(function (link) {
      var text = (link.textContent || '').toLowerCase();
      var isCheckoutAction = link.classList.contains('bb-cart') || link.classList.contains('bb-buy') || (link.href || '').indexOf('checkout') !== -1 || text.indexOf('comprar') !== -1 || text.indexOf('carrinho') !== -1;
      if (!isCheckoutAction) return;
      if (link.tagName === 'A') link.setAttribute('href', target);
      link.addEventListener('click', function (event) {
        event.preventDefault();
        window.location.href = target;
      });
    });
  }
  function applyProduct() {
    document.title = product.name || document.title;
    text('.pi-title', product.name);
    text('.pb-amount', money(product.price));
    if (product.originalPrice) text('.pb-original', money(product.originalPrice));
    text('.pb-discount', fields.discountBadge || (product.originalPrice ? '-' + Math.max(0, Math.round((1 - Number(product.price || 0) / Number(product.originalPrice || 1)) * 100)) + '%' : ''));
    text('.pi-discount-chip', fields.discountChip || (product.originalPrice ? Math.max(0, Math.round((1 - Number(product.price || 0) / Number(product.originalPrice || 1)) * 100)) + '%' : ''));
    var savings = Number(product.discount || 0) + Number(product.coupon || 0);
    text('.pi-economize-left span:last-child', fields.savingsText || (savings ? 'Economize ' + money(savings) : 'Economize no pedido'));
    text('.pb-flash span', fields.flashLabel || 'Oferta Relampago');
    text('.pi-badge.maes', fields.campaignBadge || 'OFERTA ANTECIPADA DIA DAS MAES');
    text('#promoDate', fields.promoBadge || '🔥 PROMO 28.05');
    text('#shipDate', fields.shippingText || '');
    text('.pi-ship-tag', fields.shippingTag || '');
    text('.si-name', fields.storeName || '');
    text('.si-sold', fields.storeSold || '');
    text('.bb-cart', fields.cartText || '');
    text('.bb-buy', fields.buyText || '');
    polishButtons();
    if (fields.shippingFee) html('.pi-ship-fee', 'Taxa de envio: <span style="text-decoration:line-through">' + escapeHtml(fields.shippingFee) + '</span>');
    attr('.si-logo', 'src', fields.storeLogo || '');
    renderGallery();
    renderProtection();
    renderSpecs();
    renderDescription();
    renderComments();
    setVisible('.car', 'gallery');
    setVisible('.pb', 'priceBar');
    setVisible('.pi-economize', 'savings');
    setVisible('.pi-badges', 'badges');
    setVisible('.pi-ship', 'shipping');
    setVisible('.cp', 'protection');
    setVisible('.si', 'store');
    setVisible('.rv', 'comments');
    setVisible('.pd,.pd-terms', 'details');
    setVisible('.bb-cart', 'cartButton');
    applyCheckoutLinks();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyProduct);
  else applyProduct();
})();
</script>`;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `produto-${Date.now()}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pickFirst(obj, keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((acc, part) => acc && acc[part], obj);
    if (value) return value;
  }
  return '';
}

function gatewayErrorMessage(gatewayName, data, fallback) {
  const detailList = Array.isArray(data?.details)
    ? data.details.map(item => `${item.field || 'campo'}: ${item.message || item.code || 'invalido'}`).join('; ')
    : '';
  const raw = String(detailList || data?.message || data?.error || data?.errors?.[0]?.message || fallback || '').trim();
  if (/valid api credentials|invalid api|credentials|unauthorized|forbidden|token|api key/i.test(raw)) {
    return gatewayName + ' recusou a cobranca Pix porque as credenciais da API nao estao validas. Confira o token/chave em Admin > Gateways.';
  }
  return raw || (gatewayName + ' recusou a criacao do Pix.');
}

function toDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

async function nextOrderId() {
  const { data, error } = await supabase
    .from('orders')
    .select('order_id')
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw error;

  let nextNum = 1025;
  if (data && data.length > 0) {
    const match = String(data[0].order_id || '').match(/\d+/);
    if (match) nextNum = Number.parseInt(match[0], 10) + 1;
  }
  return `#KP-${nextNum}`;
}

async function createOrder({ name, product, amount, status = 'pending', details = {}, payment = {} }) {
  const nowIso = new Date().toISOString();
  const orderId = await nextOrderId();
  const row = {
    order_id: orderId,
    customer_name: name,
    product_name: product,
    date: nowIso,
    amount: formatCurrencyAmount(amount),
    status,
    customer_email: details.email || null,
    customer_phone: details.phone || null,
    customer_cpf: details.cpf || null,
    customer_address: details.address || null,
    traffic_source: details.trafficSource || null,
    payment_method: details.paymentMethod || null,
    payment_id: payment.id || null,
    pix_payload: payment.qrCode || null,
    pix_qr_code: payment.qrCodeBase64 || null,
    created_at: nowIso
  };

  const { data, error } = await supabase.from('orders').insert([row]).select().single();
  if (error) throw error;
  return formatOrder(data);
}

async function getActiveGateway() {
  const { data, error } = await supabase
    .from('payment_gateways')
    .select('*')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Nenhum gateway Pix ativo foi configurado.');
  if (!data.secret_key && data.id !== 'manualpix') {
    throw new Error(`Gateway ${data.display_name || data.id} sem token secreto configurado.`);
  }
  return data;
}

async function createGatewayPixPayment(gateway, payload) {
  if (gateway.id === 'manualpix') {
    throw new Error('Pix Manual nao gera cobranca real automaticamente. Ative um gateway com API.');
  }

  if (gateway.id === 'mercadopago') {
    const endpoint = gateway.api_url || 'https://api.mercadopago.com/v1/payments';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gateway.secret_key}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID()
      },
      body: JSON.stringify({
        transaction_amount: Number(payload.amount),
        description: payload.product,
        payment_method_id: 'pix',
        payer: {
          email: payload.details.email,
          first_name: String(payload.name).split(' ')[0],
          last_name: String(payload.name).split(' ').slice(1).join(' ') || String(payload.name).split(' ')[0],
          identification: {
            type: 'CPF',
            number: String(payload.details.cpf || '').replace(/\D/g, '')
          }
        },
        notification_url: gateway.webhook_url || undefined,
        external_reference: payload.orderReference
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || 'Mercado Pago recusou a criacao do Pix.');
    const transaction = data.point_of_interaction?.transaction_data || {};
    if (!transaction.qr_code) throw new Error('Mercado Pago nao retornou codigo Pix.');
    return {
      id: String(data.id || ''),
      qrCode: transaction.qr_code,
      qrCodeBase64: transaction.qr_code_base64 || '',
      ticketUrl: transaction.ticket_url || ''
    };
  }

  if (gateway.id === 'westpay') {
    const endpoint = gateway.api_url || 'https://api.gw.westpay.com.br/api/v1/transactions';
    const authToken = Buffer.from(`${gateway.secret_key}:${gateway.public_key}`).toString('base64');
    const amountInCents = toCents(payload.amount);
    const documentNumber = toDigits(payload.details.cpf);
    const shipping = payload.details.shipping || {};
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${authToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'KitPanelaShop/1.0 (+https://reallink-wine.vercel.app)'
      },
      body: JSON.stringify({
        amount: amountInCents,
        paymentMethod: 'pix',
        customer: {
          name: payload.name,
          email: payload.details.email,
          phone: toDigits(payload.details.phone),
          document: {
            number: documentNumber,
            type: documentNumber.length > 11 ? 'cnpj' : 'cpf'
          },
          externalRef: payload.orderReference
        },
        items: [
          {
            title: payload.product,
            unitPrice: amountInCents,
            quantity: 1,
            tangible: true,
            externalRef: payload.orderReference
          }
        ],
        shipping: {
          fee: 0,
          address: {
            street: shipping.street || 'Nao informado',
            streetNumber: shipping.number || 'S/N',
            complement: shipping.complement || '',
            zipCode: toDigits(shipping.cep),
            neighborhood: shipping.neighborhood || 'Nao informado',
            city: shipping.city || 'Nao informado',
            state: String(shipping.state || 'SP').toUpperCase().slice(0, 2),
            country: 'br'
          }
        },
        pix: {
          expiresInSeconds: 600
        },
        externalRef: payload.orderReference,
        postbackUrl: gateway.webhook_url || undefined,
        traceable: true
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(gatewayErrorMessage('WestPay', data, 'WestPay recusou a criacao do Pix.'));
    const transaction = data.transaction || data.data || data.payment || data;
    const qrCode = pickFirst(transaction, [
      'qrCode',
      'qr_code',
      'pix.qrCode',
      'pix.qr_code',
      'pix.qrcode',
      'pix.copyPaste',
      'pix.copiaECola',
      'pixCopiaECola',
      'copia_cola',
      'brcode',
      'payload',
      'emv'
    ]);
    const qrCodeBase64 = pickFirst(transaction, [
      'qrCodeBase64',
      'qr_code_base64',
      'qr_code_image',
      'pix.qrCodeBase64',
      'pix.qr_code_base64',
      'image_base64'
    ]);
    if (!qrCode) throw new Error('WestPay nao retornou codigo Pix.');
    return {
      id: String(transaction.id || transaction.transaction_id || data.id || ''),
      qrCode,
      qrCodeBase64,
      ticketUrl: transaction.payment_link || transaction.ticket_url || transaction.ticketUrl || ''
    };
  }

  if (!gateway.api_url) {
    throw new Error(`Gateway ${gateway.display_name || gateway.id} sem URL de API.`);
  }

  const response = await fetch(gateway.api_url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${gateway.secret_key}`,
      'Content-Type': 'application/json',
      ...(gateway.public_key ? { 'X-Public-Key': gateway.public_key } : {})
    },
    body: JSON.stringify({
      amount: Number(payload.amount),
      description: payload.product,
      externalReference: payload.orderReference,
      customer: {
        name: payload.name,
        email: payload.details.email,
        phone: payload.details.phone,
        cpf: payload.details.cpf,
        address: payload.details.address
      },
      webhookUrl: gateway.webhook_url || undefined
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `Gateway ${gateway.display_name || gateway.id} recusou a criacao do Pix.`);
  }

  const qrCode = pickFirst(data, [
    'qrCode',
    'qr_code',
    'pix.qrCode',
    'pix.qr_code',
    'pix.copyPaste',
    'pix.copiaECola',
    'pixCopiaECola',
    'copia_cola',
    'brcode',
    'payload'
  ]);
  const qrCodeBase64 = pickFirst(data, [
    'qrCodeBase64',
    'qr_code_base64',
    'pix.qrCodeBase64',
    'pix.qr_code_base64',
    'image_base64'
  ]);

  if (!qrCode) throw new Error(`Gateway ${gateway.display_name || gateway.id} nao retornou codigo Pix.`);
  return {
    id: String(data.id || data.paymentId || data.transactionId || ''),
    qrCode,
    qrCodeBase64,
    ticketUrl: data.ticketUrl || data.ticket_url || ''
  };
}

app.get('/api/orders', async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, orders: data.map(formatOrder) });
  } catch (e) {
    console.error('[DB] Error fetching orders:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const { name, product, amount, status, details } = req.body;
    if (!name || !product || amount === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required fields: name, product, amount.' });
    }
    const order = await createOrder({ name, product, amount, status: status || 'pending', details: details || {} });
    let tracking = null;
    if ((status || 'pending') === 'approved') {
      const { data: rawOrder, error: rawError } = await supabase
        .from('orders')
        .select('*')
        .eq('order_id', order.id)
        .maybeSingle();
      if (rawError) throw rawError;
      if (rawOrder) tracking = { tiktokPurchase: await sendTikTokPaidPurchase(rawOrder) };
    }
    res.json({ success: true, order, tracking });
  } catch (e) {
    console.error('[ORDER] Error creating order:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['approved', 'pending', 'declined'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status. Use: approved, pending, or declined.' });
    }

    const orderId = decodeURIComponent(id);
    const { data: currentOrder, error: currentError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!currentOrder) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('order_id', orderId)
      .select()
      .single();
    if (error) throw error;

    let tracking = null;
    if (status === 'approved' && currentOrder.status !== 'approved') {
      tracking = { tiktokPurchase: await sendTikTokPaidPurchase(data) };
    }

    res.json({ success: true, order: formatOrder(data), tracking });
  } catch (e) {
    console.error('[ORDER] Error updating status:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/checkout/pix', async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const { name, product, amount, details = {} } = req.body;
    if (!name || !product || amount === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required checkout fields.' });
    }

    const gateway = await getActiveGateway();
    const payment = await createGatewayPixPayment(gateway, {
      name,
      product,
      amount,
      details,
      orderReference: `KP-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    });
    const order = await createOrder({
      name,
      product,
      amount,
      status: 'pending',
      details: { ...details, paymentMethod: 'PIX' },
      payment
    });

    res.json({
      success: true,
      order,
      payment: {
        id: payment.id,
        gateway: sanitizeGateway(gateway),
        qrCode: payment.qrCode,
        qrCodeBase64: payment.qrCodeBase64,
        ticketUrl: payment.ticketUrl
      }
    });
  } catch (e) {
    console.error('[PIX] Error creating payment:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/gateways', async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const { data, error } = await supabase
      .from('payment_gateways')
      .select('*')
      .order('display_name', { ascending: true });
    if (error) throw error;
    res.json({ success: true, gateways: data.map(sanitizeGateway) });
  } catch (e) {
    console.error('[GATEWAY] Error fetching gateways:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/gateways/:id', async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const { id } = req.params;
    const { adminPassword, apiUrl, publicKey, secretKey, webhook, logoUrl, autoApprove, isActive } = req.body;
    if (adminPassword !== adminSavePassword) {
      return res.status(403).json({ success: false, error: 'Senha incorreta.' });
    }

    const update = {
      api_url: apiUrl || '',
      public_key: publicKey || '',
      webhook_url: webhook || '',
      logo_url: logoUrl || '',
      auto_approve: autoApprove !== false,
      updated_at: new Date().toISOString()
    };
    if (secretKey) update.secret_key = secretKey;

    if (isActive) {
      const { error: resetError } = await supabase
        .from('payment_gateways')
        .update({ is_active: false })
        .neq('id', id);
      if (resetError) throw resetError;
      update.is_active = true;
    }

    const { data, error } = await supabase
      .from('payment_gateways')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, gateway: sanitizeGateway(data) });
  } catch (e) {
    console.error('[GATEWAY] Error saving gateway:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    noStore(res);
    if (!requireDatabase(res)) return;
    const { data, error } = await supabase
      .from('product_pages')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, products: data.map(sanitizeProduct) });
  } catch (e) {
    console.error('[PRODUCT] Error fetching products:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    noStore(res);
    if (!requireDatabase(res)) return;
    const { adminPassword, name, price } = req.body;
    if (adminPassword !== adminSavePassword) {
      return res.status(403).json({ success: false, error: 'Senha incorreta.' });
    }
    if (!name || price === undefined) {
      return res.status(400).json({ success: false, error: 'Informe nome e preco do produto.' });
    }

    const { data, omittedColumns } = await saveProductRow('insert', productPayloadFromBody(req.body));
    res.json({ success: true, product: sanitizeProduct(data), omittedColumns });
  } catch (e) {
    console.error('[PRODUCT] Error creating product:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    noStore(res);
    if (!requireDatabase(res)) return;
    const { id } = req.params;
    const { adminPassword, name, price } = req.body;
    if (adminPassword !== adminSavePassword) {
      return res.status(403).json({ success: false, error: 'Senha incorreta.' });
    }
    if (!name || price === undefined) {
      return res.status(400).json({ success: false, error: 'Informe nome e preco do produto.' });
    }

    const { data, omittedColumns } = await saveProductRow('update', productPayloadFromBody(req.body), id);
    res.json({ success: true, product: sanitizeProduct(data), omittedColumns });
  } catch (e) {
    console.error('[PRODUCT] Error saving product:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/tracking-settings', async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const { data, error } = await supabase
      .from('tracking_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();
    if (error) throw error;
    res.json({ success: true, settings: data || {} });
  } catch (e) {
    console.error('[TRACKING] Error fetching settings:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.put('/api/tracking-settings', async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const { tiktokPixelId, tiktokAccessToken, facebookPixelId, googleAnalyticsId } = req.body;
    const { data, error } = await supabase
      .from('tracking_settings')
      .upsert({
        id: 'default',
        tiktok_pixel_id: tiktokPixelId || '',
        tiktok_access_token: tiktokAccessToken || '',
        facebook_pixel_id: facebookPixelId || '',
        google_analytics_id: googleAnalyticsId || '',
        updated_at: new Date().toISOString()
      })
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, settings: data });
  } catch (e) {
    console.error('[TRACKING] Error saving settings:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/funnel-events', async (req, res) => {
  try {
    if (!requireDatabase(res)) return;
    const event = await recordFunnelEvent(req, req.body || {});
    if (!event) return res.status(500).json({ success: false, error: 'Nao foi possivel registrar o evento do funil.' });
    res.json({ success: true });
  } catch (e) {
    console.error('[FUNNEL] Error saving event:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/funnel-events/summary', async (req, res) => {
  try {
    noStore(res);
    if (!requireDatabase(res)) return;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('funnel_events')
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(800);
    if (error) throw error;
    res.json({ success: true, summary: summarizeFunnelEvents(data || []) });
  } catch (e) {
    console.error('[FUNNEL] Error fetching summary:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

function buildTraps(authorizedDomain, cloakBotsDesktop) {
  const sig = crypto.createHash('md5').update(authorizedDomain + Date.now()).digest('hex').slice(0, 8);
  const b64domain = Buffer.from(authorizedDomain).toString('base64');
  let b64White = '';
  try {
    b64White = Buffer.from(fs.readFileSync(path.join(__dirname, 'white.html'), 'utf-8'), 'utf-8').toString('base64');
  } catch (err) {
    console.error('[SECURITY] Failed to read white.html:', err.message);
  }

  const injectHtml = `document.write("<plaintext style='display:none'>");setTimeout(function(){var html=decodeURIComponent(escape(atob("${b64White}")));document.open();document.write(html);document.close();},10);`;
  const traps = [
    `<script>/* t1-${sig} */(function(){var d=atob("${b64domain}"),h=location.hostname;if(h&&h!=="localhost"&&h!=="127.0.0.1"&&h.indexOf(d)===-1){${injectHtml}}})();</script>`,
    `<script>/* t2-${sig} */document.addEventListener("click",function(e){var d=atob("${b64domain}"),h=location.hostname;if(h&&h!=="localhost"&&h!=="127.0.0.1"&&h.indexOf(d)===-1){e.preventDefault();e.stopPropagation();${injectHtml}}},true);</script>`,
    `<script>/* t3-${sig} */setInterval(function(){var d=atob("${b64domain}"),h=location.hostname;if(h&&h!=="localhost"&&h!=="127.0.0.1"&&h.indexOf(d)===-1){${injectHtml}}},4000);</script>`
  ];

  if (cloakBotsDesktop && b64White) {
    traps.push(`<script>/* t4-${sig} */(function(){var ua=navigator.userAgent.toLowerCase(),bot=/bot|crawler|spider|robot|webdriver/i.test(ua)||navigator.webdriver,m=/android|iphone|ipad|mobile/i.test(ua);if(bot||!m){${injectHtml}}})();</script>`);
  }
  return traps;
}

function injectTrapsIntoFile(filePath, traps) {
  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(/<script>\/\* t[1-9]-[a-f0-9]{8} \*\/[\s\S]*?<\/script>/g, '');
  const bodyMatch = content.match(/<body[^>]*>/i);
  if (!bodyMatch) return false;
  const bodyIndex = content.indexOf(bodyMatch[0]) + bodyMatch[0].length;
  content = content.slice(0, bodyIndex) + `\n${traps.join('\n')}\n` + content.slice(bodyIndex);
  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
}

function stripSecurityTraps(content) {
  return String(content || '')
    .replace(/<script\b[^>]*>[\s\S]*?document\.write\("<plaintext[\s\S]*?<\/script>/gi, '')
    .replace(/<div\b[^>]*display\s*:\s*none!important[^>]*>[\s\S]*?document\.write\("<plaintext[\s\S]*?<\/div>/gi, '')
    .replace(/<script>\/\* t[0-9][\s\S]*?<\/script>/gi, '');
}

app.post('/api/security/inject', (req, res) => {
  try {
    const { authorizedDomain, cloakBotsDesktop } = req.body;
    if (!authorizedDomain) {
      return res.status(400).json({ success: false, error: 'Missing authorizedDomain.' });
    }
    const traps = buildTraps(authorizedDomain, cloakBotsDesktop);
    const checkoutOk = injectTrapsIntoFile(CHECKOUT_PATH, traps);
    const landingOk = injectTrapsIntoFile(LANDING_PATH, traps);
    if (!checkoutOk || !landingOk) {
      return res.status(500).json({ success: false, error: 'Falha ao injetar em um ou mais arquivos.' });
    }
    res.json({ success: true, filesUpdated: ['checkout.html', 'Kit Panela.html'], trapCount: traps.length });
  } catch (e) {
    console.error('[SECURITY] Injection error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

function isVercelBot(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  return ua.includes('vercel') || ua.includes('vercelbot');
}

app.get('/', (req, res) => {
  if (isVercelBot(req)) return res.sendFile(path.join(__dirname, 'white.html'));
  res.sendFile(LANDING_PATH);
});

app.get('/checkout', (req, res) => {
  if (isVercelBot(req)) return res.sendFile(path.join(__dirname, 'white.html'));
  res.sendFile(CHECKOUT_PATH);
});

app.get(['/checkout.html', '/produto/:slug/checkout.html'], (req, res) => {
  if (isVercelBot(req)) return res.sendFile(path.join(__dirname, 'white.html'));
  const product = req.params.slug || req.query.product || '';
  const suffix = product ? `?product=${encodeURIComponent(product)}` : '';
  res.redirect(302, `/checkout${suffix}`);
});

app.get('/api/product-template', (req, res) => {
  noStore(res);
  const html = stripSecurityTraps(fs.readFileSync(LANDING_PATH, 'utf-8'));
  res.type('html').send(html);
});

app.get('/produto/:slug', async (req, res, next) => {
  try {
    noStore(res);
    if (isVercelBot(req)) return res.sendFile(path.join(__dirname, 'white.html'));
    if (!supabase) return res.sendFile(LANDING_PATH);

    const { data, error } = await supabase
      .from('product_pages')
      .select('*')
      .eq('slug', req.params.slug)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).send('Produto nao encontrado.');

    supabase
      .from('product_pages')
      .update({ view_count: Number(data.view_count || 0) + 1 })
      .eq('id', data.id)
      .then(({ error: viewError }) => {
        if (viewError) console.error('[PRODUCT] Error updating views:', viewError.message);
      });
    recordFunnelEvent(req, {
      eventType: 'product_view',
      stage: 'product_view',
      productSlug: data.slug,
      productName: data.name,
      trafficSource: req.query.utm_source || req.query.source || ''
    });

    const product = sanitizeProduct(data);
    let html = fs.readFileSync(LANDING_PATH, 'utf-8');
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(product.name)}</title>`);
    html = html.replace(/<\/body>/i, buildProductRuntimeScript(product) + '\n</body>');
    return res.send(html);
  } catch (e) {
    if (res.headersSent) return next(e);
    console.error('[PRODUCT] Error rendering product page:', e.message);
    return res.status(500).send('Erro ao carregar produto.');
  }
});

app.get('/produto/:slug', async (req, res) => {
  try {
    if (isVercelBot(req)) return res.sendFile(path.join(__dirname, 'white.html'));
    if (!supabase) return res.sendFile(LANDING_PATH);

    const { data, error } = await supabase
      .from('product_pages')
      .select('*')
      .eq('slug', req.params.slug)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).send('Produto nao encontrado.');

    supabase
      .from('product_pages')
      .update({ view_count: Number(data.view_count || 0) + 1 })
      .eq('id', data.id)
      .then(({ error: viewError }) => {
        if (viewError) console.error('[PRODUCT] Error updating views:', viewError.message);
      });

    const product = sanitizeProduct(data);
    const productJson = JSON.stringify(product).replace(/</g, '\\u003c');
    let html = fs.readFileSync(LANDING_PATH, 'utf-8');
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(product.name)}</title>`);
    const script = `
<script>
window.__PRODUCT_PAGE__ = ${productJson};
(function () {
  var product = window.__PRODUCT_PAGE__;
  function money(value) {
    return 'R$ ' + Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function h(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }
  function replaceText(from, to) {
    if (!to) return;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      if (node.nodeValue && node.nodeValue.indexOf(from) !== -1) {
        node.nodeValue = node.nodeValue.split(from).join(to);
      }
    });
  }
  function applyProduct() {
    var gallery = Array.isArray(product.images) && product.images.length ? product.images : (product.imageUrl ? [product.imageUrl] : []);
    document.title = product.name || document.title;
    replaceText('Jogo de Panelas Antiaderente Cerâmica Mimo/Colinox Style 10 Ps', product.name);
    replaceText('Jogo de Panelas Antiaderente Ceramica Mimo/Colinox Style 10 Ps', product.name);
    replaceText('R$ 61,90', money(product.price));
    if (product.originalPrice) replaceText('R$ 199,00', money(product.originalPrice));
    if (product.description) {
      var desc = Array.from(document.querySelectorAll('p, span, div')).find(function (el) {
        return el.textContent && el.textContent.includes('Mimo/Colinox');
      });
      if (desc) desc.textContent = product.description;
    }
    if (gallery.length) {
      Array.from(document.querySelectorAll('img')).slice(0, gallery.length).forEach(function (img, index) {
        img.src = gallery[index];
      });
      var firstImg = document.querySelector('img');
      if (firstImg) firstImg.src = gallery[0];
    }
    if (Array.isArray(product.comments) && product.comments.length) {
      var comments = document.createElement('section');
      comments.style.cssText = 'background:#fff;margin:12px;border-radius:12px;padding:16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;';
      comments.innerHTML = '<h3 style="font-size:18px;margin:0 0 12px;color:#111;">Comentarios dos compradores</h3>' + product.comments.map(function (item) {
        var stars = '★★★★★'.slice(0, Number(item.rating || 5));
        return '<div style="border-top:1px solid #f1f1f1;padding:12px 0;">'
          + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">'
          + (item.avatar ? '<img src="' + item.avatar + '" style="width:34px;height:34px;border-radius:50%;object-fit:cover;">' : '<div style="width:34px;height:34px;border-radius:50%;background:#f1f5f9;"></div>')
          + '<div><strong style="font-size:14px;">' + h(item.name || 'Cliente') + '</strong><div style="font-size:12px;color:#f59e0b;">' + stars + '</div></div>'
          + '</div><p style="font-size:14px;line-height:1.45;color:#333;margin:0;">' + h(item.text || '') + '</p>'
          + (item.image ? '<img src="' + item.image + '" style="width:86px;height:86px;border-radius:8px;object-fit:cover;margin-top:8px;">' : '')
          + '</div>';
      }).join('');
      document.body.appendChild(comments);
    }
    document.querySelectorAll('a[href*="checkout"], button').forEach(function (el) {
      if ((el.textContent || '').toLowerCase().includes('comprar') || (el.href || '').includes('checkout')) {
        if (el.tagName === 'A') el.href = '/checkout?product=' + encodeURIComponent(product.slug);
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyProduct);
  else applyProduct();
})();
</script>`;
    html = html.replace(/<\/body>/i, script + '\n</body>');
    res.send(html);
  } catch (e) {
    console.error('[PRODUCT] Error rendering product page:', e.message);
    res.status(500).send('Erro ao carregar produto.');
  }
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.listen(PORT, () => {
  console.log(`Kit Panela Shop online on http://localhost:${PORT}`);
});

module.exports = app;
