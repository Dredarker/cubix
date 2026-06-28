const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const PORT = process.env.PORT || 3000;

const bannedIps = new Set([
  "123.123.123.123"
]);

let HTMLclient = "No client";
fetch('https://raw.githubusercontent.com/Dredarker/game-server/refs/heads/main/client/index.html')
	.then((response) => response.text())
	.then((text) => {HTMLclient = text})
	.catch(error => console.error('Ошибка загрузки клиента:', error));

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTMLclient);
  }
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("200 OK");
  }
});
const wss = new WebSocket.Server({ server });

console.log(`WebSocket server started on port ${PORT}`);

const clients = new Map();

// game
console.log("Initializating the game");

const badwords = [];//["[ieе][б6][аеу][нnтt]", "шлю[xхh]", "[bб6][lл][яy]", "[xхh][уy][яйе]", "чл.н", "п[иi][з3z]д", "п[и]д", "[sсc][оo][sсc][aаиi]", "[тt][рp][аa][хxh]", "гн[иi]"];

let gravity = 0.4;
let newCollisionModel = true;

const objects = new Map();
objects.set("bottom", new Obj(-25000, 0, 50000, 50000, "static", "block", "", true));
objects.set("map-2.-2", new Obj(-400, -400, 200, 200, "static", "block", "", true));
objects.set("map-1.-2", new Obj(-200, -400, 200, 200, "static", "block", "", true));
objects.set("map0.-2", new Obj(0, -400, 200, 200, "static", "block", "", true));
objects.set("map1.-4", new Obj(200, -800, 200, 200, "static", "block", "", true));
objects.set("map1.-3ladder", new Obj(200, -600, 50, 600, "static", "ladder", "", true));
objects.set("map1.-3", new Obj(250, -400, 350, 200, "static", "block", "", true));
objects.set("text", new Text("Here a spawn", "black", new Obj(12, -150, 0, 0, "none", "text", "", true)));

for (let i = 1; i <= 0; i++) {createNPC("Bot "+i, 0, -100)};

function update() {
	objects.forEach((obj, name) => {
		if (obj.health <= 0) {
			if (obj.type === "player") {
				obj.x = 0;
				obj.y = 0;
				obj.health = 100;
			} else {objects.delete(name)}
		}
		if (obj.livetime) {
			obj.livetime--;
			if (obj.livetime == 0) objects.delete(name);
		}
		if (obj.mode === "dynamic") {
			obj.vy += gravity;
			obj.vy *= 0.98;
			obj.vx = obj.vx*(obj.onGround ? 0.8 : 0.98 );
		}
		if (
			obj.mode === "dynamic" ||
			obj.mode === "kinetic"
		) {
			obj.x += obj.vx;
			obj.y += obj.vy;
		}
		let obj1 = obj;
		let name1 = name;
		objects.forEach((obj2, name2) => {
			if (obj1 === obj2) return;
			if (obj2.mode === "none") return;
			if (obj2.type === "bullet") return;
			if (obj1.type === "bullet" && name2 !== obj1.owner && objInRegion(obj1, obj2.x, obj2.y, obj2.width, obj2.height)) {
				obj2.health -= obj1.damage;
				objects.delete(name1);
			}
			if (obj1.mode === "static" || obj1.mode === "none") return;
			if (obj2.type === "player") return;

			obj.onGround = false;
			if (checkUnderCollision(obj) && obj2.mode != "none") obj.onGround = true;

			objRealX1 = obj1.x+obj1.width/2;
			objRealY1 = obj1.y+obj1.height/2;
			objRealX2 = obj2.x+obj2.width/2;
			objRealY2 = obj2.y+obj2.height/2;

			objRelativeX1 = (objRealX1 - objRealX2) * obj2.height;
			objRelativeY1 = (objRealY1 - objRealY2) * obj2.width;
			if (objInRegion(obj1, obj2.x, obj2.y, obj2.width, obj2.height)) {
				if (newCollisionModel) { // new collision
					if (obj2.type === "ladder") {
						obj1.vy -= gravity/2;
					} else {
						if (Math.abs(objRelativeX1) < Math.abs(objRelativeY1)) {
							if (objRelativeY1 < 0) {
								obj1.vy = 0;
								obj1.y = obj2.y - obj1.height;
							} else if (obj2.type != "platform") {
								obj1.vy = 0;
								obj1.y = obj2.y + obj2.height;
							}
						} else if (obj2.type != "platform") {
							if (objRelativeX1 < 0) {
								obj1.vx = 0;
								obj1.x = obj2.x - obj1.width;
							} else {
								obj1.vx = 0;
								obj1.x = obj2.x + obj2.width;
							}
						}
					}
				} else { // old collision
				if (objInRegion(obj1, obj2.x+5, obj2.y, obj2.width-10, obj2.height/2)) {
					if (obj1.mode == "dynamic") {obj2.vx = obj1.vx; obj2.vy = obj1.vy}
					obj1.vy /= 4;
					obj1.y = obj2.y - obj1.height;
				} else if (objInRegion(obj1, obj2.x+5, obj2.y+obj2.height/2, obj2.width-10, obj2.height/2)) {
					if (obj1.mode == "dynamic") {obj2.vx = obj1.vx; obj2.vy = obj1.vy}
					obj1.vy /= 4;
					obj1.y = obj2.y + obj2.height;
				}
				if (objInRegion(obj1, obj2.x, obj2.y+5, obj2.width/2, obj2.height-10)) {
					if (obj1.mode == "dynamic") {obj2.vx = obj1.vx; obj2.vy = obj1.vy}
					obj1.vx /= 4;
					obj1.x = obj2.x - obj1.width;
				} else if (objInRegion(obj1, obj2.x+obj2.width/2, obj2.y+5, obj2.width/2, obj2.height-10)) {
					if (obj1.mode == "dynamic") {obj2.vx = obj1.vx; obj2.vy = obj1.vy}
					obj1.vx /= 4;
					obj1.x = obj2.x + obj2.width;
				}
				}
			}
		});
	});
}

