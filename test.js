const fetch = require('node-fetch');
async function run() {
  const res = await fetch("https://y05rlxj2c1.execute-api.us-east-1.amazonaws.com/prod/cases", { method: 'POST', body: '{}' });
  console.log(res.status);
  console.log(await res.text());
}
run();
