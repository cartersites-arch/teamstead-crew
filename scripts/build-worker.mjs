import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

// Pure local compilation. No Wrangler deployment command, account connection,
// analytics, upload, or remote validation runs here.
await mkdir('dist/worker', { recursive: true });
const result = await build({
  entryPoints: ['worker/index.ts'], outfile: 'dist/worker/index.js',
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'],
  external: ['cloudflare:workers', 'node:*'],
  plugins: [{name:'native-crypto',setup(builder){builder.onResolve({filter:/^crypto$/},()=>({path: decodeURIComponent(new URL('../lib/push-crypto-bridge.ts',import.meta.url).pathname).replace(/^\/([A-Za-z]:)/,'$1')}));}}],
  tsconfig: 'tsconfig.json', sourcemap: false, metafile: true,
  legalComments: 'eof', logLevel: 'warning',
});
const bytes = await readFile('dist/worker/index.js');
const report = { localCompilationOnly: true, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, inputModules: Object.keys(result.metafile.inputs).length, externalImports: [...new Set(Object.values(result.metafile.outputs).flatMap(output => output.imports.filter(entry => entry.external).map(entry => entry.path)))] };
await writeFile('dist/worker/build-report.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
