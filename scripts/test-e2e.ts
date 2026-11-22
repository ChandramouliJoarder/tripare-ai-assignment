import http, { IncomingMessage } from 'http';

const BASE_URL = 'http://localhost:3000';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  status?: number;
  dataSummary?: string;
}

const results: TestResult[] = [];

function request(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; json?: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      },
      (res: IncomingMessage) => {
        let data = '';
        res.on('data', (chunk: Buffer | string) => (data += chunk.toString()));
        res.on('end', () => {
          let json: any;
          try {
            json = JSON.parse(data);
          } catch {
            // non-json
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, body: data, json });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out after 15000ms'));
    });

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    results.push({ name, passed: false, error: err.message });
    console.log(`  [FAIL] ${name}: ${err.message}`);
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('  Running Automated End-to-End Feature Verification');
  console.log('======================================================\n');

  // 1. Static Frontend
  await runTest('1. Frontend serves index.html at GET /', async () => {
    const res = await request('GET', '/');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.body.includes('Hotel Finder')) throw new Error('index.html missing brand title');
    if (!res.body.includes('app.js')) throw new Error('index.html does not link app.js');
  });

  await runTest('2. Frontend serves styles.css at GET /styles.css', async () => {
    const res = await request('GET', '/styles.css');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.body.includes('--terracotta')) throw new Error('styles.css missing CSS variables');
  });

  await runTest('3. Frontend serves app.js at GET /app.js', async () => {
    const res = await request('GET', '/app.js');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!res.body.includes('fetchHotels')) throw new Error('app.js missing main fetch function');
  });

  // 2. Mock Supplier APIs
  await runTest('4. Mock Supplier A returns Delhi seed data', async () => {
    const res = await request('GET', '/supplierA/hotels?city=delhi');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!Array.isArray(res.json)) throw new Error('Expected array');
    const holtin = res.json.find((h: any) => h.name === 'Holtin');
    if (!holtin || holtin.price !== 6000) throw new Error('Holtin at 6000 not found in Supplier A');
  });

  await runTest('5. Mock Supplier B returns Delhi seed data', async () => {
    const res = await request('GET', '/supplierB/hotels?city=delhi');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!Array.isArray(res.json)) throw new Error('Expected array');
    const holtin = res.json.find((h: any) => h.name === 'Holtin');
    if (!holtin || holtin.price !== 5340) throw new Error('Holtin at 5340 not found in Supplier B');
  });

  await runTest('6. Mock suppliers return empty array for unknown city', async () => {
    const res = await request('GET', '/supplierA/hotels?city=unknown_city_123');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    if (!Array.isArray(res.json) || res.json.length !== 0) throw new Error('Expected empty array');
  });

  // 3. Comparison API
  await runTest('7. GET /api/hotels/compare returns both offers for Delhi', async () => {
    const res = await request('GET', '/api/hotels/compare?city=delhi');
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    const holtin = res.json.find((c: any) => c.displayName === 'Holtin');
    if (!holtin || !holtin.supplierA || !holtin.supplierB) {
      throw new Error('Holtin comparison missing Supplier A or B data');
    }
    if (holtin.supplierA.price !== 6000 || holtin.supplierB.price !== 5340) {
      throw new Error(`Unexpected prices for Holtin: A=${holtin.supplierA.price}, B=${holtin.supplierB.price}`);
    }
  });

  // 4. Admin Downtime Toggle & Simulation
  await runTest('8. POST /admin/supplier/a/toggle toggles outage state', async () => {
    // Toggle down
    let res = await request('POST', '/admin/supplier/a/toggle');
    if (res.status !== 200 || res.json.down !== true) throw new Error('Failed to toggle Supplier A down');

    // Supplier A should now return 503
    const suppRes = await request('GET', '/supplierA/hotels?city=delhi');
    if (suppRes.status !== 503) throw new Error(`Expected 503 from Supplier A, got ${suppRes.status}`);

    // Toggle back up
    res = await request('POST', '/admin/supplier/a/toggle');
    if (res.status !== 200 || res.json.down !== false) throw new Error('Failed to restore Supplier A');
  });

  await runTest('9. POST /admin/supplier/b/toggle toggles outage state', async () => {
    // Toggle down
    let res = await request('POST', '/admin/supplier/b/toggle');
    if (res.status !== 200 || res.json.down !== true) throw new Error('Failed to toggle Supplier B down');

    // Supplier B should now return 503
    const suppRes = await request('GET', '/supplierB/hotels?city=delhi');
    if (suppRes.status !== 503) throw new Error(`Expected 503 from Supplier B, got ${suppRes.status}`);

    // Toggle back up
    res = await request('POST', '/admin/supplier/b/toggle');
    if (res.status !== 200 || res.json.down !== false) throw new Error('Failed to restore Supplier B');
  });

  // 5. Health Check Endpoint
  await runTest('10. GET /health checks suppliers, redis, and temporal', async () => {
    const res = await request('GET', '/health');
    // Note: status is 200 if ok/degraded, 503 if down (if Redis/Temporal not started locally)
    if (![200, 503].includes(res.status)) throw new Error(`Unexpected status code: ${res.status}`);
    if (!res.json.suppliers || !res.json.status) throw new Error('Malformed health response structure');
    console.log(`     -> Live cluster health: status=${res.json.status}, redis=${res.json.redis}, temporal=${res.json.temporal}, suppliers=${JSON.stringify(res.json.suppliers)}`);
  });

  // 6. Validation on GET /api/hotels
  await runTest('11. GET /api/hotels rejects missing city with 400', async () => {
    const res = await request('GET', '/api/hotels');
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    if (res.json.code !== 'MISSING_CITY') throw new Error(`Expected MISSING_CITY, got ${res.json.code}`);
  });

  await runTest('12. GET /api/hotels rejects negative minPrice with 400', async () => {
    const res = await request('GET', '/api/hotels?city=delhi&minPrice=-100');
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    if (res.json.code !== 'INVALID_PRICE') throw new Error(`Expected INVALID_PRICE, got ${res.json.code}`);
  });

  await runTest('13. GET /api/hotels rejects invalid price range (min > max) with 400', async () => {
    const res = await request('GET', '/api/hotels?city=delhi&minPrice=9000&maxPrice=1000');
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    if (res.json.code !== 'INVALID_PRICE_RANGE') throw new Error(`Expected INVALID_PRICE_RANGE, got ${res.json.code}`);
  });

  console.log('\n======================================================');
  const passed = results.filter((r) => r.passed).length;
  console.log(`  Summary: ${passed}/${results.length} tests passed`);
  console.log('======================================================\n');
}

main().catch(console.error);
