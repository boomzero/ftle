import { Hono } from "hono";
import { rssRoutes } from "./routes/rss";
import { seoFileRoutes } from "./routes/seo-files";
import { publicRoutes } from "./routes/public";

const app = new Hono<{ Bindings: Env }>();

app.route("/", rssRoutes);
app.route("/", seoFileRoutes);
app.route("/", publicRoutes);

export default app;
