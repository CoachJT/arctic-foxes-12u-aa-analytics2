// Test-only local server; no Electron bridge or installed season data is exposed.
const http=require('http'),fs=require('fs'),path=require('path');
http.createServer((req,res)=>{
 const files={'/':'index.html','/analytics.js':'analytics.js','/release-ui.js':'release-ui.js','/interface.css':'interface.css','/interface-model.js':'interface-model.js','/interface.js':'interface.js'};
 const file=files[req.url];if(!file){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(__dirname,'..',file)));
}).listen(31212,'127.0.0.1',()=>console.log('Test UI http://127.0.0.1:31212'));
