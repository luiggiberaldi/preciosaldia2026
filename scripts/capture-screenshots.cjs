const { chromium } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4194;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const OUTPUT_DIR_LANDING_PUBLIC = path.join('C:', 'Users', 'luigg', 'Desktop', 'precios al dia final', 'pagina precios al dia', 'public');
const OUTPUT_DIR_LANDING_SCREENSHOTS = path.join(OUTPUT_DIR_LANDING_PUBLIC, 'screenshots');
const OUTPUT_DIR_BODEGA_SCREENSHOTS = path.join(__dirname, '..', 'screenshots');

[OUTPUT_DIR_LANDING_PUBLIC, OUTPUT_DIR_LANDING_SCREENSHOTS, OUTPUT_DIR_BODEGA_SCREENSHOTS].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function startServer(port = PORT) {
  const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json'
  };

  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/index.html';
    const filePath = path.join(DIST_DIR, reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      const indexPath = path.join(DIST_DIR, 'index.html');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(indexPath).pipe(res);
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`[Server] Corriendo en http://127.0.0.1:${port}`);
      resolve(server);
    });
  });
}

const DEMO_PRODUCTS = [
  { id: 'p1', name: 'Harina P.A.N. Blanca 1 Kg', barcode: '7591001000101', priceUsd: 1.30, priceUsdt: 1.30, costUsd: 1.05, stock: 48, category: 'Víveres', unit: 'paquete', isWeight: false },
  { id: 'p2', name: 'Arroz Mary Tradicional 1 Kg', barcode: '7591002000202', priceUsd: 1.45, priceUsdt: 1.45, costUsd: 1.15, stock: 36, category: 'Víveres', unit: 'paquete', isWeight: false },
  { id: 'p3', name: 'Pasta Primor Larga 1 Kg', barcode: '7591003000303', priceUsd: 1.60, priceUsdt: 1.60, costUsd: 1.25, stock: 24, category: 'Víveres', unit: 'paquete', isWeight: false },
  { id: 'p4', name: 'Aceite Diana Vegetal 1 Litro', barcode: '7591004000404', priceUsd: 2.80, priceUsdt: 2.80, costUsd: 2.30, stock: 18, category: 'Víveres', unit: 'unidad', isWeight: false },
  { id: 'p5', name: 'Mayonesa Mavesa 445g', barcode: '7591005000505', priceUsd: 2.40, priceUsdt: 2.40, costUsd: 1.95, stock: 15, category: 'Salsas', unit: 'frasco', isWeight: false },
  { id: 'p6', name: 'Margarina Mavesa 500g', barcode: '7591006000606', priceUsd: 1.90, priceUsdt: 1.90, costUsd: 1.50, stock: 30, category: 'Lácteos', unit: 'unidad', isWeight: false },
  { id: 'p7', name: 'Azúcar Montalbán 1 Kg', barcode: '7591007000707', priceUsd: 1.35, priceUsdt: 1.35, costUsd: 1.10, stock: 40, category: 'Víveres', unit: 'paquete', isWeight: false },
  { id: 'p8', name: 'Café Fama de América 250g', barcode: '7591008000808', priceUsd: 2.50, priceUsdt: 2.50, costUsd: 2.00, stock: 22, category: 'Café', unit: 'paquete', isWeight: false },
  { id: 'p9', name: 'Leche La Campiña 1 Kg', barcode: '7591009000909', priceUsd: 8.50, priceUsdt: 8.50, costUsd: 7.20, stock: 12, category: 'Lácteos', unit: 'bolsa', isWeight: false },
  { id: 'p10', name: 'Refresco Coca Cola 2 Litros', barcode: '7591010001010', priceUsd: 2.50, priceUsdt: 2.50, costUsd: 1.90, stock: 28, category: 'Bebidas', unit: 'botella', isWeight: false },
  { id: 'p11', name: 'Queso Blanco Llanero', barcode: '2000000000111', priceUsd: 5.50, priceUsdt: 5.50, costUsd: 4.20, stock: 15.5, category: 'Charcutería', unit: 'kg', isWeight: true },
  { id: 'p12', name: 'Jamón de Pierna Plumrose', barcode: '2000000000122', priceUsd: 7.80, priceUsdt: 7.80, costUsd: 6.10, stock: 10.2, category: 'Charcutería', unit: 'kg', isWeight: true }
];

const now = new Date();
const todayStr = now.toISOString().split('T')[0];

