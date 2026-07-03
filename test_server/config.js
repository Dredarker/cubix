export let config = {
	name: "Dreder's Cubix Server",                 // name of server (string)
	description: "The official Cubix server",      // description of server (string)
	allowPlayerOutfit: false,                      // can players have custom outfit? (boolean)
	maxPlayersCount: 10,                           // how many players can play on this server (int)
	game: {
		gravity: 0.4,                              // how fast falles player and objects (int)
		useNewCollisionModel: true,                // use other collision model? (boolean)
	},
	player: {
		colorDefault: "gray",                      // players' outfit, if allowPlayerOutfit is false (string/object)
		startX: 0,                                 // where players spawns (int)
		startY: -100,                              // ^^^^^^^^^^^^^^^^^
		inventory: ["pickaxe", "block", "pistol"], // what a items will get player after joining (array[strings])
		invsize: 5,                                // how many items can have player (int)
	},
}
