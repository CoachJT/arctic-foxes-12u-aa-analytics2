// Test-only local server; no Electron bridge or installed season data is exposed.
const http=require('http'),fs=require('fs'),path=require('path');
http.createServer((req,res)=>{
 const files={'/':'index.html','/analytics.js':'analytics.js','/release-ui.js':'release-ui.js'};
 const file=files[req.url];if(!file){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(__dirname,'..',file)));
}).listen(31212,'127.0.0.1',()=>console.log('Test UI http://127.0.0.1:31212'));
