/**
 * Kit Panela Shop — Backend Server
 * Node.js/Express API with JSON database, static file serving,
 * and real obfuscated anti-clone security trap injector.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const isVercel = process.env.VERCEL === '1';
const DB_PATH = isVercel ? '/tmp/orders.json' : path.join(__dirname, 'orders.json');
const CHECKOUT_PATH = path.join(__dirname, 'checkout.html');
const LANDING_PATH = path.join(__dirname, 'Kit Panela.html');

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(__dirname));

// ─── Database Helpers ──────────────────────────────────────────────────────────

function loadOrders() {
  if (!fs.existsSync(DB_PATH)) {
    // Initialize with baseline seed orders
    const baseline = [
      {
        id: "#KP-1020",
        name: "Roberto Alencar de Lima",
        product: "Jogo Panelas Cerâmica 10 Peças (Preto Carbono)",
        date: "27/05/2026 - 15:10",
        amount: 61.90,
        status: "declined",
        details: { cpf: "123.456.789-00", email: "roberto@email.com", phone: "(11) 99999-0001", address: "Rua A, 10 - Centro, São Paulo / SP (CEP: 01310-100)", paymentMethod: "PIX" }
      },
      {
        id: "#KP-1021",
        name: "Mariana Dias Costa",
        product: "Jogo Panelas Cerâmica 10 Peças (Vermelho Cereja)",
        date: "27/05/2026 - 18:24",
        amount: 61.90,
        status: "approved",
        details: { cpf: "234.567.890-01", email: "mariana@email.com", phone: "(11) 99999-0002", address: "Rua B, 20 - Jardim, Rio de Janeiro / RJ (CEP: 22210-010)", paymentMethod: "PIX" }
      },
      {
        id: "#KP-1022",
        name: "Luiz Henrique Silva",
        product: "Jogo Panelas Cerâmica 10 Peças (Verde Esmeralda)",
        date: "28/05/2026 - 11:30",
        amount: 61.90,
        status: "pending",
        details: { cpf: "345.678.901-02", email: "luiz@email.com", phone: "(21) 99999-0003", address: "Av C, 30 - Vila, Belo Horizonte / MG (CEP: 30140-070)", paymentMethod: "PIX" }
      },
      {
        id: "#KP-1023",
        name: "Ana Paula de Souza",
        product: "Jogo Panelas Cerâmica 10 Peças (Preto Carbono)",
        date: "28/05/2026 - 12:15",
        amount: 61.90,
        status: "approved",
        details: { cpf: "456.789.012-03", email: "ana@email.com", phone: "(31) 99999-0004", address: "Rua D, 40 - Bairro, Curitiba / PR (CEP: 80010-020)", paymentMethod: "CARD" }
      },
      {
        id: "#KP-1024",
        name: "Samuel Ramos dos Santos",
        product: "Jogo Panelas Cerâmica 10 Peças (Vermelho Cereja)",
        date: "28/05/2026 - 13:42",
        amount: 61.90,
        status: "approved",
        details: { cpf: "567.890.123-04", email: "samuel@email.com", phone: "(41) 99999-0005", address: "Av E, 50 - Centro, Porto Alegre / RS (CEP: 90010-150)", paymentMethod: "PIX" }
      }
    ];
    fs.writeFileSync(DB_PATH, JSON.stringify(baseline, null, 2), 'utf-8');
    return baseline;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch (e) {
    console.error('[DB] Failed to parse orders.json:', e.message);
    return [];
  }
}

function saveOrders(orders) {
  fs.writeFileSync(DB_PATH, JSON.stringify(orders, null, 2), 'utf-8');
}

function generateNextId(orders) {
  if (orders.length === 0) return '#KP-1025';
  const lastOrder = orders[orders.length - 1];
  const match = lastOrder.id.match(/\d+/);
  const nextNum = match ? parseInt(match[0]) + 1 : 1025;
  return `#KP-${nextNum}`;
}

// ─── API: GET /api/orders ──────────────────────────────────────────────────────
app.get('/api/orders', (req, res) => {
  try {
    const orders = loadOrders();
    res.json({ success: true, orders });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── API: POST /api/orders ─────────────────────────────────────────────────────
app.post('/api/orders', (req, res) => {
  try {
    const { name, product, amount, status, details } = req.body;

    if (!name || !product || amount === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required fields: name, product, amount.' });
    }

    const orders = loadOrders();
    const orderId = generateNextId(orders);

    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR') + ' - ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const newOrder = {
      id: orderId,
      name,
      product,
      date: dateStr,
      amount: parseFloat(amount),
      status: status || 'pending',
      details: details || {}
    };

    orders.push(newOrder);
    saveOrders(orders);

    console.log(`[ORDER] New order created: ${orderId} — ${name} — R$ ${amount}`);
    res.json({ success: true, order: newOrder });

  } catch (e) {
    console.error('[ORDER] Error creating order:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── API: PATCH /api/orders/:id/status ────────────────────────────────────────
app.patch('/api/orders/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['approved', 'pending', 'declined'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status. Use: approved, pending, or declined.' });
    }

    const orders = loadOrders();
    const orderIndex = orders.findIndex(o => o.id === decodeURIComponent(id));

    if (orderIndex === -1) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    orders[orderIndex].status = status;
    saveOrders(orders);

    console.log(`[ORDER] Status updated: ${id} → ${status}`);
    res.json({ success: true, order: orders[orderIndex] });

  } catch (e) {
    console.error('[ORDER] Error updating status:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Anti-Clone Trap Compiler ──────────────────────────────────────────────────

function buildTraps(authorizedDomain, redirectTarget, cloakBotsDesktop) {
  // Generate a unique hash signature per injection to make traps unique
  const sig = crypto.createHash('md5').update(authorizedDomain + Date.now()).digest('hex').slice(0, 8);
  const domParts = authorizedDomain.split('.').map(p => `"${p}"`).join(',');

  // Obfuscate the redirect target as a Base64 string inside the trap
  const b64redirect = Buffer.from(redirectTarget).toString('base64');
  const b64domain = Buffer.from(authorizedDomain).toString('base64');

  const traps = [
    // Trap 1 — Standard IIFE hostname guard
    `<script>/* t1-${sig} */(function(){var _h=window.location.hostname;var _w="${authorizedDomain}";if(_h&&_h.indexOf(_w)===-1&&_h!=="localhost"&&_h!=="127.0.0.1"){window.location.replace("${redirectTarget}");}})();</script>`,

    // Trap 2 — Split-array domain check (evades grep for the full domain)
    `<script>/* t2-${sig} */(function(){try{var _p=[${domParts}];var _r=_p.join(".");var _c=location.hostname;if(_c&&_c!=="localhost"&&_c!=="127.0.0.1"&&_c.indexOf(_r)===-1){location.replace("${redirectTarget}");}}catch(e){}})();</script>`,

    // Trap 3 — atob obfuscated domain check
    `<script>/* t3-${sig} */(function(){try{var _d=atob("${b64domain}");var _t=atob("${b64redirect}");if(location.hostname&&location.hostname!=="localhost"&&location.hostname!=="127.0.0.1"&&location.hostname.indexOf(_d)===-1){location.replace(_t);}}catch(e){}})();</script>`,

    // Trap 4 — top/self frame guard (prevents iframe wrapping)
    `<script>/* t4-${sig} */(function(){try{var _h=(window.top||window.self).location.hostname;var _w="${authorizedDomain}";if(_h&&_h!=="localhost"&&_h!=="127.0.0.1"&&_h.indexOf(_w)===-1){(window.top||window.self).location.replace("${redirectTarget}");}}catch(e){window.location.replace("${redirectTarget}");}})();</script>`,

    // Trap 5 — Click event observer on purchase buttons
    `<script>/* t5-${sig} */document.addEventListener("DOMContentLoaded",function(){try{var _w="${authorizedDomain}";var _r="${redirectTarget}";var _h=location.hostname;if(_h&&_h!=="localhost"&&_h!=="127.0.0.1"&&_h.indexOf(_w)===-1){document.querySelectorAll("button,a").forEach(function(el){el.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();location.replace(_r);});});}}catch(e){}});</script>`,

    // Trap 6 — Interval scanner (fires every 3-5 seconds at random)
    `<script>/* t6-${sig} */(function(){try{var _i=setInterval(function(){var _h=location.hostname;var _w="${authorizedDomain}";if(_h&&_h!=="localhost"&&_h!=="127.0.0.1"&&_h.indexOf(_w)===-1){clearInterval(_i);location.replace("${redirectTarget}");}},3000+Math.floor(Math.random()*2000));}catch(e){}})();</script>`,

    // Trap 7 — Image onerror exploit
    `<div style="display:none!important;position:absolute;left:-9999px"><img src="data:image/png,invalid-${sig}" onerror="(function(){var h=location.hostname,w='${authorizedDomain}',r='${redirectTarget}';if(h&&h!=='localhost'&&h!=='127.0.0.1'&&h.indexOf(w)===-1)location.replace(r);})()"></div>`,

    // Trap 8 — Canonical link cross-reference
    `<script>/* t8-${sig} */document.addEventListener("DOMContentLoaded",function(){try{var _c=document.querySelector('link[rel="canonical"]');var _w="${authorizedDomain}";var _h=location.hostname;if(_h&&_h!=="localhost"&&_h!=="127.0.0.1"&&_h.indexOf(_w)===-1){location.replace("${redirectTarget}");}}catch(e){}});</script>`
  ];

  if (cloakBotsDesktop) {
    try {
      const whiteHtml = fs.readFileSync(path.join(__dirname, 'white.html'), 'utf-8');
      const b64White = Buffer.from(unescape(encodeURIComponent(whiteHtml))).toString('base64');
      const cloakScript = `<script>/* t9-cloak-${sig} */(function(){var ua=navigator.userAgent.toLowerCase();var isBot=/bot|googlebot|crawler|spider|robot|crawling/i.test(ua)||navigator.webdriver;var isMobile=/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);var isDesktop=!isMobile;if(isBot||isDesktop){var html=decodeURIComponent(escape(atob("${b64White}")));document.open();document.write(html);document.close();}})();</script>`;
      traps.push(cloakScript);
    } catch (err) {
      console.error("[SECURITY] Failed to read white.html for cloaking:", err.message);
    }
  }

  return traps;
}

function injectTrapsIntoFile(filePath, traps) {
  let content = fs.readFileSync(filePath, 'utf-8');

  // Remove previously injected traps (look for our comment signatures)
  content = content.replace(/<script>\/\* t[1-9](-cloak)?-[a-f0-9]{8} \*\/[\s\S]*?<\/script>/g, '');
  content = content.replace(/<div style="display:none!important;position:absolute;left:-9999px">[\s\S]*?<\/div>/g, '');

  // Find insertion points — after the opening <body> tag
  const bodyMatch = content.match(/<body[^>]*>/i);
  if (!bodyMatch) {
    console.error(`[SECURITY] Could not find <body> tag in: ${path.basename(filePath)}`);
    return false;
  }

  const bodyIndex = content.indexOf(bodyMatch[0]) + bodyMatch[0].length;

  // Interleave traps between div sections. Inject all 8 right after <body>
  // but also find 3 strategic div positions to spread them.
  const trapBlock = '\n' + traps.join('\n') + '\n';
  content = content.slice(0, bodyIndex) + trapBlock + content.slice(bodyIndex);

  fs.writeFileSync(filePath, content, 'utf-8');
  return true;
}

// ─── API: POST /api/security/inject ───────────────────────────────────────────
app.post('/api/security/inject', (req, res) => {
  try {
    const { authorizedDomain, redirectTarget, cloakBotsDesktop } = req.body;

    if (!authorizedDomain || !redirectTarget) {
      return res.status(400).json({ success: false, error: 'Missing authorizedDomain or redirectTarget.' });
    }

    const traps = buildTraps(authorizedDomain, redirectTarget, cloakBotsDesktop);

    const checkoutOk = injectTrapsIntoFile(CHECKOUT_PATH, traps);
    const landingOk = injectTrapsIntoFile(LANDING_PATH, traps);

    if (checkoutOk && landingOk) {
      console.log(`[SECURITY] Traps injected successfully for domain: ${authorizedDomain} (Cloaking: ${cloakBotsDesktop})`);
      res.json({
        success: true,
        message: `Armadilhas injetadas com sucesso para o domínio: ${authorizedDomain}`,
        filesUpdated: ['checkout.html', 'Kit Panela.html'],
        trapCount: traps.length
      });
    } else {
      res.status(500).json({ success: false, error: 'Falha ao injetar em um ou mais arquivos.' });
    }

  } catch (e) {
    console.error('[SECURITY] Injection error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── SPA Fallbacks ─────────────────────────────────────────────────────────────

function isVercelBot(req) {
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  return ua.includes('vercel') || ua.includes('vercelbot');
}

app.get('/', (req, res) => {
  if (isVercelBot(req)) {
    return res.sendFile(path.join(__dirname, 'white.html'));
  }
  res.sendFile(LANDING_PATH);
});

app.get('/checkout', (req, res) => {
  if (isVercelBot(req)) {
    return res.sendFile(path.join(__dirname, 'white.html'));
  }
  res.sendFile(CHECKOUT_PATH);
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// ─── Boot ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  // Ensure DB is initialized on startup
  loadOrders();
  console.log(`\n  ╔════════════════════════════════════════╗`);
  console.log(`  ║   Kit Panela Shop — Server Online       ║`);
  console.log(`  ║   http://localhost:${PORT}                  ║`);
  console.log(`  ╚════════════════════════════════════════╝\n`);
  console.log(`  → Storefront:  http://localhost:${PORT}/`);
  console.log(`  → Checkout:    http://localhost:${PORT}/checkout.html`);
  console.log(`  → Admin:       http://localhost:${PORT}/admin.html`);
  console.log(`  → Login:       http://localhost:${PORT}/login.html`);
  console.log(`  → Orders API:  http://localhost:${PORT}/api/orders\n`);
});

module.exports = app;
