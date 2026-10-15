import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // '/' is correct for a <user>.github.io site served from the domain root.
  // A project repo deployed to <user>.github.io/<repo>/ would need '/<repo>/'.
  base: '/',
  build: {
    // The airport dataset is a deliberate ~650kB lazy chunk; don't warn.
    chunkSizeWarningLimit: 700,
  },
})
