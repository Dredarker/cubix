(function (root, factory) {
  const Matter = root.Matter || (typeof require === "function" ? require("matter-js") : null);
  const CubixGameEngine = factory(Matter);

  if (typeof module === "object" && module.exports) {
    module.exports = CubixGameEngine;
  } else {
    root.CubixGameEngine = CubixGameEngine;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Matter) {
  "use strict";

  if (!Matter) throw new Error("Matter.js must be loaded before CubixGameEngine");

  const { Engine, Bodies, Body, World, Events } = Matter;

  class CubixGameEngine {
    constructor(config) {
      this.config = config;
      this.objects = new Map();
      this.bodyToObject = new Map();
      this.engine = Engine.create({
        enableSleeping: false,
        gravity: { x: 0, y: config.game.gravity },
      });
      this.engine.positionIterations = 8;
      this.engine.velocityIterations = 6;

      this.createObject(
        "bottom",
        this.createObj(-25000, 0, 50000, 50000, "static", "block", "", true)
      );
      this.createObject(
        "text",
        this.createText(
          "Here a spawn",
          "black",
          this.createObj(12, -150, 0, 0, "none", "text", "", true)
        )
      );

      Events.on(this.engine, "collisionStart", (event) => {
        for (const pair of event.pairs) {
          const a = this.bodyToObject.get(pair.bodyA.id);
          const b = this.bodyToObject.get(pair.bodyB.id);
          if (!a || !b) continue;

          const bullet =
            a.type === "bullet" ? a : b.type === "bullet" ? b : null;
          const target = bullet === a ? b : bullet === b ? a : null;

          if (
            bullet &&
            target &&
            target.type !== "bullet" &&
            target.id !== bullet.owner
          ) {
            target.health -= bullet.damage || 0;
            this.removeObject(bullet.id);
          }
        }
      });

      for (let i = 1; i <= 0; i++) {
        this.createNPC(
          "Bot " + i,
          config.player.startX,
          config.player.startY
        );
      }
    }

    createObj(
      x,
      y,
      width,
      height,
      mode,
      type,
      color = "",
      ismap = false,
      health = 999999,
      inventory = [],
      inventorysize = 0
    ) {
      const obj = {
        x,
        y,
        width,
        height,
        vx: 0,
        vy: 0,
        mode,
        type,
        color,
        health,
        ismap,
        onGround: false,
      };

      if (type === "player" || type === "chest") {
        obj.inventory = inventory || [];
        obj.inventorysize = inventorysize;
      }
      return obj;
    }

    createText(text, textColor, obj) {
      return Object.assign({}, obj, { text, textColor });
    }

    createPlayer(nickname, speed, jumpPower, obj) {
      return Object.assign({}, obj, {
        nickname,
        speed,
        jumpPower,
        selSlot: 0,
      });
    }

    createObject(id, obj) {
      obj.id = id;
      this.objects.set(id, obj);
      this.addBody(id, obj);
      return obj;
    }

    addBody(id, obj) {
      if (obj.mode === "none") return null;

      const body = Bodies.rectangle(
        obj.x + obj.width / 2,
        obj.y + obj.height / 2,
        Math.max(1, obj.width),
        Math.max(1, obj.height),
        {
          isStatic: obj.mode === "static" || obj.ismap,
          label: String(id),
          restitution: 0,
          friction: 0.4,
          frictionAir: 0.01,
          inertia: Infinity,
        }
      );

      obj.body = body;
      this.bodyToObject.set(body.id, obj);
      World.add(this.engine.world, body);
      return body;
    }

    removeObject(id) {
      const obj = this.objects.get(id);
      if (!obj) return;

      if (obj.body) {
        this.bodyToObject.delete(obj.body.id);
        World.remove(this.engine.world, obj.body);
      }
      this.objects.delete(id);
    }

    addPlayer(id, nickname, color) {
      const player = this.createPlayer(
        nickname,
        1,
        -10,
        this.createObj(
          this.config.player.startX,
          this.config.player.startY,
          24,
          80,
          "dynamic",
          "player",
          color,
          false,
          100,
          this.config.player.inventory,
          this.config.player.invsize
        )
      );
      this.createObject(id, player);
      return player;
    }

    removePlayer(id) {
      this.removeObject(id);
    }

    createNPC(name, x, y, color = {}) {
      const id = "npc_" + Math.random().toString(36).slice(2);
      const npc = this.createPlayer(
        name,
        0.7,
        -10,
        this.createObj(x, y, 24, 80, "dynamic", "player", color, false, 100)
      );
      npc.isNPC = true;
      npc.aiTimer = 0;
      npc.direction = 0;
      npc.randomAI = 0;
      this.createObject(id, npc);
      return id;
    }

    distanceBetween(x1, y1, x2, y2) {
      return Math.hypot(x2 - x1, y2 - y1);
    }

    posInObj(x, y, obj) {
      return (
        x < obj.x + obj.width &&
        x > obj.x &&
        y < obj.y + obj.height &&
        y > obj.y
      );
    }

    findNearestPlayer(npc) {
      let nearest = null;
      let bestDist = Infinity;

      this.objects.forEach((obj) => {
        if (obj.type !== "player" || obj.isNPC) return;
        const distance = this.distanceBetween(obj.x, obj.y, npc.x, npc.y);
        if (distance < bestDist) {
          bestDist = distance;
          nearest = obj;
        }
      });
      return nearest;
    }

    updateNPCs() {
      this.objects.forEach((obj) => {
        if (!obj.isNPC || !obj.body) return;

        obj.aiTimer++;
        if (obj.aiTimer > 600) {
          obj.randomAI = Math.round(Math.random()) + 1;
          obj.aiTimer = 0;
          obj.direction = Math.random() * 2 - 1;
        }

        if (obj.randomAI === 1) {
          if (obj.aiTimer === 300) obj.direction = 0;
          Body.setVelocity(obj.body, {
            x: obj.speed * obj.direction * 8,
            y: obj.body.velocity.y,
          });
          if (obj.onGround && Math.random() < 0.01) {
            Body.setVelocity(obj.body, {
              x: obj.body.velocity.x,
              y: obj.jumpPower,
            });
          }
        } else {
          const target = this.findNearestPlayer(obj);
          if (!target) return;
          const vx = target.x < obj.x ? -obj.speed * 8 : obj.speed * 8;
          Body.setVelocity(obj.body, { x: vx, y: obj.body.velocity.y });
          if (obj.onGround && target.y + 40 < obj.y) {
            Body.setVelocity(obj.body, { x: vx, y: obj.jumpPower });
          }
        }
      });
    }

    updateGroundState() {
      this.objects.forEach((obj) => {
        obj.onGround = false;
        if (!obj.body || obj.mode !== "dynamic") return;

        const bounds = obj.body.bounds;
        for (const other of this.engine.world.bodies) {
          if (other === obj.body || !other.isStatic) continue;
          if (
            bounds.max.y >= other.bounds.min.y - 2 &&
            bounds.max.y <= other.bounds.min.y + 8 &&
            bounds.max.x > other.bounds.min.x + 1 &&
            bounds.min.x < other.bounds.max.x - 1
          ) {
            obj.onGround = true;
            break;
          }
        }
      });
    }

    syncObjectFromBody(obj) {
      if (!obj.body) return;
      obj.x = obj.body.position.x - obj.width / 2;
      obj.y = obj.body.position.y - obj.height / 2;
      obj.vx = obj.body.velocity.x;
      obj.vy = obj.body.velocity.y;
      obj.angle = obj.body.angle;
    }

    updatePhysics() {
      this.updateNPCs();
      Engine.update(this.engine, 1000 / 60);

      this.objects.forEach((obj, id) => {
        if (!obj.body) return;
        this.syncObjectFromBody(obj);

        if (obj.livetime && --obj.livetime <= 0) this.removeObject(id);

        if (obj.health <= 0) {
          if (obj.type === "player") {
            Body.setPosition(obj.body, {
              x: this.config.player.startX + obj.width / 2,
              y: this.config.player.startY + obj.height / 2,
            });
            Body.setVelocity(obj.body, { x: 0, y: 0 });
            obj.health = 100;
          } else {
            this.removeObject(id);
          }
        }
      });

      this.updateGroundState();
    }

    handleSync(id, data, clientData) {
      const player = this.objects.get(id);
      if (!player || !player.body) return;

      clientData.mouseX = Number(data.mouseX) || 0;
      clientData.mouseY = Number(data.mouseY) || 0;

      const keys = data.keys || {};
      let vx = player.body.velocity.x;
      if (keys.KeyA) vx -= player.speed;
      if (keys.KeyD) vx += player.speed;
      vx = Math.max(-player.speed * 5, Math.min(player.speed * 5, vx));

      Body.setVelocity(player.body, {
        x: vx,
        y: player.body.velocity.y,
      });

      if (keys.Space && player.onGround) {
        Body.setVelocity(player.body, {
          x: player.body.velocity.x,
          y: player.jumpPower,
        });
      }

      player.selSlot = Math.max(
        0,
        Math.min(player.inventorysize, Number(data.slot) || 0)
      );
    }

    createBullet(x, y, vx, vy, options) {
      const id = "bullet_" + Math.random().toString(36).slice(2);
      const bullet = this.createObj(x, y, 10, 10, "kinetic", "bullet", "");
      bullet.damage = options.dmg;
      bullet.owner = options.owner;
      bullet.livetime = options.livetime;
      this.createObject(id, bullet);
      Body.setVelocity(bullet.body, { x: vx, y: vy });
      return id;
    }

    interact(id, clientData) {
      const player = this.objects.get(id);
      if (!player) return;

      const mouseX = clientData.mouseX || 0;
      const mouseY = clientData.mouseY || 0;
      const range = 300;
      const mouseDistance = this.distanceBetween(0, 0, mouseX, mouseY);
      const item = player.inventory?.[player.selSlot];

      if (item === "pistol") {
        this.createBullet(
          player.x + player.width / 2,
          player.y + player.height / 2,
          mouseX / 50,
          mouseY / 50,
          { dmg: 12, owner: id, livetime: 100 }
        );
      } else if (item === "block" && mouseDistance < range) {
        const width = 50;
        const height = 50;
        let x = player.x + player.width / 2 + mouseX;
        let y = player.y + player.height / 2 + mouseY;
        x = Math.floor(x / width) * width;
        y = Math.floor(y / height) * height;

        let occupied = false;
        this.objects.forEach((obj) => {
          if (this.posInObj(x + width / 2, y + height / 2, obj)) {
            occupied = true;
          }
        });

        if (!occupied) {
          this.createObject(
            Math.floor(Math.random() * 100000),
            this.createObj(x, y, width, height, "static", "block", "gray")
          );
        }
      }
    }

    getWorldFor(clientId) {
      const world = {};
      this.objects.forEach((obj, id) => {
        if (obj.ismap) return;

        world[id] = {
          x: Math.round(obj.x),
          y: Math.round(obj.y),
          width: obj.width,
          height: obj.height,
          vx: Math.round(obj.vx),
          vy: Math.round(obj.vy),
          onGround: obj.onGround,
          type: obj.type,
          color: obj.color,
        };

        if (id === clientId) {
          world[id].hp = Math.round(obj.health);
          world[id].inv = obj.inventory;
          world[id].invsize = obj.inventorysize;
        }
        if (obj.nickname) world[id].nickname = obj.nickname;
        if (obj.text) world[id].text = obj.text;
        if (obj.textColor) world[id].textColor = obj.textColor;
      });
      return world;
    }

    getMapWorld() {
      const world = {};
      this.objects.forEach((obj, id) => {
        if (!obj.ismap) return;

        world[id] = {
          x: Math.round(obj.x),
          y: Math.round(obj.y),
          width: obj.width,
          height: obj.height,
          type: obj.type,
          color: obj.color,
        };

        if (obj.text) world[id].text = obj.text;
        if (obj.textColor) world[id].textColor = obj.textColor;
      });
      return world;
    }
  }

  return CubixGameEngine;
});
