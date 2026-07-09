import { Hono } from "hono";
import { publicRoutes } from "./routes/public";

const app = new Hono<{ Bindings: Env }>();

app.route("/", publicRoutes);

export default app;
