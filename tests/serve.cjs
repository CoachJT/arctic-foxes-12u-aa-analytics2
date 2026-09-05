// Test-only local server; no Electron bridge or installed season data is exposed.
const http=require('http'),fs=require('fs'),path=require('path');
http.createServer((req,res)=>{
 const files={'/':'index.html','/toi-ui.js':'toi-ui.js','/toi-engine.js':'toi-engine.js','/crossing-detector.js':'crossing-detector.js','/toi.css':'toi.css','/analytics.js':'analytics.js','/release-ui.js':'release-ui.js','/interface.css':'interface.css','/interface-model.js':'interface-model.js','/interface.js':'interface.js'};
 for(const file of ['stats-import.js','stats-import-ui.js','vendor/xlsx.full.min.js'])files['/'+file]=file;
 files['/test']='index.html';files['/fixture-video.js']='tests/fixture-video.js';
 const file=files[req.url];if(!file){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');const content=fs.readFileSync(path.join(__dirname,'..',file));res.end(req.url==='/test'?content.toString().replace('</body>','<script src="fixture-video.js"></script></body>'):content);
}).listen(31212,'127.0.0.1',()=>console.log('Test UI http://127.0.0.1:31212'));
