import { readFile, writeFile } from 'node:fs/promises';
import { compileBible, renderGeneratedModule } from './_bible-compiler.mjs';

const sourceFile = new URL('../THONGTHAI_BRAIN.md', import.meta.url);
const outFile = new URL('../netlify/functions/_thongthai-bible-generated.ts', import.meta.url);

const markdown = await readFile(sourceFile, 'utf8');
const compiled = compileBible(markdown);
const generated = renderGeneratedModule(compiled);

await writeFile(outFile, generated, 'utf8');
console.log(`BIBLE_COMPILED version=${compiled.version}`);
