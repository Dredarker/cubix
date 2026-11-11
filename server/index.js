const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const {v4: uuidv4} = require("uuid");
const {config} = require("./config.js");
const CubixGameEngine = require("../shared/game-engine.js");


const PORT = process.env.PORT || 3000;
const fps = 60;
const frameMs = 1000 / fps;

const bannedIps = new Set([]);
const clients = new Map();
const game = new CubixGameEngine(config);
const objects = game.objects;
const bodyToObject = game.bodyToObject;
const engine = game.engine;
const gravity = config.game.gravity;
const Matter = require("matter-js");
const { Engine, Bodies, Body, World, Events } = Matter;

// Keep the classic server's console API available after moving the engine.
function Obj(...args) { return game.createObj(...args); }
function Text(text, textColor, obj) { return game.createText(text, textColor, obj); }
function Player(nickname, speed, jumpPower, obj) {
  return game.createPlayer(nickname, speed, jumpPower, obj);
}
function createObject(id, obj) { return game.createObject(id, obj); }
function removeObject(id) { return game.removeObject(id); }
function addBody(id, obj) { return game.addBody(id, obj); }
function syncObjectFromBody(obj) { return game.syncObjectFromBody(obj); }
function createNPC(name, x, y, color = {}) { return game.createNPC(name, x, y, color); }
function createBullet(x, y, vx, vy, options) {
  return game.createBullet(x, y, vx, vy, options);
}
function updatePhysics() { return game.updatePhysics(); }
function updateNPCs() { return game.updateNPCs(); }
function updateGroundState() { return game.updateGroundState(); }
function distanceBetween(x1, y1, x2, y2) {
  return game.distanceBetween(x1, y1, x2, y2);
}
function posInObj(x, y, obj) { return game.posInObj(x, y, obj); }
function findNearestPlayer(npc) { return game.findNearestPlayer(npc); }

const info = {isCubixServer: true, playersOnline: 0, maxPlayersCount: config.maxPlayersCount, name: config.name};
let HTMLclient = "No client";
fetch("https://raw.githubusercontent.com/Dredarker/cubix/refs/heads/main/client/index.html").then(r => r.text()).then(t => HTMLclient = t).catch(e => console.error("Error to load client:", e));

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.url.startsWith("/client/")) {
    const filePath = path.join(__dirname, "..", req.url.split("?")[0]);
    const contentTypes = { ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".wav": "audio/wav", ".mp3": "audio/mpeg" };
    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-cache" });
      return res.end(data);
    } catch (error) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
  }
  if (req.url === "/") {
    const gameConfig = {
      allowPlayerOutfit: config.allowPlayerOutfit,
      game: config.game,
      player: config.player,
      timeout: config.timeout,
    };
    const html = HTMLclient.replace(
      "</body>",
      "<script>window.CUBIX_GAME_CONFIG = " + JSON.stringify(gameConfig) + ";</script></body>"
    );
    res.writeHead(200, {"Content-Type": "text/html"});
    return res.end(html);
  }
  if (req.url === "/console") { res.writeHead(200, {"Content-Type": "text/html"}); return res.end(HTMLconsoleClient); }
  if (req.url === "/healthz") { res.writeHead(200, {"Content-Type": "text/plain"}); return res.end("200 OK"); }
  if (req.url === "/ping") { res.writeHead(200, {"Content-Type": "application/json"}); return res.end(JSON.stringify(info)); }
  res.writeHead(404); res.end();
});
const wss = new WebSocket.Server({server});
console.log(`WebSocket server started on port ${PORT}`);
const badwords = [];

const p2pRooms = new Map();
const p2pSubscribers = new Set();

function sendP2P(ws, payload) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "p2p", ...payload }));
  }
}

function getP2PRoomList() {
  return [...p2pRooms.values()].map(room => ({
    id: room.id,
    name: room.name,
    description: room.description,
    maxPlayers: room.maxPlayers,
    playersOnline: 1 + room.peers.size,
  }));
}

function broadcastP2PRoomList() {
  const rooms = getP2PRoomList();
  for (const subscriber of p2pSubscribers) {
    sendP2P(subscriber, { action: "rooms", rooms });
  }
}

function removeP2PPeer(room, peerId, notify = true) {
  const peer = room?.peers.get(peerId);
  if (!peer) return;

  room.peers.delete(peerId);
  peer.p2pRole = null;
  peer.p2pRoomId = null;
  peer.p2pPeerId = null;

  if (notify) {
    sendP2P(room.host, { action: "peer-left", peerId });
  }
  broadcastP2PRoomList();
}

function unregisterP2PRoom(ws) {
  const roomId = ws.p2pRoomId;
  const room = roomId && p2pRooms.get(roomId);
  if (!room || room.host !== ws) return;

  p2pRooms.delete(roomId);
  for (const [peerId, peer] of room.peers) {
    sendP2P(peer, { action: "room-closed", roomId });
    peer.p2pRole = null;
    peer.p2pRoomId = null;
    peer.p2pPeerId = null;
  }

  ws.p2pRole = null;
  ws.p2pRoomId = null;
  broadcastP2PRoomList();
}

