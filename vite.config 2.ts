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
