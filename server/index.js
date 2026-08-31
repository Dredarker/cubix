const http = require("http");
const WebSocket = require("ws");
const {v4: uuidv4} = require("uuid");
const {config} = require("./config.js");
const Matter = require("matter-js");

const {Engine, Bodies, Body, World, Events} = Matter;
const PORT = process.env.PORT || 3000;
const fps = 60;
const frameMs = 1000 / fps;
const gravity = config.game.gravity;

const bannedIps = new Set(["123.123.123.123"]);
const clients = new Map();
const consoleclients = new Map();
const objects = new Map();
const bodyToObject = new Map();

const engine = Engine.create({enableSleeping: false, gravity: {x: 0, y: gravity}});
engine.positionIterations = 8;
engine.velocityIterations = 6;

const info = {isCubixServer: true, playersOnline: 0, maxPlayersCount: config.maxPlayersCount, name: config.name};
let HTMLclient = "No client";
fetch("https://raw.githubusercontent.com/Dredarker/cubix/refs/heads/main/client/index.html").then(r => r.text()).then(t => HTMLclient = t).catch(e => console.error("Error to load client:", e));
let HTMLconsoleClient = "No client";
fetch("https://raw.githubusercontent.com/Dredarker/cubix/refs/heads/main/cmd/index.html").then(r => r.text()).then(t => HTMLconsoleClient = t).catch(e => console.error("Error to load console client:", e));

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.url === "/") { res.writeHead(200, {"Content-Type": "text/html"}); return res.end(HTMLclient); }
  if (req.url === "/console") { res.writeHead(200, {"Content-Type": "text/html"}); return res.end(HTMLconsoleClient); }
  if (req.url === "/healthz") { res.writeHead(200, {"Content-Type": "text/plain"}); return res.end("200 OK"); }
  if (req.url === "/ping") { res.writeHead(200, {"Content-Type": "application/json"}); return res.end(JSON.stringify(info)); }
  res.writeHead(404); res.end();
});
const wss = new WebSocket.Server({server});
console.log(`WebSocket server started on port ${PORT}`);
const badwords = [];

function syncObjectFromBody(obj) {
  if (!obj.body) return;
  obj.x = obj.body.position.x - obj.width / 2;
  obj.y = obj.body.position.y - obj.height / 2;
  obj.vx = obj.body.velocity.x;
  obj.vy = obj.body.velocity.y;
  obj.angle = obj.body.angle;
}
function addBody(id, obj) {
  if (obj.mode === "none") return;
  const body = Bodies.rectangle(obj.x + obj.width / 2, obj.y + obj.height / 2, Math.max(1, obj.width), Math.max(1, obj.height), {
    isStatic: obj.mode === "static" || obj.ismap,
    label: id,
    restitution: 0,
    friction: obj.type === "player" ? 0.001 : 0.8,
    frictionAir: obj.type === "player" ? 0.04 : 0.01,
    inertia: Infinity
  });
  obj.body = body;
  bodyToObject.set(body.id, obj);
  World.add(engine.world, body);
  return body;
}
function removeObject(id) {
  const obj = objects.get(id);
  if (!obj) return;
  if (obj.body) { bodyToObject.delete(obj.body.id); World.remove(engine.world, obj.body); }
  objects.delete(id);
}
function Obj(x, y, width, height, mode, type, color = "", ismap = false, health = 999999, inventory = [], inventorysize = 0) {
  this.x=x; this.y=y; this.width=width; this.height=height; this.vx=0; this.vy=0; this.mode=mode; this.type=type; this.color=color; this.health=health; this.ismap=ismap; this.onGround=false;
  if (type === "player" || type === "chest") { this.inventory=inventory || []; this.inventorysize=inventorysize; }
}
function createObject(id, obj) { obj.id=id; objects.set(id,obj); addBody(id,obj); return obj; }
function Text(text, textColor, obj) { Object.assign(this,obj); this.text=text; this.textColor=textColor; }
function Player(nickname, speed, jumpPower, obj) { Object.assign(this,obj); this.nickname=nickname; this.speed=speed; this.jumpPower=jumpPower; this.selSlot=0; }

