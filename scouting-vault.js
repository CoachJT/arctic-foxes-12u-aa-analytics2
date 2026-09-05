(function(root){
'use strict';
const cryptoApi=globalThis.crypto||(typeof require==='function'?require('node:crypto').webcrypto:null);
const encode=b=>{if(typeof Buffer!=='undefined')return Buffer.from(b).toString('base64');const bytes=new Uint8Array(b);let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);};
const decode=s=>typeof Buffer!=='undefined'?new Uint8Array(Buffer.from(s,'base64')):Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function derive(password,salt){const input=await cryptoApi.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return cryptoApi.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},input,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function seal(data,key,salt){const iv=cryptoApi.getRandomValues(new Uint8Array(12));const encrypted=await cryptoApi.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('FoxesScoutingVault1')},key,new TextEncoder().encode(JSON.stringify(data)));return {version:1,kdf:'PBKDF2-SHA256',iterations:600000,salt:encode(salt),iv:encode(iv),ciphertext:encode(encrypted)};}
async function create(password,data){if(String(password).length<10)throw Error('Use at least 10 characters.');const salt=cryptoApi.getRandomValues(new Uint8Array(16)),key=await derive(password,salt);return {key,salt,blob:await seal(data,key,salt)};}
async function open(password,blob){if(blob.version!==1||blob.iterations!==600000||blob.kdf!=='PBKDF2-SHA256')throw Error('Unsupported scouting file.');const salt=decode(blob.salt),key=await derive(password,salt);const raw=await cryptoApi.subtle.decrypt({name:'AES-GCM',iv:decode(blob.iv),additionalData:new TextEncoder().encode('FoxesScoutingVault1')},key,decode(blob.ciphertext));return {key,salt,data:JSON.parse(new TextDecoder().decode(raw))};}
const api={create,open,seal};if(typeof module==='object'&&module.exports)module.exports=api;else root.FoxesScoutingVault=api;
})(globalThis);
