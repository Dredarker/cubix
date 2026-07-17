export let config = {
	// name of server (string)
	name: "Dreder's Cubix Server",
	// description of server (string)
	description: "The official Cubix server",
	// can players have custom outfit? (boolean)
	allowPlayerOutfit: true,
	// how many players can play on this server (int)
	maxPlayersCount: 10,
	game: {
		// how fast falles player and objects (int)
		gravity: 0.4,
		// use other collision model? (boolean)
		useNewCollisionModel: true,
	},
	player: {
		// players' outfit, if allowPlayerOutfit is false (string/object)
		colorDefault: "gray",
		// where players spawns (int)
		startX: 0,
		startY: -100,
		// what a items will get player after joining (array[strings])
		inventory: ["pickaxe", "block", "pistol"],
		// how many items can have player (int)
		invsize: 5,
	},
	// Webhooks' URLs
	webhook: {
		logs: process.env.logWebhook,
	}
}
