import { Hono } from "hono";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("ftle"));

export default app;