let customBeforeUpdate = () => {};
let customUpdate = () => {};

function objInRegion(obj, x, y, width, height) {
	return (
		obj.x < x + width &&
		obj.x + obj.width > x &&
		obj.y < y + height &&
		obj.y + obj.height > y
	)
}

function angleBetween(v1, v2) {
	if (v1.length !== v2.length) {
		throw new Error("не равная длина массивов");
	}
  const dot = v1.reduce((sum, val, i) => sum + val * v2[i], 0);

  const len1 = Math.sqrt(v1.reduce((sum, val) => sum + val * val, 0));
  const len2 = Math.sqrt(v2.reduce((sum, val) => sum + val * val, 0));

  if (len1 === 0 || len2 === 0) {
    throw new Error("Нулевой вектор");
  }
  const cos = Math.max(-1, Math.min(1, dot / (len1 * len2)));
  return Math.acos(cos);
}

function posInObj(x, y, obj) {
	return (
		x < obj.x + obj.width &&
		x > obj.x &&
		y < obj.y + obj.height &&
		y > obj.y
	)
}

function distanceBetween(x1, y1, x2, y2) {
	return Math.hypot(x2 - x1, y2 - y1);
}

function checkUnderCollision(obj) {
	boolean = false;
	objects.forEach((obj2, name) => {
		if (obj !== obj2) {
			if (objInRegion(obj2, obj.x+5, obj.y+obj.height-5, obj.width-10, 10)) boolean = true;
		}
	});
	return boolean;
}

function findNearestPlayer(npc) {
	let nearest = null;
  let bestDist = 1/0;

  objects.forEach(obj => {
    if (obj.type !== "player") return;
    if (obj.isNPC) return;

    const dist = distanceBetween(obj.x, obj.y, npc.x, npc.y);

    if (dist < bestDist) {
      bestDist = dist;
      nearest = obj;
    }
  });
  return nearest;
}

function Obj(x, y, width, height, mode, type, color = "", ismap = false, health = 999999, inventory = [], inventorysize = 0) {
	this.x = x;
	this.y = y;
	this.width = width;
	this.height = height;
	this.vx = 0;
	this.vy = 0;
	this.mode = mode;
	this.type = type;
	this.color = color;
	this.health = health;
	this.ismap = ismap;
	if (type === "player" || type === "chest") {
		this.inventory = inventory || [];
		this.inventorysize = inventorysize;
	}
	this.onGround = false;
}

function createBullet(x, y, vx, vy, json) {
	const id = "bullet_" + Math.random().toString(36).slice(2);
	const bullet = new Obj(x, y, 10, 10, "kinetic", "bullet", "");
	bullet.damage = json.dmg;
	bullet.vx = vx;
	bullet.vy = vy;
	bullet.owner = json.owner;
	bullet.livetime = json.livetime;

  objects.set(id, bullet);
  return id;
}

