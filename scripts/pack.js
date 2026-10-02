import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('--- SPROCKET EXTENSION VERIFICATION & PACKAGING ---');

// 1. Read manifest.json
const manifestPath = path.join(rootDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('❌ Missing manifest.json');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
console.log(`✓ Manifest valid: ${manifest.name} (v${manifest.version})`);

// 2. Verify all referenced files exist
const filesToCheck = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  ...Object.values(manifest.icons || {}),
  'src/content/content.js',
  'src/content/selector.js',
  'src/viewer/viewer.html',
  'src/viewer/viewer.js',
  'src/viewer/viewer.css',
  'src/popup/popup.js',
  'src/popup/popup.css',
  'src/utils/format.js',
  'src/utils/stitch.js',
  'src/utils/audio.js'
].filter(Boolean);

let missingCount = 0;
for (const file of filesToCheck) {
  const fullPath = path.join(rootDir, file);
  if (fs.existsSync(fullPath)) {
    const stats = fs.statSync(fullPath);
    console.log(`  ✓ ${file.padEnd(35)} (${stats.size} bytes)`);
  } else {
    console.error(`  ❌ Missing: ${file}`);
    missingCount++;
  }
}

if (missingCount > 0) {
  console.error(`Verification failed with ${missingCount} missing files.`);
  process.exit(1);
}

// 3. Create dist bundle
const distDir = path.join(rootDir, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const zipName = `sprocket-v${manifest.version}.zip`;
const zipPath = path.join(distDir, zipName);

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

const zipCmd = `zip -r "${zipPath}" manifest.json icons src -x "*.DS_Store*"`;
execSync(zipCmd, { cwd: rootDir, stdio: 'pipe' });

const zipStats = fs.statSync(zipPath);
console.log(`✓ Extension package built successfully: ${zipPath} (${zipStats.size} bytes)`);
console.log('✓ All checks passed.');
