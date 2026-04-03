import { seedData } from '../src/lib/db/seed';

const filePath = process.argv[2];
const count = seedData(filePath);
console.log(`Imported ${count} records.`);