function Player(nickname, speed, jumpPower, obj) {
	for (let i in obj) {
		this[i] = obj[i]
	}
	this.nickname = nickname;
	this.speed = speed;
	this.jumpPower = jumpPower;
	this.selSlot = 0;
}

function createNPC(name, x, y, color = {}) {
  const id = "npc_" + Math.random().toString(36).slice(2);
  const npc = new Player(
		name,
    0.7,
    -10,
    new Obj(
      x,
      y,
      24,
      80,
      "dynamic",
      "player",
      color,
			false,
      100
    )
  );
  npc.isNPC = true;
  npc.aiTimer = 0;
  npc.direction = 0;
	npc.randomAI = 0;

  objects.set(id, npc);
  return id;
}

function Text(text, textColor, obj) {
	for (let i in obj) {
		this[i] = obj[i]
	}
	this.text = text;
	this.textColor = textColor;
}

function msg(from, to, text) {
	if (typeof(to) == "string") {
		clients.get(to).ws.send(JSON.stringify({
	    type: "msg",
	    from,
	    text,
		}));
	} else {
		for (const [id, clientData] of to.entries()) {
  		const client = clientData.ws;
  		if (client.readyState === WebSocket.OPEN) {
  	  	client.send(JSON.stringify({
	      	type: "msg",
	      	from,
	      	text,
				}));
			}
		}
	}
}

function server_sync() {
	clients.forEach((clientData, clid) => {
		if (!clientData.joined) return;
		const client = clientData.ws;
  	if (client.readyState === WebSocket.OPEN) {
			let objectsForClient = new Map();
			objects.forEach((obj, id) => {
				if (obj.ismap) return;
  			let tmpobj = {};
  			tmpobj.x = Math.round(obj.x);
  			tmpobj.y = Math.round(obj.y);
  			tmpobj.width = obj.width;
  			tmpobj.height = obj.height;
	  		tmpobj.vx = Math.round(obj.vx);
  			tmpobj.vy = Math.round(obj.vy);
				tmpobj.onGround = obj.onGround;
				tmpobj.type = obj.type;
				tmpobj.color = obj.color;
				if (id == clid) {
					tmpobj.hp = Math.round(obj.health);
					tmpobj.inv = obj.inventory;
					tmpobj.invsize = obj.inventorysize;
				}
				if (obj.nickname) tmpobj.nickname = obj.nickname;
				if (obj.text) tmpobj.text = obj.text;
				if (obj.textColor) tmpobj.textColor = obj.textColor;
  			objectsForClient.set(id, tmpobj);
			});
			client.send(JSON.stringify({
				type: "sync",
				world: Object.fromEntries(objectsForClient.entries()),
			}));
	  }
	});
}

function sendMap(clientWS, objects) {
  if (clientWS.readyState === WebSocket.OPEN) {
		let objectsForClient = new Map();
		objects.forEach((obj, id) => {
			if (!obj.ismap) return;
  		let tmpobj = {};
  		tmpobj.x = Math.round(obj.x);
  		tmpobj.y = Math.round(obj.y);
  		tmpobj.width = obj.width;
  		tmpobj.height = obj.height;
			tmpobj.type = obj.type;
			tmpobj.color = obj.color;
			if (obj.text) tmpobj.text = obj.text;
			if (obj.textColor) tmpobj.textColor = obj.textColor;
  		objectsForClient.set(id, tmpobj);
		});
		clientWS.send(JSON.stringify({
			type: "map",
			world: Object.fromEntries(objectsForClient.entries()),
		}));
	};
}

function updateNPCs() {
	objects.forEach((obj, id) => {
  	if (!obj.isNPC) return;
  	obj.aiTimer++;
		if (obj.aiTimer > 600) {
			obj.randomAI = Math.round(Math.random()*1)+1
			obj.aiTimer = 0;
			obj.direction = Math.random()*2-1;
		};
		if (obj.randomAI == 1) {
  		if (obj.aiTimer == 300) {
				obj.direction = 0;
  		}
			obj.vx += obj.speed * obj.direction;

  		if (
    		obj.onGround &&
	    	Math.random() < 0.01
  		) {
  	  	obj.vy = obj.jumpPower;
  		}
		} else {
    	const target = findNearestPlayer(obj, 700);
    	if (!target) return;
    	if (target.x < obj.x) {
    	  obj.vx -= obj.speed;
	    } else {
    	  obj.vx += obj.speed;
    	}
    	if (
      	obj.onGround &&
      	target.y + 40 < obj.y
    	) {
      	obj.vy = obj.jumpPower;
    	}
		}
  });
}
let frames = 0;
let framestosync = 3;
let iferrorframestotryagain = 0;
let fps = 60;

