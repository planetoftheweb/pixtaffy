import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      build: {
        rollupOptions: {
          output: {
            // Do not pull Rollup's shared preload helper into whichever manual
            // vendor chunk first references it; that would make lazy exporters
            // appear as eager modulepreloads in the app shell.
            onlyExplicitManualChunks: true,
            manualChunks(id) {
              if (!id.includes('node_modules')) return undefined;
              // Firebase ships a tightly cyclic module graph (firebase/app <-> @firebase/util
              // <-> per-service packages). Splitting these into separate chunks reorders
              // their evaluation and triggers TDZ errors at runtime
              // ("Cannot access 'g' before initialization" in vendor-firebase-app),
              // so keep the entire firebase + @firebase namespace in one chunk.
              if (id.includes('/@firebase/') || id.includes('/firebase/')) return 'vendor-firebase';
              if (id.includes('/@google/genai/')) return 'vendor-ai';
              if (id.includes('/react/') || id.includes('/react-dom/')) return 'vendor-react';
              if (id.includes('/lucide-react/')) return 'vendor-icons';
              if (id.includes('/jszip/')) return 'vendor-zip';
              // PDF and PowerPoint generation are only reached from the
              // dynamically-imported document exporter. Keep their complete
              // dependency trees out of the eagerly-loaded shared vendor file.
              if (
                [
                  '/jspdf/',
                  '/@babel/runtime/',
                  '/canvg/',
                  '/core-js/',
                  '/css-line-break/',
                  '/dompurify/',
                  '/fast-png/',
                  '/fflate/',
                  '/html2canvas/',
                  '/iobuffer/',
                  '/pako/',
                  '/performance-now/',
                  '/raf/',
                  '/regenerator-runtime/',
                  '/rgbcolor/',
                  '/stackblur-canvas/',
                  '/svg-pathdata/',
                  '/text-segmentation/',
                  '/utrie/',
                ].some((packagePath) => id.includes(packagePath))
              ) return 'vendor-pdf';
              if (
                ['/pptxgenjs/', '/image-size/', '/https/', '/queue/'].some((packagePath) =>
                  id.includes(packagePath)
                )
              ) return 'vendor-pptx';
              // Keep mediabunny (MP4 export) in its own chunk so it loads only
              // when the Build Studio exporter is dynamically imported, instead
              // of being folded into the eagerly-loaded shared `vendor` chunk.
              if (id.includes('/mediabunny/')) return 'vendor-mediabunny';
              return 'vendor';
            },
          },
        },
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
