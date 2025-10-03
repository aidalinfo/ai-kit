import { defineConfig } from "astro/config";

export default defineConfig({
  vite: {
    build: {
      rollupOptions: {
        external: ["sharp"],
      },
    },
    ssr: {
      external: ["sharp"],
    },
  },
  image: {
    service: {
      entrypoint: "astro/assets/services/squoosh",
    },
  },
});