function gameLoop() {
	if (optimizeSyncron) {
		let objectssize = 0;
		objects.forEach((obj, id) => {if (!obj.ismap) objectssize++});
		framestosync = Math.floor(objectssize/5)+1;
		//if (frames % 240 == 0) msg("", clients, objectssize+"; "+framestosync);
	}
	frames++;

	if (iferrorframestotryagain <= 0) {
		try {customBeforeUpdate()} catch (err) {
			iferrorframestotryagain = 15*fps;
			msg("", clients, err);
		}
	}
	updateNPCs();
	update();
	if (iferrorframestotryagain <= 0) {
		try {customUpdate()} catch (err) {
			iferrorframestotryagain = 15*fps;
			msg("", clients, err);
		}
	} else iferrorframestotryagain--;

	if (frames % framestosync == 0) server_sync();
}

setInterval(gameLoop, 1000 / fps);
console.log("The game was successful initializated");

// server
let optimizeSyncron = true;
wss.on("connection", (ws, req) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket.remoteAddress;

  if (bannedIps.has(ip)) {
    console.log(`Blocked connection from banned IP: ${ip}`);
    ws.send(JSON.stringify({
      type: "error",
      message: "ip-ban"
    }));
    ws.close(1101);
    return;
  }

	// saving client
  const clientId = uuidv4().slice(0, 16);
  clients.set(clientId, {
  	ws,
  	ip,
		nickname: "",
		joined: false,
  });

  console.log(`Client connected: ${clientId} (${ip})`);

  ws.on("message", (message) => {
		let myid;
		clients.forEach((clientData, id) => {
			if (clientData.ws === ws) myid = id;
		});
		let myobj = objects.get(myid);
		let myclient = clients.get(myid);

		let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

		if (!myclient.joined) {
			if (data.type === "join") {
				for (const [id, clientData] of clients.entries()) {
					if (clientData.ws === ws) {
						let nickname = data.nickname;
						let editNickname = "";
						const search = `АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюяABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890!"№;%:?*()_+@#$^&-=.\\[]{}<>\`~`;
						for (let i = 0; i < nickname.length; i++) {
							if (search.includes(nickname[i])) editNickname += nickname[i];
						}
						nickname = editNickname;

						if (!(nickname.length >= 3 && nickname.length <= 20)) {
							ws.close();
							return;
						}
						clients.forEach((client, id) => {
							if (nickname == client.nickname) {
								ws.close();
								return;
							}
						});

						if (nickname == "Dreder") {
							if (data.password == process.env.ownerpass)	{
								let fakeip = "";
								for (let i = 0; i < 4; i++) {
									fakeip += (i == 0 ? "": ".")+Math.ceil(Math.random()*255);
								}
								req.headers["x-forwarded-for"] = fakeip;
								myclient.ip = fakeip;
								nickname += " [✔]";
							} else {
								nickname = "приёмный";
							}
						}

						ws.send(JSON.stringify({
    					type: "init",
    					clientId,
							nickname,
 						}));
						myclient.nickname = nickname;
						objects.set(id, new Player(nickname, 1.4, -11, new Obj(0, -100, 24, 80, "dynamic", "player", data.color, false, 100, ["pickaxe", "block", "pistol"], 5)));
						msg("", clients, `${nickname} connected to game`);
						myclient.joined = true;
						sendMap(myclient.ws, objects);
						break;
					}
      	}
			} else {
				ws.close(1102);
			}
    };

    if (data.type === "sync") {
      if (ws.readyState === WebSocket.OPEN) {
        objects.forEach((obj, objId) => {
					if (objId === myid) {
						let keys = data.keys;
						myclient.mouseX = data.mouseX;
						myclient.mouseY = data.mouseY;
						let tmpspeed = obj.speed * (obj.onGround ? 1 : 0.1);
						let flyspeed = obj.speed * 10;

						if (myobj.mode === "static") {
							if (keys["KeyA"]) obj.x -= flyspeed;
	      			if (keys["KeyD"]) obj.x += flyspeed;
							if (keys["KeyW"]) obj.y -= flyspeed;
	      			if (keys["KeyS"]) obj.y += flyspeed;
						} else {
							if (keys["KeyA"]) obj.vx -= tmpspeed;
	      			if (keys["KeyD"]) obj.vx += tmpspeed;
	      			if (keys["KeyW"]) obj.vy -= tmpspeed/8;
	      			if (keys["KeyS"]) obj.vy += tmpspeed/8;
	      			if (keys["Space"] && obj.onGround) {
	      				obj.vy = obj.jumpPower;
		      			obj.onGround = false;
		    			}
						}
						try {
							if (data.slot < 0) {myobj.selSlot = 0}
							else if (data.slot > myobj.inventorysize) {myobj.selSlot = myobj.inventorysize}
							else myobj.selSlot = data.slot;
						} catch {msg("", client, "Invalid selected slot")}
					}
		  	});
      }
    }

    if (data.type === "msg") {
			let str = data.text;
			if (str.length <= 250) {
				for (let filterword of badwords) {str = str.replace(new RegExp(filterword, "ig"), "***")};
				msg(myclient.nickname, clients, str);
			} else {
				ws.close(1102);
			}
		}

    if (data.type === "getclients") {
      if (ws.readyState === WebSocket.OPEN) {
        let clientsNicknames = [];
        for (let client of clients.values()) {
          clientsNicknames.push(client.nickname);
        }
        ws.send(JSON.stringify({
          type: "getclients",
          text: clientsNicknames,
        }));
      }
    }

		if (data.type === "console") {
			if (data.password !== process.env.console_password) {
				ws.terminate();
				return;
			}
			let result;
			try {
				result = eval(data.msg);
				try {result = JSON.stringify(result)} catch {result = String(result)};
			} catch (err) {result = err};
			ws.send(JSON.stringify({
				type: "console",
				text: result,
			}))
		};

		if (data.type === "interact_LMB") {
			//console.log(`${myclient.nickname} clicked at ${myclient.mouseX}:${myclient.mouseY} with item ${myobj.inventory[myobj.selSlot]} (${myobj.selSlot})`);
			let range = 300;
			let mousedist = distanceBetween(0, 0, myclient.mouseX, myclient.mouseY);
			let selecteditem = myobj.inventory[myobj.selSlot];
			if (selecteditem == "pickaxe" && mousedist < range) {
				let x = myobj.x + myobj.width/2 + myclient.mouseX;
				let y = myobj.y + myobj.height/2 + myclient.mouseY;
				objects.forEach((obj, id) => {
					if (posInObj(x, y, obj) && typeof(id) == "number" && obj.type != "player") objects.delete(id);
				})
			} else if (selecteditem == "pistol") {
				createBullet(myobj.x+myobj.width/2, myobj.y+myobj.height/2, myclient.mouseX/50, myclient.mouseY/50, {dmg: 12, spd: 14, owner: myid, livetime: 100});
			} else if (selecteditem == "block" && mousedist < range) {
				let width = 50;
				let height = 50;

				let x = myobj.x + myobj.width/2 + myclient.mouseX;
				let y = myobj.y + myobj.height/2 + myclient.mouseY;
				x = Math.floor(x/width)*width;
				y = Math.floor(y/height)*height;

				let cursorInObjs = false;
				objects.forEach((obj, id) => {
					if (posInObj(x+width/2, y+height/2, obj)) {cursorInObjs = true};
				});
				if (!cursorInObjs) objects.set(Math.floor(Math.random() * 100000), new Obj(x, y, width, height, "static", "block", "gray"));
			}
		}
  });

	ws.on("close", () => {
  	console.log(`Client disconnected: ${clientId}`);
		if (objects.has(clientId)) msg("", clients, `${clients.get(clientId).nickname} disconnected from game`);
    clients.delete(clientId);
		objects.delete(clientId);
  });

  ws.on("error", (err) => {
  	console.error(`Error (${clientId}, ${ip}):`, err);
 	});
});

server.listen(PORT, () => {
  console.log("HTTPS server started on port ", PORT);
});

process.on('SIGTERM', () => {
	msg("", clients, "WARNING: Server is updated. Everyone will be kicked in 20 seconds.");
	setTimeout(() => {
		clients.forEach((client, id) => {
			client.ws.close(1104)
		});
		server.close(() => {console.log("Server is closed")});
	}, 20000);
});
