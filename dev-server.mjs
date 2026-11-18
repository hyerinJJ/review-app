// 내 컴퓨터에서 미리 확인할 때만 쓰는 서버예요. Vercel에 올릴 때는 필요 없어요.
// 실행: (PowerShell) $env:ANTHROPIC_API_KEY="sk-ant-..."; node dev-server.mjs  →  http://localhost:3000
import http from "node:http";
import { readFile } from "node:fs/promises";
import handler from "./api/ai.js";

http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/ai")) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    req.body = raw ? JSON.parse(raw) : {};
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(obj)); };
    return handler(req, res);
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(await readFile(new URL("./index.html", import.meta.url)));
}).listen(3000, () => console.log("http://localhost:3000"));