createObject("bottom", new Obj(-25000, 0, 50000, 50000, "static", "block", "", true));
createObject("text", new Text("Here a spawn", "black", new Obj(12, -150, 0, 0, "none", "text", "", true)));

function createNPC(name, x, y, color = {}) {
  const id="npc_"+Math.random().toString(36).slice(2);
  const npc=new Player(name,0.7,-10,new Obj(x,y,24,80,"dynamic","player",color,false,100));
  npc.isNPC=true; npc.aiTimer=0; npc.direction=0; npc.randomAI=0; createObject(id,npc); return id;
}
for (let i=1;i<=0;i++) createNPC("Bot "+i,config.player.startX,config.player.startY);
function distanceBetween(x1,y1,x2,y2){return Math.hypot(x2-x1,y2-y1);}
function posInObj(x,y,obj){return x<obj.x+obj.width&&x>obj.x&&y<obj.y+obj.height&&y>obj.y;}
function findNearestPlayer(npc){let nearest=null,bestDist=Infinity;objects.forEach(obj=>{if(obj.type!=="player"||obj.isNPC)return;const d=distanceBetween(obj.x,obj.y,npc.x,npc.y);if(d<bestDist){bestDist=d;nearest=obj;}});return nearest;}
function updateNPCs(){objects.forEach(obj=>{if(!obj.isNPC||!obj.body)return;obj.aiTimer++;if(obj.aiTimer>600){obj.randomAI=Math.round(Math.random())+1;obj.aiTimer=0;obj.direction=Math.random()*2-1;}if(obj.randomAI===1){if(obj.aiTimer===300)obj.direction=0;Body.setVelocity(obj.body,{x:obj.speed*obj.direction*8,y:obj.body.velocity.y});if(obj.onGround&&Math.random()<0.01)Body.setVelocity(obj.body,{x:obj.body.velocity.x,y:obj.jumpPower});}else{const target=findNearestPlayer(obj);if(!target)return;const vx=target.x<obj.x?-obj.speed*8:obj.speed*8;Body.setVelocity(obj.body,{x:vx,y:obj.body.velocity.y});if(obj.onGround&&target.y+40<obj.y)Body.setVelocity(obj.body,{x:vx,y:obj.jumpPower});}});}
function updateGroundState(){objects.forEach(obj=>{obj.onGround=false;if(!obj.body||obj.mode!=="dynamic")return;const b=obj.body.bounds;for(const other of engine.world.bodies){if(other===obj.body||!other.isStatic)continue;if(b.max.y>=other.bounds.min.y-2&&b.max.y<=other.bounds.min.y+8&&b.max.x>other.bounds.min.x+1&&b.min.x<other.bounds.max.x-1){obj.onGround=true;break;}}});}
function updatePhysics(){updateNPCs();Engine.update(engine,frameMs);objects.forEach((obj,id)=>{if(!obj.body)return;syncObjectFromBody(obj);if(obj.livetime&&--obj.livetime<=0)removeObject(id);if(obj.health<=0){if(obj.type==="player"){Body.setPosition(obj.body,{x:config.player.startX+obj.width/2,y:config.player.startY+obj.height/2});Body.setVelocity(obj.body,{x:0,y:0});obj.health=100;}else removeObject(id);}});updateGroundState();}
Events.on(engine,"collisionStart",event=>{for(const pair of event.pairs){const a=bodyToObject.get(pair.bodyA.id),b=bodyToObject.get(pair.bodyB.id);if(!a||!b)continue;const bullet=a.type==="bullet"?a:b.type==="bullet"?b:null;const target=bullet===a?b:bullet===b?a:null;if(bullet&&target&&target.type!=="bullet"&&target.id!==bullet.owner){target.health-=bullet.damage||0;removeObject(bullet.id);}}});
function createBullet(x,y,vx,vy,json){const id="bullet_"+Math.random().toString(36).slice(2);const b=new Obj(x,y,10,10,"kinetic","bullet","");b.damage=json.dmg;b.owner=json.owner;b.livetime=json.livetime;createObject(id,b);Body.setVelocity(b.body,{x:vx,y:vy});return id;}
function msg(from,to,text){const send=c=>{if(c?.ws?.readyState===WebSocket.OPEN)c.ws.send(JSON.stringify({type:"msg",from,text}));};if(typeof to==="string")send(clients.get(to));else for(const c of to.values())send(c);}
function server_sync(){clients.forEach((clientData,clid)=>{if(!clientData.joined||clientData.gamesynctimeout>2)return;clientData.gamesynctimeout++;if(clientData.ws.readyState!==WebSocket.OPEN)return;const world={};objects.forEach((obj,id)=>{if(obj.ismap)return;world[id]={x:Math.round(obj.x),y:Math.round(obj.y),width:obj.width,height:obj.height,vx:Math.round(obj.vx),vy:Math.round(obj.vy),onGround:obj.onGround,type:obj.type,color:obj.color};if(id===clid){world[id].hp=Math.round(obj.health);world[id].inv=obj.inventory;world[id].invsize=obj.inventorysize;}if(obj.nickname)world[id].nickname=obj.nickname;if(obj.text)world[id].text=obj.text;if(obj.textColor)world[id].textColor=obj.textColor;});clientData.ws.send(JSON.stringify({type:"sync",world}));});}
function sendMap(ws){if(ws.readyState!==WebSocket.OPEN)return;const world={};objects.forEach((obj,id)=>{if(!obj.ismap)return;world[id]={x:Math.round(obj.x),y:Math.round(obj.y),width:obj.width,height:obj.height,type:obj.type,color:obj.color};if(obj.text)world[id].text=obj.text;if(obj.textColor)world[id].textColor=obj.textColor;});ws.send(JSON.stringify({type:"map",world}));}
function updateInfo(){info.playersOnline=clients.size;}
async function logByDiscordWebhook(content){const url=process.env.logWebhook;if(!url)return;try{const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content})});if(!r.ok)console.error(`Got error after send webhook: ${r.status}`);}catch(e){console.error("Error to send webhook:",e);}}
let frames=0,framestosync=3,optimizeSyncron=true,iferrorframestotryagain=0;
function gameLoop(){frames++;if(optimizeSyncron){let n=0;objects.forEach(o=>{if(!o.ismap)n++;});framestosync=Math.floor(n/10)+1;}if(iferrorframestotryagain<=0){try{updatePhysics();}catch(err){iferrorframestotryagain=15*fps;msg("",clients,String(err));}}else iferrorframestotryagain--;if(frames%fps===0)updateInfo();if(frames%framestosync===0)server_sync();}
setInterval(gameLoop,frameMs);
console.log("The Matter.js physics engine was successfully initialized");
setInterval(()=>{clients.forEach(c=>{if(c.timeout.chat>0)c.timeout.chat--;});},config.timeout.chat[1]*1000);

