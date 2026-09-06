#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('Usage: node scripts/update-version.cjs <semver>');
}

const packagePath = path.join(__dirname, '..', 'package.json');
const source = fs.readFileSync(packagePath, 'utf8');
const versionPattern = /^(\s*"version"\s*:\s*")[^"]+("\s*,?)/m;
const match = source.match(versionPattern);
if (!match) throw new Error('Could not find the package version field.');

const updated = source.replace(versionPattern, `$1${version}$2`);
if (updated === source) throw new Error(`package.json is already version ${version}.`);
fs.writeFileSync(packagePath, updated, 'utf8');
