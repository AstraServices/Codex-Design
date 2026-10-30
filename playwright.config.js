import {defineConfig} from '@playwright/test';
// GPU (ANGLE/D3D11) by default; CODEX_GPU=0 falls back to SwiftShader (CPU-heavy software WebGL).
const gpu=process.env.CODEX_GPU!=='0';
export default defineConfig({testDir:'./tests/browser',workers:1,timeout:60000,use:{baseURL:'http://127.0.0.1:4173',viewport:{width:1440,height:1000},launchOptions:{args:gpu?['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}},webServer:{command:'node server.mjs',url:'http://127.0.0.1:4173/api/health',reuseExistingServer:true}});
