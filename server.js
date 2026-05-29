/**
 * Kit Panela Shop — Backend Server
 * Node.js/Express API with JSON database, static file serving,
 * and real obfuscated anti-clone security trap injector.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// Configured dynamically from environment in production
const supabaseUrl = process.env.SUPABASE_URL || 'https://wmsndneicukvxsaiypyn.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indtc25kbmVpY3VrdnhzYWl5cHluIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDAwNjQ3NywiZXhwIjoyMDk1NTgyNDc3fQ.uhA--YbrHDBTMTIECacYPxrqnp4NIx-6n8WRZ4KYLZQ';
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
const PORT = process.env.PORT || 3000;
const isVercel = process.env.VERCEL === '1';
const DB_PATH = isVercel ? '/tmp/orders.json' : path.join(__dirname, 'orders.json');
const CHECKOUT_PATH = path.join(__dirname, 'checkout.html');
const LANDING_PATH = path.join(__dirname, 'Kit Panela.html');

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(__dirname));

// ─── API: GET /api/orders ──────────────────────────────────────────────────────
app.get('/api/orders', async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .order('date', { ascending: false });

    if (error) throw error;

    // Map DB fields to what frontend expects
    const mappedOrders = orders.map(o => ({
      id: o.order_id,
      name: o.customer_name,
      product: o.product_name,
      date: o.date,
      amount: parseFloat(o.amount),
      status: o.status
    }));

    res.json({ success: true, orders: mappedOrders });
  } catch (e) {
    console.error('[DB] Error fetching orders:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── API: POST /api/orders ─────────────────────────────────────────────────────
app.post('/api/orders', async (req, res) => {
  try {
    const { name, product, amount, status } = req.body;

    if (!name || !product || amount === undefined) {
      return res.status(400).json({ success: false, error: 'Missing required fields: name, product, amount.' });
    }

    // Generate ID logic (fetch last order)
    const { data: lastOrderData } = await supabase
      .from('orders')
      .select('order_id')
      .order('id', { ascending: false })
      .limit(1);
    
    let nextNum = 1025;
    if (lastOrderData && lastOrderData.length > 0) {
      const match = lastOrderData[0].order_id.match(/\d+/);
      if (match) nextNum = parseInt(match[0]) + 1;
    }
    const orderId = `#KP-${nextNum}`;

    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-BR') + ' - ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const newOrder = {
      order_id: orderId,
      customer_name: name,
      product_name: product,
      date: dateStr,
      amount: amount.toString(),
      status: status || 'pending'
    };

    const { error } = await supabase.from('orders').insert([newOrder]);
    if (error) throw error;

    console.log(`[ORDER] New order created: ${orderId} — ${name} — R$ ${amount}`);
    
    // Send back frontend format
    res.json({ 
      success: true, 
      order: {
        id: orderId,
        name: name,
        product: product,
        date: dateStr,
        amount: parseFloat(amount),
        status: status || 'pending'
      }
    });

  } catch (e) {
    console.error('[ORDER] Error creating order:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── API: PATCH /api/orders/:id/status ────────────────────────────────────────
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['approved', 'pending', 'declined'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status. Use: approved, pending, or declined.' });
    }

    const orderId = decodeURIComponent(id);
    const { data, error } = await supabase
      .from('orders')
      .update({ status: status })
      .eq('order_id', orderId)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }

    console.log(`[ORDER] Status updated: ${id} → ${status}`);
    
    res.json({ 
      success: true, 
      order: {
        id: data[0].order_id,
        name: data[0].customer_name,
        product: data[0].product_name,
        date: data[0].date,
        amount: parseFloat(data[0].amount),
        status: data[0].status
      }
    });

  } catch (e) {
    console.error('[ORDER] Error updating status:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Anti-Clone Trap Compiler ──────────────────────────────────────────────────

function buildTraps(authorizedDomain, cloakBotsDesktop) {
  const sig = crypto.createHash('md5').update(authorizedDomain + Date.now()).digest('hex').slice(0, 8);
  const domParts = authorizedDomain.split('.').map(p => `"${p}"`).join(',');
  const b64domain = Buffer.from(authorizedDomain).toString('base64');

  let b64White = "";
  try {
    const whiteHtml = fs.readFileSync(path.join(__dirname, 'white.html'), 'utf-8');
    b64White = Buffer.from(whiteHtml, 'utf-8').toString('base64');
  } catch (err) {
    console.error("[SECURITY] Failed to read white.html for traps:", err.message);
  }

  // Common injection snippet to replace HTML without mixing and preserving accents
  const injectHtml = `document.write("<plaintext style='display:none'>");setTimeout(function(){var html=decodeURIComponent(escape(atob("${b64White}")));document.open();document.write(html);document.close();},10);`;

  const traps = [
    // Trap 1 — Standard IIFE hostname guard
    `<script>/* t1-${sig} */(function(){var _h=window.location.hostname;var _w="${authorizedDomain}";if(_h&&_h.indexOf(_w)===-1&&_h!=="localhost"&&_h!=="127.0.0.1"){${injectHtml}}})();</script>`,

    // Trap 2 — Split-array domain check (evades grep for the full domain)
    `<script>/* t2-${sig} */(function(){try{var _p=[${domParts}];var _r=_p.join(".");var _c=location.hostname;if(_c&&_c!=="localhost"&&_c!=="127.0.0.1"&&_c.indexOf(_r)===-1){${injectHtml}}}catch(e){}})();</script>`,

    // Trap 3 — atob obfuscated domain check
    `<script>/* t3-${sig} */(function(){try{var _d=atob("${b64domain}");if(location.hostname&&location.hostname!=="localhost"&&location.hostname!=="127.0.0.1"&&location.hostname.indexOf(_d)===-1){${injectHtml}}}catch(e){}})();</script>`,

    // Trap 4 — top/self frame guard (prevents iframe wrapping)
    `<script>/* t4-${sig} */(function(){try{var _h=(window.top||window.self).location.hostname;var _w="${authorizedDomain}";if(_h&&_h!=="localhost"&&_h!=="127.0.0.1"&&_h.indexOf(_w)===-1){${injectHtml}}}catch(e){${injectHtml}}})();</script>`,

    // Trap 5 — Click event observer on purchase buttons
    `<script>/* t5-${sig} */document.addEventListener("DOMContentLoaded",function(){try{var _w="${authorizedDomain}";var _h=location.hostname;if(_h&&_h!=="localhost"&&_h!=="127.0.0.1"&&_h.indexOf(_w)===-1){document.querySelectorAll("button,a").forEach(function(el){el.addEventListener("click",function(e){e.preventDefault();e.stopPropagation();${injectHtml}});});}}catch(e){}});</script>`,

    // Trap 6 — Interval scanner (fires every 3-5 seconds at random)
    `<script>/* t6-${sig} */(function(){try{var _i=setInterval(function(){var _h=location.hostname;var _w="${authorizedDomain}";if(_h&&_h!=="localhost"&&_h!=="127.0.0.1"&&_h.indexOf(_w)===-1){clearInterval(_i);${injectHtml}}},3000+Math.floor(Math.random()*2000));}catch(e){}})();</script>`,

    // Trap 7 — Image onerror exploit
    `<div style="display:none!important;position:absolute;left:-9999px"><img src="data:image/png,invalid-${sig}" onerror="(function(){var h=location.hostname,w='${authorizedDomain}';if(h&&h!=='localhost'&&h!=='127.0.0.1'&&h.indexOf(w)===-1){${injectHtml}}})()"></div>`,

    // Trap 8 — Canonical link cross-reference
    `<script>/* t8-${sig} */document.addEventListener("DOMContentLoaded",function(){try{var _c=document.querySelector('link[rel="canonical"]');var _w="${authorizedDomain}";var _h=location.hostname;if(_h&&_h!=="localhost"&&_h!=="127.0.0.1"&&_h.indexOf(_w)===-1){${injectHtml}}}catch(e){}});</script>`
  ];

  if (cloakBotsDesktop && b64White) {
    const cloakScript = `<script>/* t9-cloak-${sig} */(function(){var ua=navigator.userAgent.toLowerCase();var isBot=/bot|googlebot|crawler|spider|robot|crawling/i.test(ua)||navigator.webdriver;var isMobile=/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);var isDesktop=!isMobile;if(isBot||isDesktop){${injectHtml}}})();</script>`;
    traps.push(cloakScript);
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
    const { authorizedDomain, cloakBotsDesktop } = req.body;

    if (!authorizedDomain) {
      return res.status(400).json({ success: false, error: 'Missing authorizedDomain.' });
    }

    const traps = buildTraps(authorizedDomain, cloakBotsDesktop);

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
