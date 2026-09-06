#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const packageSource = fs.readFileSync(packagePath);
const hash = () => crypto.createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex');

function validateManifest() {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const requiredScripts = ['test', 'dist', 'dist:portable', 'dist:installer', 'release', 'publish'];
  if (pkg.build?.appId !== 'com.foxes.hockeyanalytics') throw new Error('Unexpected appId.');
  if (pkg.build?.productName !== 'Arctic Foxes Hockey Analytics') throw new Error('Unexpected build productName.');
  if (pkg.build?.nsis?.shortcutName !== 'Arctic Foxes Hockey Analytics') throw new Error('Unexpected NSIS shortcutName.');
  if (/\d/.test(pkg.build.productName) || /\d/.test(pkg.build.nsis.shortcutName)) {
    throw new Error('Product identity must not contain version numbers.');
  }
  for (const script of requiredScripts) {
    if (typeof pkg.scripts?.[script] !== 'string' || !pkg.scripts[script]) {
      throw new Error(`Required npm script is missing: ${script}`);
    }
  }
  if (!Array.isArray(pkg.build.files) || !pkg.build.files.length) throw new Error('Build file list is missing.');
  if (!Array.isArray(pkg.build.win?.target) || !pkg.build.win.target.includes('nsis')) {
    throw new Error('NSIS build target is missing.');
  }
}

validateManifest();
const beforeHash = hash();
const electronBuilderCli = require.resolve('electron-builder/cli.js');
const result = spawnSync(process.execPath, [electronBuilderCli, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  shell: false
});
if (result.error) throw result.error;
const afterHash = hash();
if (beforeHash !== afterHash) {
  fs.writeFileSync(packagePath, packageSource);
  throw new Error('electron-builder modified package.json; the original manifest was restored.');
}
validateManifest();
if (result.status !== 0) process.exit(result.status ?? 1);
