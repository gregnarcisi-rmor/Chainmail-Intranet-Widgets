const http = require('http');

http.get('http://127.0.0.1:9222/json', (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    console.log("RESPONSE:", data);
  });
}).on('error', (err) => {
  console.error("ERROR:", err.message);
});