const DEMO_SALES = [
  {
    id: 'apertura-1',
    tipo: 'APERTURA_CAJA',
    timestamp: now.toISOString(),
    montoUsd: 50.00,
    montoBs: 2125.00,
    cajaCerrada: false
  },
  {
    id: 's1',
    saleNumber: 101,
    timestamp: now.toISOString(),
    date: now.toISOString(),
    totalUsd: 14.85,
    rate: 42.50,
    totalBs: 631.13,
    status: 'COMPLETADA',
    tipo: 'VENTA',
    paymentMethod: 'pago_movil',
    payments: [{ methodId: 'pago_movil', amountUsd: 14.85, amountBs: 631.13, currency: 'BS' }],
    items: [
      { id: 'p1', name: 'Harina P.A.N. Blanca 1 Kg', qty: 2, priceUsd: 1.30, costUsd: 1.05 },
      { id: 'p4', name: 'Aceite Diana Vegetal 1 Litro', qty: 1, priceUsd: 2.80, costUsd: 2.30 },
      { id: 'p9', name: 'Leche La Campiña 1 Kg', qty: 1, priceUsd: 8.50, costUsd: 7.20 }
    ]
  },
  {
    id: 's2',
    saleNumber: 102,
    timestamp: now.toISOString(),
    date: now.toISOString(),
    totalUsd: 9.60,
    rate: 42.50,
    totalBs: 408.00,
    status: 'COMPLETADA',
    tipo: 'VENTA',
    paymentMethod: 'efectivo_usd',
    payments: [{ methodId: 'efectivo_usd', amountUsd: 9.60, amountBs: 0, currency: 'USD' }],
    items: [
      { id: 'p10', name: 'Refresco Coca Cola 2 Litros', qty: 2, priceUsd: 2.50, costUsd: 1.90 },
      { id: 'p5', name: 'Mayonesa Mavesa 445g', qty: 1, priceUsd: 2.40, costUsd: 1.95 }
    ]
  }
];

async function saveToTargets(filename, buffer) {
  const target1 = path.join(OUTPUT_DIR_LANDING_PUBLIC, filename);
  const target2 = path.join(OUTPUT_DIR_LANDING_SCREENSHOTS, filename);
  const target3 = path.join(OUTPUT_DIR_BODEGA_SCREENSHOTS, filename);

  fs.writeFileSync(target1, buffer);
  fs.writeFileSync(target2, buffer);
  fs.writeFileSync(target3, buffer);
  console.log(`[Saved] ${filename} -> Guardado (${buffer.length} bytes)`);
}