wss.on("connection",(ws,req)=>{
  const ip=req.headers["x-forwarded-for"]?.split(",")[0].trim()||req.socket.remoteAddress;
  if(bannedIps.has(ip)){ws.send(JSON.stringify({type:"error",message:"ip-ban"}));ws.close(1101);return;}
  const clientId=uuidv4().slice(0,16);clients.set(clientId,{ws,ip,nickname:"",joined:false,gamesynctimeout:0,timeout:{chat:0}});
  ws.on("message",message=>{
    const myclient=clients.get(clientId);let myobj=objects.get(clientId);let data;try{data=JSON.parse(message);}catch{return;}
    if(!myclient.joined){if(data.type!=="join")return ws.close(1102);let nickname=String(data.nickname||"");const search=`АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890!"№;%:?*()_+@#$^&-=.\\[]{}<>\`~`;nickname=[...nickname].filter(c=>search.includes(c)).join("");if(nickname.length<3||nickname.length>20)return ws.close();for(const c of clients.values())if(nickname===c.nickname)return ws.close();if(nickname==="Dreder"&&data.password===process.env.ownerpass)nickname+=" [✔]";myclient.nickname=nickname;const color=config.allowPlayerOutfit?data.color:config.player.colorDefault;myobj=new Player(nickname,1.4,-11,new Obj(config.player.startX,config.player.startY,24,80,"dynamic","player",color,false,100,config.player.inventory,config.player.invsize));createObject(clientId,myobj);myclient.joined=true;ws.send(JSON.stringify({type:"init",clientId,nickname}));msg("",clients,`${nickname} connected to game`);logByDiscordWebhook(`${nickname} connected to game`);sendMap(ws);return;}
    if(data.type==="sync"&&myobj?.body){myclient.mouseX=Number(data.mouseX)||0;myclient.mouseY=Number(data.mouseY)||0;const keys=data.keys||{};let vx=myobj.body.velocity.x;if(keys.KeyA)vx-=myobj.speed;if(keys.KeyD)vx+=myobj.speed;vx=Math.max(-myobj.speed*5,Math.min(myobj.speed*5,vx));Body.setVelocity(myobj.body,{x:vx,y:myobj.body.velocity.y});if(keys.Space&&myobj.onGround)Body.setVelocity(myobj.body,{x:myobj.body.velocity.x,y:myobj.jumpPower});myobj.selSlot=Math.max(0,Math.min(myobj.inventorysize,Number(data.slot)||0));myclient.gamesynctimeout=0;}
    if(data.type==="msg"){let str=String(data.text||"");if(str.length>250)return ws.close(1102);if(myclient.timeout.chat>=config.timeout.chat[0])return;myclient.timeout.chat++;for(const f of badwords)str=str.replace(new RegExp(f,"ig"),"***");msg(myclient.nickname,clients,str);logByDiscordWebhook(`${myclient.nickname}: ${str}`);}
    if(data.type==="getclients")ws.send(JSON.stringify({type:"getclients",text:[...clients.values()].map(c=>c.nickname)}));
    if(data.type==="console"){if(data.password!==process.env.console_password)return ws.terminate();let result;try{result=eval(data.msg);try{result=JSON.stringify(result);}catch{result=String(result);}}catch(err){result=String(err);}ws.send(JSON.stringify({type:"console",text:result}));logByDiscordWebhook(`${myclient.nickname} executed "${data.msg}"; result ${result}`);}
    if(data.type==="interact_LMB"&&myobj){const range=300,mousedist=distanceBetween(0,0,myclient.mouseX||0,myclient.mouseY||0),item=myobj.inventory?.[myobj.selSlot];if(item==="pistol")createBullet(myobj.x+myobj.width/2,myobj.y+myobj.height/2,(myclient.mouseX||0)/50,(myclient.mouseY||0)/50,{dmg:12,owner:clientId,livetime:100});else if(item==="block"&&mousedist<range){const w=50,h=50;let x=myobj.x+myobj.width/2+(myclient.mouseX||0),y=myobj.y+myobj.height/2+(myclient.mouseY||0);x=Math.floor(x/w)*w;y=Math.floor(y/h)*h;let occupied=false;objects.forEach(o=>{if(posInObj(x+w/2,y+h/2,o))occupied=true;});if(!occupied)createObject(Math.floor(Math.random()*100000),new Obj(x,y,w,h,"static","block","gray"));}}
  });
  ws.on("close",()=>{const c=clients.get(clientId);if(c?.joined){msg("",clients,`${c.nickname} disconnected from game`);logByDiscordWebhook(`${c.nickname} disconnected from game`);}removeObject(clientId);clients.delete(clientId);});
  ws.on("error",err=>console.error(`Error (${clientId}, ${ip}):`,err));
});
server.listen(PORT,()=>console.log("HTTPS server started on port ",PORT));
process.on("SIGTERM",()=>{msg("",clients,"WARNING: Server is updated. Everyone will be kicked in 20 seconds.");setTimeout(()=>{clients.forEach(c=>c.ws.close(1104));server.close(()=>console.log("Server is closed"));},20000);});
