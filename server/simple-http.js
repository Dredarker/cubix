const http = require("http");

const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("200 OK");
  }

  res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("405 Method Not Allowed");
});

server.listen(PORT, () => {
  console.log(`HTTP server started on port ${PORT}`);
});
