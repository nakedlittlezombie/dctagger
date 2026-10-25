import { startServer } from "./packages/server";

startServer()
  .then(({ url }) => {
    console.log(`DCTagger UI + API listening on ${url}`);
    if (process.env.NODE_ENV !== "production") {
      console.log("Vite dev UI (optional): run `npm run dev` for hot reload on :5173");
    }
  })
  .catch((error) => {
    console.error("DCTagger failed to start:", error);
    process.exitCode = 1;
  });
