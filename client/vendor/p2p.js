(() => {
  "use strict";

  const MASTER_SERVER = "game-server-3k6f.onrender.com";
  const DEFAULT_GAME_CONFIG = {
    allowPlayerOutfit: true,
    game: { gravity: 0.9, useNewCollisionModel: true },
    player: {
      colorDefault: "gray",
      startX: 0,
      startY: -100,
      inventory: ["pickaxe", "block", "pistol"],
      invsize: 5,
    },
    timeout: { chat: [3, 2, 10] },
  };
  const RTC_CONFIG = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };

  class P2PDirectory {
    constructor() {
      this.socket = null;
      this.connectPromise = null;
      this.pendingRegister = null;
      this.pendingJoin = null;
      this.onRooms = null;
      this.onPeerJoin = null;
      this.onPeerLeft = null;
      this.onSignal = null;
      this.onRoomClosed = null;
    }

    connect() {
      if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
      if (this.connectPromise) return this.connectPromise;

      this.connectPromise = new Promise((resolve, reject) => {
        const socket = new WebSocket("wss://" + MASTER_SERVER);
        this.socket = socket;
        const timeout = setTimeout(() => {
          if (socket.readyState !== WebSocket.OPEN) {
            reject(new Error("P2P directory connection timed out."));
            socket.close();
          }
        }, 12000);

        socket.onopen = () => {
          clearTimeout(timeout);
          socket.send(JSON.stringify({ type: "p2p", action: "list" }));
          resolve();
        };

        socket.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Cannot connect to the P2P directory server."));
        };

        socket.onclose = () => {
          clearTimeout(timeout);
          this.connectPromise = null;
          if (this.socket === socket) this.socket = null;
        };

        socket.onmessage = (event) => {
          let message;
          try {
            message = JSON.parse(event.data);
          } catch {
            return;
          }
          if (message.type !== "p2p") return;

          switch (message.action) {
            case "rooms":
              this.onRooms?.(message.rooms || []);
              break;
            case "registered":
              this.pendingRegister?.resolve(message.room);
              this.pendingRegister = null;
              break;
            case "joined":
              this.pendingJoin?.resolve(message);
              this.pendingJoin = null;
              break;
            case "peer-join":
              this.onPeerJoin?.(message.peerId);
              break;
            case "peer-left":
              this.onPeerLeft?.(message.peerId);
              break;
            case "signal":
              this.onSignal?.(message.peerId, message.signal);
              break;
            case "room-closed":
              this.onRoomClosed?.(message.roomId);
              break;
            case "error": {
              const error = new Error(message.message || "P2P operation failed.");
              this.pendingRegister?.reject(error);
              this.pendingJoin?.reject(error);
              this.pendingRegister = null;
              this.pendingJoin = null;
              break;
            }
          }
        };
      });

      return this.connectPromise;
    }

    send(action, payload = {}) {
      if (this.socket?.readyState !== WebSocket.OPEN) {
        throw new Error("P2P directory is not connected.");
      }
      this.socket.send(JSON.stringify({ type: "p2p", action, ...payload }));
    }

    register(room) {
      return new Promise((resolve, reject) => {
        this.pendingRegister = { resolve, reject };
        this.send("register", { room });
        setTimeout(() => {
          if (this.pendingRegister?.resolve === resolve) {
            this.pendingRegister = null;
            reject(new Error("The room registration timed out."));
          }
        }, 10000);
      });
    }

    join(roomId) {
      return new Promise((resolve, reject) => {
        this.pendingJoin = { resolve, reject };
        this.send("join", { roomId });
        setTimeout(() => {
          if (this.pendingJoin?.resolve === resolve) {
            this.pendingJoin = null;
            reject(new Error("The room join request timed out."));
          }
        }, 10000);
      });
    }

    signal(peerId, signal) {
      this.send("signal", { peerId, signal });
    }

    close() {
      if (this.socket) {
        this.socket.close();
        this.socket = null;
      }
      this.connectPromise = null;
    }
  }

  class HostP2PTransport {
    constructor(options) {
      this.options = options;
      this.directory = options.directory;
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      this.game = new window.CubixGameEngine(
        window.CUBIX_GAME_CONFIG || DEFAULT_GAME_CONFIG
      );
      this.hostId = "host_" + options.room.id;
      this.hostClient = { mouseX: 0, mouseY: 0, timeout: { chat: 0 } };
      this.hostJoined = false;
      this.hostNickname = "";
      this.frames = 0;
      this.chatFrames = 0;
      this.peers = new Map();
      this.interval = null;
      this.closed = false;
      this.directory.onPeerJoin = (peerId) => this.createPeer(peerId);
      this.directory.onSignal = (peerId, signal) => this.handleSignal(peerId, signal);
      this.directory.onPeerLeft = (peerId) => this.removePeer(peerId, false);
      this.directory.onRoomClosed = () => this.close(4000, "Room closed");
      this.interval = setInterval(() => this.tick(), 1000 / 60);
      queueMicrotask(() => {
        if (this.closed) return;
        this.readyState = 1;
        this.onopen?.();
      });
    }

    send(raw) {
      if (this.readyState !== 1 || this.closed) return;
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }

      if (data.type === "join" && !this.hostJoined) {
        this.hostJoined = true;
        const nickname = this.cleanNickname(data.nickname);
        if (!nickname) {
          this.close(1008, "Invalid nickname");
          return;
        }
        this.hostNickname = nickname;
        const color = this.game.config.allowPlayerOutfit
          ? data.color
          : this.game.config.player.colorDefault;
        this.game.addPlayer(this.hostId, nickname, color);
        this.emit({ type: "init", clientId: this.hostId, nickname });
        this.emit({ type: "map", world: this.game.getMapWorld() });
        this.broadcastMessage("", nickname + " created a P2P server");
        return;
      }

      if (data.type === "sync") {
        this.game.handleSync(this.hostId, data, this.hostClient);
      } else if (data.type === "msg") {
        this.handleChat(this.hostId, this.hostClient, data.text);
      } else if (data.type === "interact_LMB") {
        this.game.interact(this.hostId, this.hostClient);
      } else if (data.type === "getclients") {
        this.emit({
          type: "getclients",
          text: [this.hostNickname, ...[...this.peers.values()]
            .filter(peer => peer.joined)
            .map(peer => peer.nickname)],
        });
      } else if (data.type === "console") {
        this.runConsole(data);
      }
    }

    cleanNickname(value) {
      const allowed = "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЮЯабвгдеёжзийклмнопрстуфхцчшщъыьABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890!№;%:?*()_+@#$^&-=.\\[]{}~";
      const nickname = [...String(value || "")]
        .filter(char => allowed.includes(char))
        .join("");
      if (nickname.length < 3 || nickname.length > 20) return "";
      const duplicate = [...this.peers.values()].some(
        peer => peer.joined && peer.nickname === nickname
      );
      return duplicate || (this.hostJoined && nickname === this.hostNickname)
        ? ""
        : nickname;
    }

    emit(message) {
      if (this.readyState === 1) {
        this.onmessage?.({ data: JSON.stringify(message) });
      }
    }

    broadcast(message) {
      this.emit(message);
      const encoded = JSON.stringify(message);
      for (const peer of this.peers.values()) {
        if (peer.joined && peer.channel?.readyState === "open") {
          try {
            peer.channel.send(encoded);
          } catch (error) {
            console.warn("[Cubix P2P] Data channel send failed:", error);
          }
        }
      }
    }

    broadcastMessage(from, text) {
      this.broadcast({ type: "msg", from, text });
    }

    handleChat(id, client, value) {
      const text = String(value || "");
      const chatLimits = this.game.config.timeout?.chat || [3, 2];
      if (text.length > 250 || client.timeout.chat >= chatLimits[0]) return;
      client.timeout.chat++;
      const nickname = id === this.hostId
        ? this.hostNickname
        : this.peers.get(id)?.nickname;
      this.broadcastMessage(nickname || "", text);
    }

    runConsole(data) {
      let result;
      const engine = this.game;
      function Obj(...args) {
        return engine.createObj(...args);
      }
      function Text(text, textColor, obj) {
        return engine.createText(text, textColor, obj);
      }
      function Player(nickname, speed, jumpPower, obj) {
        return engine.createPlayer(nickname, speed, jumpPower, obj);
      }
      function createNPC(name, x, y, color = {}) {
        return engine.createNPC(name, x, y, color);
      }

      try {
        const execute = new Function(
          "objects", "Obj", "Text", "Player",
          "createObject", "removeObject", "addBody", "syncObjectFromBody",
          "createNPC", "createBullet", "updatePhysics", "updateNPCs",
          "updateGroundState", "distanceBetween", "posInObj",
          "findNearestPlayer", "engine",
          "return eval(" + JSON.stringify(String(data.msg || "")) + ");"
        );
        result = execute(
          engine.objects,
          Obj,
          Text,
          Player,
          engine.createObject.bind(engine),
          engine.removeObject.bind(engine),
          engine.addBody.bind(engine),
          engine.syncObjectFromBody.bind(engine),
          createNPC,
          engine.createBullet.bind(engine),
          engine.updatePhysics.bind(engine),
          engine.updateNPCs.bind(engine),
          engine.updateGroundState.bind(engine),
          engine.distanceBetween.bind(engine),
          engine.posInObj.bind(engine),
          engine.findNearestPlayer.bind(engine),
          engine
        );
        try {
          result = JSON.stringify(result);
        } catch {
          result = String(result);
        }
      } catch (error) {
        result = String(error);
      }
      this.emit({ type: "console", text: result });
    }

    createPeer(peerId) {
      if (this.closed || this.peers.has(peerId)) return;
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const peer = {
        pc,
        channel: null,
        playerId: null,
        nickname: "",
        joined: false,
        client: { mouseX: 0, mouseY: 0, timeout: { chat: 0 } },
        pendingCandidates: [],
      };
      this.peers.set(peerId, peer);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.directory.signal(peerId, { candidate: event.candidate });
        }
      };
      pc.ondatachannel = (event) => {
        peer.channel = event.channel;
        peer.channel.onmessage = (messageEvent) =>
          this.handlePeerMessage(peerId, messageEvent.data);
        peer.channel.onclose = () => this.removePeer(peerId, true);
        peer.channel.onerror = () => this.removePeer(peerId, true);
      };
      pc.onconnectionstatechange = () => {
        if (["failed", "closed"].includes(pc.connectionState)) {
          this.removePeer(peerId, true);
        }
      };
    }

    async handleSignal(peerId, signal) {
      const peer = this.peers.get(peerId);
      if (!peer || !signal) return;

      try {
        if (signal.description) {
          await peer.pc.setRemoteDescription(signal.description);
          for (const candidate of peer.pendingCandidates.splice(0)) {
            await peer.pc.addIceCandidate(candidate);
          }
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          this.directory.signal(peerId, { description: peer.pc.localDescription });
        } else if (signal.candidate) {
          if (peer.pc.remoteDescription) {
            await peer.pc.addIceCandidate(signal.candidate);
          } else {
            peer.pendingCandidates.push(signal.candidate);
          }
        }
      } catch (error) {
        console.error("[Cubix P2P] Signaling error:", error);
        this.removePeer(peerId, true);
      }
    }

    handlePeerMessage(peerId, raw) {
      const peer = this.peers.get(peerId);
      if (!peer) return;

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return;
      }

      if (!peer.joined) {
        if (data.type !== "join" || this.peers.size > this.options.maxPlayers - 1) {
          peer.channel?.close();
          return;
        }
        const nickname = this.cleanNickname(data.nickname);
        if (!nickname) {
          peer.channel?.close();
          return;
        }

        const color = this.game.config.allowPlayerOutfit
          ? data.color
          : this.game.config.player.colorDefault;
        peer.nickname = nickname;
        peer.playerId = peerId;
        peer.joined = true;
        this.game.addPlayer(peer.playerId, nickname, color);
        this.sendToPeer(peer, {
          type: "init",
          clientId: peer.playerId,
          nickname,
        });
        this.sendToPeer(peer, { type: "map", world: this.game.getMapWorld() });
        this.broadcastMessage("", nickname + " connected to game");
        return;
      }

      if (data.type === "sync") {
        this.game.handleSync(peer.playerId, data, peer.client);
      } else if (data.type === "msg") {
        this.handleChat(peer.playerId, peer.client, data.text);
      } else if (data.type === "interact_LMB") {
        this.game.interact(peer.playerId, peer.client);
      } else if (data.type === "getclients") {
        this.sendToPeer(peer, {
          type: "getclients",
          text: [this.hostNickname, ...[...this.peers.values()]
            .filter(item => item.joined)
            .map(item => item.nickname)],
        });
      }
    }

    sendToPeer(peer, message) {
      if (peer.channel?.readyState !== "open") return;
      try {
        peer.channel.send(JSON.stringify(message));
      } catch (error) {
        console.warn("[Cubix P2P] Data channel send failed:", error);
      }
    }

    removePeer(peerId, notifyDirectory) {
      const peer = this.peers.get(peerId);
      if (!peer) return;

      this.peers.delete(peerId);
      if (peer.joined) {
        this.game.removePlayer(peer.playerId);
        this.broadcastMessage("", peer.nickname + " disconnected from game");
      }
      try {
        peer.pc.close();
      } catch {}
      if (notifyDirectory) {
        try {
          this.directory.send("peer-left", { peerId });
        } catch {}
      }
    }

    tick() {
      if (this.closed) return;
      try {
        this.game.updatePhysics();
      } catch (error) {
        console.error("[Cubix P2P] Game engine error:", error);
        this.broadcastMessage("", "Game engine error: " + error.message);
        return;
      }

      this.frames++;
      this.chatFrames++;

      const chatInterval = (this.game.config.timeout?.chat?.[1] || 2) * 60;
      if (this.chatFrames >= chatInterval) {
        this.chatFrames = 0;
        for (const peer of this.peers.values()) {
          if (peer.client.timeout.chat > 0) peer.client.timeout.chat--;
        }
        if (this.hostClient.timeout.chat > 0) this.hostClient.timeout.chat--;
      }

      let objectCount = 0;
      this.game.objects.forEach(obj => {
        if (!obj.ismap) objectCount++;
      });
      const framesToSync = Math.floor(objectCount / 10) + 1;
      if (this.frames % framesToSync !== 0) return;

      this.emit({
        type: "sync",
        world: this.game.getWorldFor(this.hostId),
      });
      for (const peer of this.peers.values()) {
        if (peer.joined) {
          this.sendToPeer(peer, {
            type: "sync",
            world: this.game.getWorldFor(peer.playerId),
          });
        }
      }
    }

    close(code = 1000, reason = "P2P host closed") {
      if (this.closed) return;
      this.closed = true;
      clearInterval(this.interval);
      for (const peerId of [...this.peers.keys()]) {
        this.removePeer(peerId, false);
      }
      try {
        this.directory.send("unregister");
      } catch {}
      this.game.removePlayer(this.hostId);
      this.readyState = 3;
      this.onclose?.({ code, reason });
    }
  }

  class GuestP2PTransport {
    constructor(options) {
      this.options = options;
      this.directory = options.directory;
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      this.pc = null;
      this.channel = null;
      this.peerId = null;
      this.pendingCandidates = [];
      this.closed = false;
      this.connect();
    }

    async connect() {
      try {
        await this.directory.connect();
        this.directory.onSignal = (peerId, signal) => {
          if (peerId === this.peerId) this.handleSignal(signal);
        };
        this.directory.onRoomClosed = () =>
          this.fail(new Error("The host closed this room."));
        const joined = await this.directory.join(this.options.room.id);
        this.peerId = joined.peerId;
        this.pc = new RTCPeerConnection(RTC_CONFIG);
        this.pc.onicecandidate = (event) => {
          if (event.candidate) {
            this.directory.signal(this.peerId, { candidate: event.candidate });
          }
        };
        this.pc.onconnectionstatechange = () => {
          if (["failed", "closed"].includes(this.pc.connectionState)) {
            this.fail(new Error("WebRTC connection to the host was lost."));
          }
        };
        this.channel = this.pc.createDataChannel("cubix-game", { ordered: true });
        this.channel.onopen = () => {
          if (this.closed) return;
          this.readyState = 1;
          this.onopen?.();
        };
        this.channel.onmessage = (event) => {
          this.onmessage?.({ data: event.data });
        };
        this.channel.onclose = () => {
          if (!this.closed) this.fail(new Error("Connection to the host closed."));
        };

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.directory.signal(this.peerId, {
          description: this.pc.localDescription,
        });
      } catch (error) {
        this.fail(error);
      }
    }

    async handleSignal(signal) {
      if (!this.pc || !signal) return;

      try {
        if (signal.description) {
          await this.pc.setRemoteDescription(signal.description);
          for (const candidate of this.pendingCandidates.splice(0)) {
            await this.pc.addIceCandidate(candidate);
          }
        } else if (signal.candidate) {
          if (this.pc.remoteDescription) {
            await this.pc.addIceCandidate(signal.candidate);
          } else {
            this.pendingCandidates.push(signal.candidate);
          }
        }
      } catch (error) {
        this.fail(error);
      }
    }

    send(raw) {
      if (this.readyState !== 1 || this.channel?.readyState !== "open") return;
      this.channel.send(raw);
    }

    fail(error) {
      if (this.closed) return;
      this.closed = true;
      console.error("[Cubix P2P]", error);
      this.onerror?.(error);
      this.close(4001, error.message);
    }

    close(code = 1000, reason = "Disconnected") {
      if (this.closed && this.readyState === 3) return;
      this.closed = true;
      try {
        if (this.peerId) this.directory.send("leave");
      } catch {}
      try {
        this.channel?.close();
        this.pc?.close();
      } catch {}
      this.directory.close();
      this.readyState = 3;
      this.onclose?.({ code, reason });
    }
  }

  let p2pDirectory = null;
  let hostedP2PTransport = null;
  let hostedP2PRoomId = null;

  function setP2PStatus(message, color = "white") {
    const status = document.getElementById("p2pStatus");
    if (!status) return;
    status.textContent = message;
    status.style.color = color;
  }

  function renderP2PRooms(rooms) {
    const list = document.getElementById("P2PsServers");
    if (!list) return;
    list.replaceChildren();

    if (!rooms.length) {
      const empty = document.createElement("p");
      empty.textContent = "No active P2P servers";
      list.append(empty);
      return;
    }

    for (const room of rooms) {
      const tile = document.createElement("div");
      tile.className = "serverLine";
      tile.style.cursor = "pointer";
      tile.style.margin = "6px auto";
      tile.style.padding = "6px";
      tile.style.boxSizing = "border-box";

      const title = document.createElement("b");
      title.textContent = room.name;
      tile.append(title);

      const description = document.createElement("p");
      description.textContent = room.description || "No description";
      tile.append(description);

      const players = document.createElement("p");
      players.textContent = String(room.playersOnline) + "/" + String(room.maxPlayers) + " players";
      tile.append(players);

      if (room.id === hostedP2PRoomId) {
        const own = document.createElement("p");
        own.textContent = "Your server";
        own.style.fontWeight = "bold";
        tile.append(own);
      } else if (room.playersOnline >= room.maxPlayers) {
        tile.style.opacity = "0.55";
        const full = document.createElement("p");
        full.textContent = "Server is full";
        tile.append(full);
      } else {
        tile.onclick = () => joinP2PRoom(room);
      }

      list.append(tile);
    }
  }

  async function ensureP2PDirectory() {
    if (!p2pDirectory) {
      p2pDirectory = new P2PDirectory();
      p2pDirectory.onRooms = renderP2PRooms;
    }
    await p2pDirectory.connect();
    return p2pDirectory;
  }

  function showP2PModal() {
    document.getElementById("p2pModal").style.display = "flex";
    document.getElementById("p2pRoomName").focus();
  }

  function hideP2PModal() {
    document.getElementById("p2pModal").style.display = "none";
  }

  async function createP2PServer() {
    const name = document.getElementById("p2pRoomName").value.trim();
    const description = document.getElementById("p2pRoomDescription").value.trim();
    const maxPlayers = Number(document.getElementById("p2pMaxPlayers").value);

    if (!(nicknameInput.value.length >= 3 && nicknameInput.value.length <= 20)) {
      hideP2PModal();
      error.textContent = "Nickname's length need be 3 - 20";
      return;
    }
    if (!name || name.length > 40) {
      setP2PStatus("Room name must contain 1–40 characters.", "red");
      return;
    }
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 16) {
      setP2PStatus("Maximum players must be between 2 and 16.", "red");
      return;
    }

    const button = document.getElementById("p2pCreateButton");
    button.disabled = true;
    button.value = "Creating...";
    setP2PStatus("Connecting to the P2P directory...");
    try {
      const directory = await ensureP2PDirectory();
      const room = await directory.register({ name, description, maxPlayers });
      hostedP2PRoomId = room.id;
      hideP2PModal();
      const transport = new HostP2PTransport({
        room,
        directory,
        nickname: nicknameInput.value,
        maxPlayers,
      });
      hostedP2PTransport = transport;
      runGame(transport);
      setP2PStatus("P2P server is online.", "#174f17");
    } catch (error) {
      console.error("[Cubix P2P] Cannot create room:", error);
      setP2PStatus(error.message, "red");
    } finally {
      button.disabled = false;
      button.value = "Create Server";
    }
  }

  async function joinP2PRoom(room) {
    if (!(nicknameInput.value.length >= 3 && nicknameInput.value.length <= 20)) {
      error.textContent = "Nickname's length need be 3 - 20";
      return;
    }

    setP2PStatus("Connecting to " + room.name + "...");
    const directory = new P2PDirectory();
    const transport = new GuestP2PTransport({ room, directory });
    runGame(transport);
  }

  document.getElementById("createP2PButton").addEventListener("click", showP2PModal);
  document.getElementById("p2pCancelButton").addEventListener("click", hideP2PModal);
  document.getElementById("p2pCreateButton").addEventListener("click", createP2PServer);
  document.getElementById("p2pModal").addEventListener("click", (event) => {
    if (event.target.id === "p2pModal") hideP2PModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.code === "Escape") hideP2PModal();
  });

  ensureP2PDirectory().catch((error) => {
    setP2PStatus("P2P directory unavailable: " + error.message, "red");
  });

  window.CubixP2P = {
    P2PDirectory,
    HostP2PTransport,
    GuestP2PTransport,
    ensureP2PDirectory,
    createP2PServer,
    joinP2PRoom,
  };

  window.addEventListener("beforeunload", () => {
    if (hostedP2PTransport) {
      try {
        hostedP2PTransport.directory.send("unregister");
      } catch {}
    }
  });
})();
