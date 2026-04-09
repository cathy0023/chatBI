import { beforeAll, afterEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let originalDbInstance: unknown = null;

// Point to a temp DB for all tests
const TEST_DB_DIR = path.join(process.cwd(), 'data');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-chatbi.db');

beforeAll(() => {
  // Ensure test data dir exists
  if (!fs.existsSync(TEST_DB_DIR)) {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  // Remove any stale test DB
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

afterEach(() => {
  // Reset module-level singletons between tests
  // Each test file manages its own DB state
});

afterAll(() => {
  // Clean up test DB
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});
