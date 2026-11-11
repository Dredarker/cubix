# Cubix

Cubix is a small browser-based multiplayer platformer.

## P2P servers

The client can create and join browser-hosted P2P rooms from the **P2Ps** section.

- The room host runs the authoritative game simulation in their browser.
- Players exchange the existing Cubix JSON game packets over a WebRTC data channel.
- `game-server-3k6f.onrender.com` acts as the room directory and WebRTC signaling endpoint. It does not relay game-state traffic.
- The host's browser must stay open for the room to remain available.
- Room listings are in memory and disappear when the signaling server restarts or the host disconnects.
- The client loads Matter.js from jsDelivr. STUN is configured for NAT traversal; restrictive networks may also require a TURN server.

The shared simulation code is in `shared/game-engine.js`; the Node.js WebSocket server and browser P2P host both use it.
