// Headless Chromium for the CLIs: real GPU (ANGLE/D3D11) when available, SwiftShader fallback.
// SwiftShader renders WebGL on the CPU, which is what pegged "Chrome headless shell" at 80–90% CPU.
import { chromium } from '@playwright/test';
export const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
export const SOFTWARE_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const isSoftware = r => /swiftshader|llvmpipe|software/i.test(r || '');
/** Launch headless Chromium; CODEX_GPU=0 forces software. Returns {browser, renderer, gpu}. */
export async function launchBrowser() {
  if (process.env.CODEX_GPU !== '0') {
    try {
      const browser = await chromium.launch({ headless: true, args: GPU_ARGS }), page = await browser.newPage();
      const renderer = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return null; const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); });
      await page.close();
      if (renderer && !isSoftware(renderer)) return { browser, renderer, gpu: true };
      await browser.close();
    } catch { /* fall back */ }
  }
  const browser = await chromium.launch({ headless: true, args: SOFTWARE_ARGS });
  return { browser, renderer: 'SwiftShader', gpu: false };
}