function cleanupP2PConnection(ws) {
  p2pSubscribers.delete(ws);
  if (ws.p2pRole === "host") {
    unregisterP2PRoom(ws);
  } else if (ws.p2pRole === "guest") {
    const room = p2pRooms.get(ws.p2pRoomId);
    removeP2PPeer(room, ws.p2pPeerId);
  }
}

function handleP2PMessage(ws, data) {
  p2pSubscribers.add(ws);
  const action = data.action;

  if (action === "list") {
    sendP2P(ws, { action: "rooms", rooms: getP2PRoomList() });
    return;
  }

  if (action === "register") {
    unregisterP2PRoom(ws);

    const input = data.room || {};
    const name = String(input.name || "").trim().slice(0, 40);
    const description = String(input.description || "").trim().slice(0, 180);
    const maxPlayers = Math.max(2, Math.min(16, Number(input.maxPlayers) || 2));

    if (!name) {
      sendP2P(ws, { action: "error", message: "Room name is required." });
      return;
    }

    const id = "room_" + Math.random().toString(36).slice(2, 12);
    const room = { id, name, description, maxPlayers, host: ws, peers: new Map() };
    p2pRooms.set(id, room);
    ws.p2pRole = "host";
    ws.p2pRoomId = id;

    sendP2P(ws, { action: "registered", room: getP2PRoomList().find(item => item.id === id) });
    broadcastP2PRoomList();
    return;
  }

  if (action === "unregister") {
    unregisterP2PRoom(ws);
    return;
  }

  if (action === "join") {
    const room = p2pRooms.get(String(data.roomId || ""));
    if (!room) {
      sendP2P(ws, { action: "error", message: "Room is no longer available." });
      return;
    }
    if (1 + room.peers.size >= room.maxPlayers) {
      sendP2P(ws, { action: "error", message: "Room is full." });
      return;
    }

    const peerId = "peer_" + Math.random().toString(36).slice(2, 12);
    room.peers.set(peerId, ws);
    ws.p2pRole = "guest";
    ws.p2pRoomId = room.id;
    ws.p2pPeerId = peerId;

    sendP2P(ws, { action: "joined", roomId: room.id, peerId });
    sendP2P(room.host, { action: "peer-join", peerId });
    broadcastP2PRoomList();
    return;
  }

  if (action === "signal") {
    const room = p2pRooms.get(ws.p2pRoomId);
    if (!room) return;

    if (ws.p2pRole === "host") {
      const peer = room.peers.get(String(data.peerId || ""));
      if (peer) {
        sendP2P(peer, {
          action: "signal",
          peerId: data.peerId,
          signal: data.signal,
        });
      }
    } else if (ws.p2pRole === "guest") {
      sendP2P(room.host, {
        action: "signal",
        peerId: ws.p2pPeerId,
        signal: data.signal,
      });
    }
    return;
  }

  if (action === "leave" || action === "peer-left") {
    if (ws.p2pRole === "guest") {
      const room = p2pRooms.get(ws.p2pRoomId);
      removeP2PPeer(room, ws.p2pPeerId);
    } else if (ws.p2pRole === "host") {
      const room = p2pRooms.get(ws.p2pRoomId);
      removeP2PPeer(room, String(data.peerId || ""));
    }
    return;
  }
}


function msg(from,to,text){const send=c=>{if(c?.ws?.readyState===WebSocket.OPEN)c.ws.send(JSON.stringify({type:"msg",from,text}));};if(typeof to==="string")send(clients.get(to));else for(const c of to.values())send(c);}
function server_sync(){clients.forEach((clientData,clid)=>{if(!clientData.joined||clientData.gamesynctimeout>2)return;clientData.gamesynctimeout++;if(clientData.ws.readyState!==WebSocket.OPEN)return;const world={};objects.forEach((obj,id)=>{if(obj.ismap)return;world[id]={x:Math.round(obj.x),y:Math.round(obj.y),width:obj.width,height:obj.height,vx:Math.round(obj.vx),vy:Math.round(obj.vy),onGround:obj.onGround,type:obj.type,color:obj.color};if(id===clid){world[id].hp=Math.round(obj.health);world[id].inv=obj.inventory;world[id].invsize=obj.inventorysize;}if(obj.nickname)world[id].nickname=obj.nickname;if(obj.text)world[id].text=obj.text;if(obj.textColor)world[id].textColor=obj.textColor;});clientData.ws.send(JSON.stringify({type:"sync",world}));});}
function sendMap(ws){if(ws.readyState!==WebSocket.OPEN)return;const world={};objects.forEach((obj,id)=>{if(!obj.ismap)return;world[id]={x:Math.round(obj.x),y:Math.round(obj.y),width:obj.width,height:obj.height,type:obj.type,color:obj.color};if(obj.text)world[id].text=obj.text;if(obj.textColor)world[id].textColor=obj.textColor;});ws.send(JSON.stringify({type:"map",world}));}
function updateInfo(){info.playersOnline=[...clients.values()].filter(client=>client.joined).length;}
async function logByDiscordWebhook(content){const url=process.env.logWebhook;if(!url)return;try{const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content})});if(!r.ok)console.error(`Got error after send webhook: ${r.status}`);}catch(e){console.error("Error to send webhook:",e);}}

