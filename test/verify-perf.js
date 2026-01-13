import { startServer } from '../server.js';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

async function run() {
  console.log('Starting server for performance test...');
  // Force test env to avoid auto-start in server.js if it checks NODE_ENV
  process.env.NODE_ENV = 'test';
  const server = startServer(PORT, 'localhost');

  try {
    // Give it a moment to start
    await new Promise(r => setTimeout(r, 1000));

    console.log('--- Test Run 1 (Cold Cache) ---');
    const start1 = Date.now();
    const res1 = await fetch(`${BASE_URL}/api/recordings`);
    const end1 = Date.now();
    const data1 = await res1.json();
    const time1 = end1 - start1;
    console.log(`Response 1: ${res1.status} OK`);
    console.log(`Items count: ${data1.items?.length}`);
    console.log(`Time taken: ${time1}ms`);

    console.log('\n--- Test Run 2 (Warm Cache) ---');
    const start2 = Date.now();
    const res2 = await fetch(`${BASE_URL}/api/recordings`);
    const end2 = Date.now();
    const data2 = await res2.json();
    const time2 = end2 - start2;
    console.log(`Response 2: ${res2.status} OK`);
    console.log(`Items count: ${data2.items?.length}`);
    console.log(`Time taken: ${time2}ms`);

    if (time2 < time1) {
      console.log(`\nSUCCESS: Second run was faster by ${time1 - time2}ms`);
      if (time2 < 200) {
        console.log('Performance is excellent (<200ms).');
      }
    } else {
      console.log('\nWARNING: Second run was not faster.');
    }

  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    server.close();
    console.log('Server stopped.');
    process.exit(0);
  }
}

run();
