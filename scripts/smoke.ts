import fetch from 'node-fetch';

async function run() {
  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    console.error('API_URL environment variable is required');
    process.exit(1);
  }

  console.log(`Checking ${apiUrl}health`);
  const res = await fetch(`${apiUrl}health`);
  if (!res.ok) {
    console.error(`Health check failed: ${res.status}`);
    process.exit(1);
  }

  const json = await res.json();
  console.log('Health check passed:', json);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