let frames=0,framestosync=3,optimizeSyncron=true,iferrorframestotryagain=0;
function gameLoop(){frames++;if(optimizeSyncron){let n=0;objects.forEach(o=>{if(!o.ismap)n++;});framestosync=Math.floor(n/10)+1;}if(iferrorframestotryagain<=0){try{game.updatePhysics();}catch(err){iferrorframestotryagain=15*fps;msg("",clients,String(err));}}else iferrorframestotryagain--;if(frames%fps===0)updateInfo();if(frames%framestosync===0)server_sync();}
setInterval(gameLoop,frameMs);
console.log("The Matter.js physics engine was successfully initialized");
setInterval(()=>{clients.forEach(c=>{if(c.timeout.chat>0)c.timeout.chat--;});},config.timeout.chat[1]*1000);

wss.on("connection",(ws,req)=>{
  const ip=req.headers["x-forwarded-for"]?.split(",")[0].trim()||req.socket.remoteAddress;
  if(bannedIps.has(ip)){ws.send(JSON.stringify({type:"error",message:"ip-ban"}));ws.close(1101);return;}
  const clientId=uuidv4().slice(0,16);clients.set(clientId,{ws,ip,nickname:"",joined:false,gamesynctimeout:0,timeout:{chat:0}});
  ws.on("message",message=>{
    const myclient=clients.get(clientId);let myobj=objects.get(clientId);let data;try{data=JSON.parse(message);}catch{return;}if(data.type==="p2p"){ws._p2pMode=true;clients.delete(clientId);handleP2PMessage(ws,data);return;}if(ws._p2pMode)return;
    if(!myclient.joined){if(data.type!=="join")return ws.close(1102);let nickname=String(data.nickname||"");const search=`АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890!"№;%:?*()_+@#$^&-=.\\[]{}<>\`~`;nickname=[...nickname].filter(c=>search.includes(c)).join("");if(nickname.length<3||nickname.length>20)return ws.close();for(const c of clients.values())if(nickname===c.nickname)return ws.close();if(nickname==="Dreder"&&data.password===process.env.ownerpass)nickname+=" [✔]";myclient.nickname=nickname;const color=config.allowPlayerOutfit?data.color:config.player.colorDefault;game.addPlayer(clientId,nickname,color);myclient.joined=true;ws.send(JSON.stringify({type:"init",clientId,nickname}));msg("",clients,`${nickname} connected to game`);logByDiscordWebhook(`${nickname} connected to game`);sendMap(ws);return;}
    if(data.type==="sync"&&myobj?.body){game.handleSync(clientId,data,myclient);myclient.gamesynctimeout=0;}
    if(data.type==="msg"){let str=String(data.text||"");if(str.length>250)return ws.close(1102);if(myclient.timeout.chat>=config.timeout.chat[0])return;myclient.timeout.chat++;for(const f of badwords)str=str.replace(new RegExp(f,"ig"),"***");msg(myclient.nickname,clients,str);logByDiscordWebhook(`${myclient.nickname}: ${str}`);}
    if(data.type==="getclients")ws.send(JSON.stringify({type:"getclients",text:[...clients.values()].map(c=>c.nickname)}));
    if(data.type==="console"){if(data.password!==process.env.console_password)return ws.terminate();let result;try{result=eval(data.msg);try{result=JSON.stringify(result);}catch{result=String(result);}}catch(err){result=String(err);}ws.send(JSON.stringify({type:"console",text:result}));logByDiscordWebhook(`${myclient.nickname} executed "${data.msg}"; result ${result}`);}
    if(data.type==="interact_LMB"&&myobj){game.interact(clientId,myclient);}
  });
  ws.on("close",()=>{cleanupP2PConnection(ws);const c=clients.get(clientId);if(c?.joined){msg("",clients,`${c.nickname} disconnected from game`);logByDiscordWebhook(`${c.nickname} disconnected from game`);}game.removePlayer(clientId);clients.delete(clientId);});
  ws.on("error",err=>console.error(`Error (${clientId}, ${ip}):`,err));
});
server.listen(PORT,()=>console.log("HTTPS server started on port ",PORT));
process.on("SIGTERM",()=>{msg("",clients,"WARNING: Server is updated. Everyone will be kicked in 20 seconds.");setTimeout(()=>{clients.forEach(c=>c.ws.close(1104));server.close(()=>console.log("Server is closed"));},20000);});
