export let config = {
	// name of server (string)
	name: "Test Cubix",
	// description of server (string)
	description: "test zone",
	// can players have custom outfit? (boolean)
	allowPlayerOutfit: false,
	// how many players can play on this server (int)
	maxPlayersCount: 4,
	game: {
		// how fast falles player and objects (int)
		gravity: 0.3,
		// use other collision model? (boolean)
		useNewCollisionModel: false,
	},
	player: {
		// players' outfit, if allowPlayerOutfit is false (string/object)
		colorDefault: "gray",
		// where players spawns (int)
		startX: 0,
		startY: -1000,
		// what a items will get player after joining (array[strings])
		inventory: ["pickaxe", "block", "block", "pistol"],
		// how many items can have player (int)
		invsize: 7,
	},
}