async function captureAll() {
  const server = await startServer(PORT);
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: 'es-VE'
  });

  // Mock Supabase License RPC & Queries
  await context.route('**/rest/v1/rpc/get_license_status*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ type: 'permanent', is_active: true, expires_at: null, created_at: '2026-01-01' }])
    });
  });

  await context.route('**/rest/v1/licenses*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ type: 'permanent', is_active: true, expires_at: null, created_at: '2026-01-01' }])
    });
  });

  await context.route('**/rest/v1/rpc/auto_register_device*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });

  await context.addInitScript(({ products, sales, today }) => {
    localStorage.setItem('pda_terms_accepted', 'true');
    localStorage.setItem('business_name', 'Bodega Don José');
    localStorage.setItem('marketing_email', 'contacto@bodegadonjose.com');
    localStorage.setItem('pda_last_splash_date', today);
    localStorage.setItem('pda_onboarding_completed', 'true');
    localStorage.setItem('pda_welcome_dismissed', 'true');
    localStorage.setItem('bodega_products_v1', JSON.stringify(products));
    localStorage.setItem('bodega_sales_v1', JSON.stringify(sales));
    localStorage.setItem('theme', 'light');
    localStorage.setItem('cashea_enabled', 'true');
    localStorage.setItem('pda_custom_rate', '42.50');
    localStorage.setItem('pda_rate_mode', 'bcv');
    localStorage.setItem('allow_cash_advance', 'true');
    localStorage.setItem('abasto-device-session', JSON.stringify({
      id: 'u1',
      nombre: 'Admin / Dueño',
      rol: 'ADMIN'
    }));
    localStorage.setItem('abasto-auth-storage', JSON.stringify({
      state: {
        usuarioActivo: { id: 'u1', nombre: 'Admin / Dueño', rol: 'ADMIN', pin: '1234' },
        requireLogin: false,
        usuarios: [
          { id: 'u1', nombre: 'Admin / Dueño', rol: 'ADMIN', pin: '1234' },
          { id: 'u2', nombre: 'Cajero 1', rol: 'CAJERO', pin: '0000' }
        ]
      },
      version: 0
    }));
  }, { products: DEMO_PRODUCTS, sales: DEMO_SALES, today: todayStr });

  const page = await context.newPage();

  async function cleanAllOverlays() {
    await page.evaluate(() => {
      document.querySelectorAll('.fixed').forEach(el => {
        const text = el.innerText || '';
        if (
          text.includes('Términos y Condiciones') || 
          text.includes('Acepto los Términos') || 
          text.includes('Cargando Precios Al Día') || 
          text.includes('Buscar acciones, productos o clientes') ||
          el.getAttribute('role') === 'status'
        ) {
          el.remove();
        }
      });
    });
  }

  // 1. Dashboard
  console.log('\n--- 1. Capturando Dashboard (dashboard.png) ---');
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await cleanAllOverlays();
  const dashBuf = await page.screenshot({ fullPage: false });
  await saveToTargets('dashboard.png', dashBuf);

  // 2. Inventario
  console.log('\n--- 2. Capturando Inventario / Catálogo (inventory.png) ---');
  await page.evaluate(() => {
    const tab = document.querySelector('[data-tour="tab-catalogo"]') || Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Inventario'));
    if (tab) tab.click();
  });
  await page.waitForTimeout(1500);
  await cleanAllOverlays();
  const invBuf = await page.screenshot({ fullPage: false });
  await saveToTargets('inventory.png', invBuf);

  // 3. POS con Carrito Lleno
  console.log('\n--- 3. Capturando Punto de Venta con Carrito (pos.png) ---');
  await page.evaluate(() => {
    const tab = document.querySelector('[data-tour="tab-ventas"]') || Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Vender'));
    if (tab) tab.click();
  });
  await page.waitForTimeout(1000);
  await cleanAllOverlays();

  // Click en 2 productos para agregarlos al carrito
  await page.evaluate(() => {
    const productCards = Array.from(document.querySelectorAll('div, button')).filter(el => 
      el.innerText && (el.innerText.includes('Harina P.A.N.') || el.innerText.includes('Aceite Diana') || el.innerText.includes('Refresco Coca'))
    );
    if (productCards[0]) productCards[0].click();
    if (productCards[0]) productCards[0].click();
    if (productCards[1]) productCards[1].click();
  });
  await page.waitForTimeout(1000);
  await cleanAllOverlays();
  const posBuf = await page.screenshot({ fullPage: false });
  await saveToTargets('pos.png', posBuf);

  // 4. Checkout Modal
  console.log('\n--- 4. Capturando Modal de Cobro / Checkout (checkout.png) ---');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('COBRAR') || b.innerText.includes('Cobrar'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);
  const checkBuf = await page.screenshot({ fullPage: false });
  await saveToTargets('checkout.png', checkBuf);

  // 5. Reportes
  console.log('\n--- 5. Capturando Reportes y Cierres (reports.png) ---');
  await page.evaluate(() => {
    const checkoutModal = document.querySelector('.fixed.z-\\[100\\]') || document.querySelector('.fixed.z-\\[50\\]');
    if (checkoutModal) checkoutModal.remove();
    const tab = document.querySelector('[data-tour="tab-reportes"]') || Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reportes'));
    if (tab) tab.click();
  });
  await page.waitForTimeout(1500);
  await cleanAllOverlays();
  const repBuf = await page.screenshot({ fullPage: false });
  await saveToTargets('reports.png', repBuf);

  // 6. Login / Control de Acceso
  console.log('\n--- 6. Capturando Login / Control de Acceso (login.png) ---');
  await page.evaluate(() => {
    localStorage.removeItem('abasto-device-session');
    localStorage.setItem('pda_welcome_dismissed', 'true');
    localStorage.setItem('abasto-auth-storage', JSON.stringify({
      state: {
        usuarioActivo: null,
        requireLogin: true,
        usuarios: [
          { id: 'u1', nombre: 'Admin / Dueño', rol: 'ADMIN', pin: '1234' },
          { id: 'u2', nombre: 'Cajero Principal', rol: 'CAJERO', pin: '0000' }
        ]
      },
      version: 0
    }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await cleanAllOverlays();
  const loginBuf = await page.screenshot({ fullPage: false });
  await saveToTargets('login.png', loginBuf);

  await browser.close();
  server.close();
  console.log('\n✅ ¡TODAS las 6 capturas fueron completadas con éxito!');
}

captureAll().catch(err => {
  console.error('Error durante la captura:', err);
  process.exit(1);
});
