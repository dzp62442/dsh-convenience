import { build } from 'esbuild';
await build({
  entryPoints: ['src/client.jsx'], outfile: 'dist/client.js',
  bundle: true, platform: 'browser', format: 'cjs', target: 'es2022',
  external: ['react'], jsx: 'transform', charset: 'utf8',
  banner: { js: 'window.__ModuleLoader__.load({id:"dsh-convenience",factory:require=>{var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' },
});
