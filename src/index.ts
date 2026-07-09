import { Hono } from "hono";
import { rssRoutes } from "./routes/rss";
import { publicRoutes } from "./routes/public";

const app = new Hono<{ Bindings: Env }>();

app.route("/", rssRoutes);
app.route("/", publicRoutes);

export default app;
