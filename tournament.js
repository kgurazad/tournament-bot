const Discord = require('discord.js');
const fs = require('fs');
const {GoogleSpreadsheet}  = require('google-spreadsheet');
const parseUrl = require('parse-url');
const client = new Discord.Client();
const config = JSON.parse(String(fs.readFileSync('config.json')));

var helpSections = {
    'i': {
	name: 'Initialize Server',
	value: 'This command __deletes every preexisting channel and role in the server__ and replaces them with a predetermined tournament server skeleton. The Tournament Bot role needs to be the highest in the server for this command to run properly. This command can only be run by the server owner.\nExample bot-style usage: `.i`\nExample NL-style usage: `.initialize-server`'
    },
    'c': {
	name: 'Create Room[s]',
	value: 'This command can only be run by users with the Control Room role. Room names must be less than 90 characters long. Surround the room names with double quotation marks. If you want to create multiple rooms at a time, separate the room names with spaces. \nExample bot-style usage: `.c "Room 1" "Room 2"`\nExample NL-style usage: `.create "Room 1" "Room 2"`'
    },
    'f': {
	name: 'Create Finals Room',
	value: 'This command creates a special finals room that contains a channel for the playing teams to type in and a channel for everyone else to comment in. The command requires you to tag the two teams who are competing in the finals. Teams cannot be added or removed from a finals room. This command can only be run by users with the Control Room role.\nExample bot-style usage: `.f @A2 @B1`\nExample NL-style usage: `.finals @A2 and @B1`'
    },
    'd': {
	name: 'Delete Room',
	value: 'This command can only be run by users with the Control Room role.\nExample bot-style usage: `.d #room-1`\nExample NL-style usage: `.delete Room 1`'
    },
    'n': {
	name: 'Create/Delete Team',
	value: 'Team roles can be created manually in your tournament server\'s settings. Make sure all team roles are __below__ the Spectator role but __above__ the Player/Coach role, do not use any pre-existing role names, and are mentionable.'
    },
    'm': {
	name: 'Mass Create Teams',
	value: 'This command can only be run by users with the Control Room role. Specify a prefix and a range of numbers using this notation: `Prefix[Start...End]`. The bot will automatically create roles for each number in the specified range and randomly assign colors.\nExample bot-style usage: `.m A[1...8]`\nExample NL-style usage: `.mass-create-teams A[1...8]`'
    },
    's': {
	name: 'Create Room Schedules from Google Sheets',
	value: 'This command can only be run by users with the Control Room role. This command is fairly complicated, so ask Karan how to use it.'
    },
    'a': {
	name: 'Add Team to Room',
	value: 'Example bot-style usage: `.a @A2 #room-1`\nExample NL-style usage: `.add @A2 to #room-1`'
    },
    'r': {
	name: 'Remove Team from Room',
	value: 'Example bot-style usage: `.r @A2 #room-1`\nExample NL-style usage: `.remove @A2 from #room-1`'
    },
    't': {
	name: 'Transfer Team between Rooms',
	value: 'This command requires you to tag two channels; tag the room that you are transferring the team __from__ first, and tag the channel that you are transferring the team __to__ second.\nExample bot-style usage: `.t @A2 #room-1 #room-3`\nExample NL-style usage: `.transfer @A2 from #room-1 to #room-3`'
    },
    'e': {
	name: 'Empty Room',
	value: 'This command removes all teams from a given room.\nExample bot-style usage: `.e #room-1`\nExample NL-style usage: `.empty #room-1`'
    },
    'h': {
	name: 'Display This Help',
	value: 'Example bot-style usage: `.h`\nExample NL-style usage: `.help`'
    }
}

var lockPerms = async function (channel) {
    // syncs channel's perms with its parent category
    await channel.lockPermissions();
    await channel.lockPermissions();
    await channel.lockPermissions();
    await channel.lockPermissions();
}

var add = async function (role, to) {
    await to.updateOverwrite(role, {
	'VIEW_CHANNEL': true,
	'SEND_MESSAGES': true,
	'CONNECT': true,
	'ADD_REACTIONS': true,
	'USE_EXTERNAL_EMOJIS': true,
	'ATTACH_FILES': true,
	'EMBED_LINKS': true
    });
    var children = to.children.array();
    await lockPerms(children[0]);
    await lockPerms(children[1]);
    return;
}

var remove = async function (role, from) {
    await from.updateOverwrite(role, {
	'VIEW_CHANNEL': false,
	'SEND_MESSAGES': false,
	'CONNECT': false,
	'ADD_REACTIONS': false,
	'USE_EXTERNAL_EMOJIS': false,
	'ATTACH_FILES': false,
	'EMBED_LINKS': false
    });
    var	children = from.children.array();
    await lockPerms(children[0]);
    await lockPerms(children[1]);
    return;
}

var empty = async function (room) {
    var overwrites = room.permissionOverwrites.array();
    for (var overwrite of overwrites) {
	var role = await room.guild.roles.fetch(overwrite.id);
	try {
	    //	    console.log(role.name);
	    if (role.name !== '@everyone' && role.name !== 'Staff' && role.name !== 'Spectator') {
		await overwrite.delete();
	    }
	} catch (e) {
	    // user overwrite, i guess
	    console.log(role);
	    await overwrite.delete();
	}
    }
    var children = room.children.array();
    await lockPerms(children[0]);
    await lockPerms(children[1]);
    return;
}

var createRoom = async function (guild, name) {
    var category = await guild.channels.create(name, {type: 'category'});
    await category.updateOverwrite(guild.roles.everyone, {
	'VIEW_CHANNEL': false
    });
    var staffRole = 0, spectatorRole = 0;
    for (var role of guild.roles.cache.array()) {
	if (role.name === 'Staff' && staffRole === 0) {
	    staffRole = role;
	} else if (role.name === 'Spectator' && spectatorRole === 0) {
	    spectatorRole = role;
	}
    }
    await category.updateOverwrite(staffRole, {
	'VIEW_CHANNEL':	true
    });
    await category.updateOverwrite(spectatorRole, {
	'VIEW_CHANNEL': true
    });
    var cleanName = name.replace(/\s+/g, '-').toLowerCase();
    var text = await guild.channels.create(cleanName + '-text', {parent: category});
    var voice = await guild.channels.create(cleanName + '-voice', {parent: category, type: 'voice'});
    return text;
}

var deleteRoom = async function (text) {
    var category = text.parent;
    var name = category.name;
    for (var channel of category.children.array()) {
	await channel.delete();
    }
    await category.delete();
    return name;
}

var finalsRoom = async function (guild, team1, team2) {
    var staffRole = 0, spectatorRole = 0, playerCoachRole = 0;
    var teamRoles = [];
    await guild.roles.fetch();
    for (var role of guild.roles.cache.array()) {
	if (role.name === 'Staff' && staffRole === 0) {
	    staffRole = role;
	} else if (role.name === 'Spectator' && spectatorRole === 0) {
	    spectatorRole = role;
	} else if (role.name === 'Player/Coach' && playerCoachRole === 0) {
	    playerCoachRole = role;
	} else if (role.name !== '@everyone' && role.name !== 'Tournament Bot' && role.name !== 'Yuki' && role.members.array().length > 0) {
	    teamRoles.push(role);
	}
    }
    var category = await guild.channels.create('Finals', {type: 'category', position: 3});
    await category.updateOverwrite(guild.roles.everyone, {
	'VIEW_CHANNEL': false
    });
    await category.updateOverwrite(staffRole, {
	'VIEW_CHANNEL':	true
    });
    await category.updateOverwrite(spectatorRole, {
	'VIEW_CHANNEL':	true
    });
    await category.updateOverwrite(playerCoachRole, {
	'VIEW_CHANNEL':	true
    });
    var gameText = await guild.channels.create('finals-text', {parent: category});
    await gameText.updateOverwrite(spectatorRole, {
	'SEND_MESSAGES': false
    });
    await gameText.updateOverwrite(playerCoachRole, {
	'SEND_MESSAGES': false
    });
    await gameText.updateOverwrite(team1, {
	'SEND_MESSAGES': true
    });
    await gameText.updateOverwrite(team2, {
	'SEND_MESSAGES': true
    });
    var audienceText = await guild.channels.create('finals-audience', {parent: category});
    // ideally the team1 and team2 overwrites would override the category playerCoach overwrite, meaning that team1/team2  would be unable to see #finals-audience
    // however, it doesn't seem discord permissions works that way? even if team1/team2 are set to VIEW_CHANNEL: false and playerCoach is set to true, team1/team2 can still see
    // this solution is somewhat hackish
    // it gives every non-team1/team2 team permissions to view and takes away view permissions from the general player/coach role
    // this solution assumes every player is given a team; if that's not the case, it won't work perfectly
    // it's better than letting the teams see the audience chat though; allowing that might result in some form of cheating
    await audienceText.updateOverwrite(team1, {
	'VIEW_CHANNEL': false
    });
    await audienceText.updateOverwrite(team2, {
	'VIEW_CHANNEL': false
    });
    await audienceText.updateOverwrite(playerCoachRole, {
	'VIEW_CHANNEL': false
    });
    for (var team of teamRoles) {
	if (team !== team1 && team !== team2) {
	    await audienceText.updateOverwrite(team, {
		'VIEW_CHANNEL': true
	    });
	}
    }
    var voice = await guild.channels.create('finals-voice', {parent: category, type: 'voice'});
    /*
      await voice.updateOverwrite(spectatorRole, {
      'SPEAK': false
      });
      await voice.updateOverwrite(playerCoachRole, {
      'SPEAK': false
      });
    */
    return gameText;
} // todo

var init = async function (guild) {
    // basic setup of the tournament server
    // todo clear all existing stuff in the server
    await guild.setDefaultMessageNotifications('MENTIONS');
    var existingRoles = guild.roles.cache.array(); // does this really load all the roles? cache business confuses me D:
    for (var role of existingRoles) {
	if (role.name !== '@everyone' && role.name !== 'Tournament Bot' && role.name !== 'Yuki' && role.name !== 'Server Booster') {
	    try {
		await role.delete();
	    } catch (e) {
		console.error('could not delete role: ' + role.name);
		console.error(e);
	    }
	}
    } // empty out existing roles so the correct ones can take their place
    existingChannels = guild.channels.cache.array(); // shrug
    for (var channel of existingChannels) {
	await channel.delete();
    }
    var controlRoomRole = await guild.roles.create({
	data: {
	    name: 'Control Room',
	    color: 'PURPLE',
	    hoist: true,
	    permissions: 'ADMINISTRATOR',
	    mentionable: true,
	    position: 1
	}
    });
    var staffRole = await guild.roles.create({
	data: {
	    name: 'Staff',
	    color: 'BLUE',
	    hoist: true,
	    mentionable: true,
	    position: 1
	}
    });
    var spectatorRole = await guild.roles.create({
	data: {
	    name: 'Spectator',
	    color: 'AQUA',
	    hoist: true,
	    mentionable: true,
	    position: 1
	}
    });
    var playerCoachRole = await guild.roles.create({
	data: {
	    name: 'Player/Coach',
	    color: 'RED',
	    hoist: true,
	    mentionable: true,
	    position: 1
	}
    });
    var controlRoomCategory = await guild.channels.create('Control Room', {type: 'category'});
    await controlRoomCategory.updateOverwrite(guild.roles.everyone, {
	'VIEW_CHANNEL': false
    });
    await controlRoomCategory.updateOverwrite(staffRole, {
	'VIEW_CHANNEL': true
    });
    var linksChannel = await guild.channels.create('announcements-and-links', {parent: controlRoomCategory});
    await linksChannel.updateOverwrite(staffRole, {
	'SEND_MESSAGES': false
    });
    /*
      var packetsChannel = await guild.channels.create('packets', {parent: controlRoomCategory});
      await packetsScoresheetsChannel.updateOverwrite(staffRole, {
      'SEND_MESSAGES': false
      });
    */
    var protestsChannel = await guild.channels.create('protests', {parent: controlRoomCategory});
    var botCommandsChannel = await guild.channels.create('bot-commands', {parent: controlRoomCategory});
    var controlRoomChannel = await guild.channels.create('control-room', {parent: controlRoomCategory});
    var controlRoomVoiceChannel = await guild.channels.create('control-room-voice', {parent: controlRoomCategory, type: 'voice'});
    var hubCategory = await guild.channels.create('Hub', {type: 'category'});
    await hubCategory.updateOverwrite(guild.roles.everyone, {
	'VIEW_CHANNEL': false
    });
    await hubCategory.updateOverwrite(staffRole, {
	'VIEW_CHANNEL': true
    });
    await hubCategory.updateOverwrite(spectatorRole, {
	'VIEW_CHANNEL': true
    });
    await hubCategory.updateOverwrite(playerCoachRole, {
	'VIEW_CHANNEL': true
    });
    // control room has implicit permissions
    var announcementsChannel = await guild.channels.create('announcements', {parent: hubCategory});
    await announcementsChannel.updateOverwrite(guild.roles.everyone, {
	'SEND_MESSAGES': false
    });
    var generalChannel = await guild.channels.create('general', {parent: hubCategory});
    var hallwayVoiceChannel = await guild.channels.create('hallway-voice', {parent: hubCategory, type: 'voice'});
    // todo set hub permissions
    var honorPledgeCategory = await guild.channels.create('Honor Pledge', {type: 'category'});
    /*
      await honorPledgeCategory.updateOverwrite(staffRole, {
      'SEND_MESSAGES': false
      });
      await honorPledgeCategory.updateOverwrite(spectatorRole, {
      'SEND_MESSAGES': false
      });
      await honorPledgeCategory.updateOverwrite(playerCoachRole, {
      'SEND_MESSAGES': false
      });
    */
    var honorPledgeChannel = guild.channels.create('honor-pledge', {parent: honorPledgeCategory});
    await guild.owner.roles.add(controlRoomRole);
}

var help = function (channel, sections) {
    sections = sections || ['i', 'c', 'f', 'd', 'n', 'm', 's', 'a', 'r', 't', 'e', 'h'];
    var helpMessage = {
	color: '#29bb9c', // same as discord aqua
	title: 'Tournament Bot Help',
	description: 'This bot is able to perform initial server setup, create and delete rooms, and add, remove, or transfer teams to and from rooms. It supports both conventional bot-style syntax and natural language-style [NL-style] syntax. Commands acting on existing teams or rooms require you to tag the role of the team you are operating on and/or the text channels representing the rooms you are operating on. Unless otherwise stated, commands can only be run by users with the Control Room or Staff roles.',
	fields: []
    };
    for (var section of sections) {
	helpMessage.fields.push(helpSections[section]);
    }
    if (sections.length < 9) {
	helpMessage.description = '';
    }
    channel.send({embed: helpMessage});
}

var schedule = async function (guild, docID, sheetIndex) {
    var doc = new GoogleSpreadsheet(docID);
    await doc.useApiKey(config.apiKey);
    await doc.loadInfo();
    var sheet = doc.sheetsByIndex[sheetIndex];
    await sheet.loadCells('a1:z26'); // up to 12 rooms and 24 rounds
    var rooms = {}; // key is column index from 0, value is room name
    for (var i = 1; i < 26; i++) { // cols B to Z
	var val = sheet.getCell(0, i).value;
	if (val) {
	    rooms[i] = {};
	    rooms[i]['name'] = val;
	    rooms[i]['teamsByRound'] = {};
	}
    }
    var rounds = {inOrder: []};
    var teams = {};
    for (var i = 1; i < 26; i++) {
	roundName = sheet.getCell(i, 0).value;
	if (!roundName) {
	    continue;
	} else {
	    rounds[i] = roundName;
	    rounds.inOrder.push(i);
	}
	for (var j = 1; j < 26; j++) {
	    var roomName = sheet.getCell(0, j).value;
	    if (!roomName) {
		continue;
	    }
	    var val1 = sheet.getCell(i, j).value;
	    var val2 = sheet.getCell(i, j + 1).value;
	    if (rooms[j] && val1 && val2) {
		rooms[j].teamsByRound[i] = [val1, val2];
	    } else if (rooms[j] && val1) {
		rooms[j].teamsByRound[i] = [val1];
	    } else {
		break;
	    }
	    if (teams[val1]) {
		teams[val1].roomsByRound[i] = j;
	    } else {
		teams[val1] = {
		    roomsByRound: {}
		};
		teams[val1].roomsByRound[i] = j;
	    }
	    if (teams[val2] && val2) {
		teams[val2].roomsByRound[i] = j;
	    } else if (val2) {
		teams[val2] = {
		    roomsByRound: {}
		};
		teams[val2].roomsByRound[i] = j;
	    } // check if val2 exists because there may be byes
	}
    }
    console.log(rounds);
    for (var team in teams) {
	for (var role of guild.roles.cache.values()) {
	    if (team === role.name) {
		teams[team].role = role;
		break;
	    }
	}
    }
    for (var room in rooms) {
	for (var channel of guild.channels.cache.values()) {
	    if (channel.name === rooms[room].name && channel.type === 'category') {
		for (var child of channel.children.values()) {
		    if (child.type === 'text') {
			rooms[room].channel = child;
			break;
		    }
		}
		break;
	    }
	}
    }
    for (var room in rooms) {
	if (!rooms[room].channel) {
	    continue;
	}
	var roomSchedule = {
	    color: '#29bb9c', // same as discord aqua
	    title: 'Schedule for Room "' + rooms[room].name + '"',
	    description: 'Run the commands listed here before/after each round to move teams to the correct room. You can simply copy/paste the commands from this schedule.',
	    fields: []
	};
	var i = 0;
	for (var round in rooms[room].teamsByRound) {
	    var t1 = teams[rooms[room].teamsByRound[round][0]];
	    var t2 = teams[rooms[room].teamsByRound[round][1]];
	    if (!t2) {
		break;
	    }
	    if (i === 0) {
		roomSchedule.fields.push({
		    name: 'Before ' + rounds[round],
		    value: '.a ' + t1.role.toString() + ' ' + rooms[room].channel.toString() + '\n.a ' + t2.role.toString() + ' ' + rooms[room].channel.toString()
		});
	    }
	    var nextRound = String(Number(round) + 1);
	    try {
		var nextRound = rounds.inOrder[rounds.inOrder.indexOf(Number(round)) + 1];
	    } catch (e) {} // last round
	    var nextRoom1 = Number(t1.roomsByRound[nextRound]);
	    var nextRoom2 = Number(t2.roomsByRound[nextRound]);
	    var fieldValue = '';
	    if (nextRoom1 && rooms[nextRoom1].channel) {
		fieldValue += '.t ' + t1.role.toString() + ' ' + rooms[room].channel.toString() + ' ' + rooms[nextRoom1].channel.toString();
	    } else {
		fieldValue += '.r ' + t1.role.toString() + ' ' + rooms[room].channel.toString();
	    }
	    if (nextRoom2 && rooms[nextRoom2].channel) {
		fieldValue += '\n.t ' + t2.role.toString() + ' ' + rooms[room].channel.toString() + ' ' + rooms[nextRoom2].channel.toString();
	    } else {
		fieldValue += '\n.r ' + t2.role.toString() + ' ' + rooms[room].channel.toString();
	    }
	    roomSchedule.fields.push({
		name: 'After ' + rounds[round],
		value: fieldValue
	    });
	    i++;
	}
	rooms[room].channel.send({embed: roomSchedule}).then(function (message) {
	    message.pin();
	    return;
	});
    }
    return;
}

var schedule2 = async function (guild, docID, sheetIndex) {
    var doc = new GoogleSpreadsheet(docID);
    await doc.useApiKey(config.apiKey);
    await doc.loadInfo();
    var sheet = doc.sheetsByIndex[sheetIndex];
    await sheet.loadCells('a1:z26'); // up to 12 rooms and 24 rounds
    var rooms = {}; 
    /*
      {
      roomColumn: {
      name: roomName,
      rounds: {
      roundRow: [teams]
      }
      }
      }
    */
    // big todo
}

var massCreateTeams = async function (guild, prefix, startIndex, endIndex) {
    for (var i = startIndex; i <= endIndex; i++) {
	var name = prefix + String(i);
	var color = [Math.floor(Math.random()*256), Math.floor(Math.random()*256), Math.floor(Math.random()*256)];
	while (color[0] + color[1] + color[2] < 64) {
	    color = [Math.floor(Math.random()*256), Math.floor(Math.random()*256), Math.floor(Math.random()*256)];
	}
	console.log(name + ' ' + color[0] + ' ' + color[1] + ' ' + color[2]);
	await guild.roles.create({
	    data: {
		name: prefix + String(i),
		color: color,
		hoist: true,
		mentionable: true,
		position: 2
	    }
	});
    }
    return;
}

var confirm = async function (message, prompt, failCallback, successCallback) {
    message.channel.send(prompt).then(function (msg) {
	msg.react('👍');
	msg.awaitReactions(function (reaction, user) {
	    return reaction.emoji.name === '👍' && user.id === message.author.id;
	}, {time: 6000}).then(function (collected) {
	    if (collected.size === 0) {
		failCallback();
	    } else {
		successCallback();
	    }
	}).catch(console.error);
    });
}

client.on('message', function (message) {
    if (message.content.indexOf('.a') === 0 && (message.member.roles.highest.name === 'Control Room' || message.member.roles.highest.name === 'Staff')) {
	try {
	    var roles = message.mentions.roles.array();
	    var role = roles[0];
	    var channels = message.mentions.channels.array();
	    var to = channels[0].parent;
	    confirm(message, 'Are you sure you want to add team ' + role.toString() + ' to room "' + to.name + '"? Confirm by reacting with \:thumbsup:.', function () {
		message.channel.send('No confirmation was received. The addition is cancelled.');
	    }, function () {
		add(role, to).then(function () {
		    message.channel.send('Team ' + role.toString() + ' has been added to room "' + to.name + '."');
		}).catch(function (error) {
		    console.error(error);
		    help(message.channel, ['a']);
		});
	    });
	} catch (e) {
	    console.error(e);
	    help(message.channel, ['a']);
	}
    } else if (message.content.indexOf('.r') === 0 && (message.member.roles.highest.name === 'Control Room' || message.member.roles.highest.name === 'Staff')) {
	try {
	    var roles = message.mentions.roles.array();
	    var role = roles[0];
	    var channels = message.mentions.channels.array();
	    var from = channels[0].parent;
	    confirm(message, 'Are you sure you want to remove team ' + role.toString() + ' from room "' + from.name + '"? Confirm by reacting with \:thumbsup:.', function () {
		message.channel.send('No confirmation was received. The removal is cancelled.');
	    }, function	() {
		add(role, to).then(function () {
		    message.channel.send('Team ' + role.toString() + ' has been removed from room "' + from.name + '."');
		}).catch(function (error) {
		    console.error(error);
		    help(message.channel, ['r']);
		});
	    });
	} catch (e) {
	    console.error(e);
	    help(message.channel, ['r']);
	}
    } else if (message.content.indexOf('.t') === 0 && (message.member.roles.highest.name === 'Control Room' || message.member.roles.highest.name === 'Staff')) {
	try {
	    var roles = message.mentions.roles.array();
	    var role = roles[0];
	    var channels = message.mentions.channels.array();
	    var from = channels[0].parent;
	    var to = channels[1].parent;
	    confirm(message, 'Are you sure you want to transfer team ' + role.toString() + ' from room "' + from.name + '" to room "' + to.name + '"? Confirm by reacting with \:thumbsup:.', function () {
		message.channel.send('No confirmation was received. The transfer is cancelled.');
	    }, function	() {
		remove(role, from).then(function () {
		    add(role, to).then(function () {
			message.channel.send('Team ' + role.toString() + ' has been transferred from room "' + from.name + '" to room "' + to.name + '."');
		    }).catch(function (error) {
			console.error(error);
			help(message.channel, ['t']);
		    });
		}).catch(function (error) {
		    console.error(error);
		    help(message.channel, ['t']);
		});
	    });
	} catch (e) {
	    console.error(e);
	    help(message.channel, ['t']);
	}
    } else if (message.content.indexOf('.e') === 0 && message.member.roles.highest.name === 'Control Room') {
	try {
	    var channels = message.mentions.channels.array();
	    var clearChannel = function (index) {
		empty(channels[index].parent).then(function () {
		    message.channel.send('Emptied room "' + channels[index].parent.name + '."');
		    if (index < channels.length - 1) {
			empty(index + 1);
		    } else {
			message.channel.send('All specified rooms emptied.');
		    }
		});
	    }
	    clearChannel(0);
	} catch (e) {
	    console.error(e);
	    help(message.channel, ['e']);
	}
    } else if (message.content.indexOf('.i') === 0 && message.member === message.channel.guild.owner) {
	confirm(message, 'Are you sure you want to initialize the server? Every channel and role currently in the server will be deleted. Confirm by reacting with \:thumbsup:.', function () {
	    message.channel.send('No confirmation was received. The initialization is cancelled.');
	}, function () {
	    init(message.channel.guild, message.channel).catch(function () {
		help(message.channel, ['i']);
	    });
	});
    } else if (message.content.indexOf('.c') === 0 && message.member.roles.highest.name === 'Control Room') {
	try {
	    var content = message.content.substr(message.content.indexOf(' ') + 1).trim();
	    var names = content.split(/["“”]/g);
	    confirm(message, 'Are you sure you want to create the room[s] ' + content + '? Confirm by reacting with \:thumbsup:.', function () {
		message.channel.send('No confirmation was received. The creation is cancelled.');
	    }, function () {
		for (var i = 1; i < names.length; i += 2) {
		    var name = names[i];
		    createRoom(message.channel.guild, name).then(function (textChannel) {
			// message.channel.send('Room "' + name + '" has been created.');
			message.channel.send('Room "' + textChannel.parent.name + '" has been created.');
		    }).catch(function (error) {
			console.error(error);
			message.channel.send('Room "' + name + '" could not be created. Please try using a different name.');
			help(message.channel, ['c']);
		    });
		}
	    });
	} catch (e) {
	    console.error(e);
	    help(message.channel, ['c']);
	}
	/*
	  } else if (message.content.indexOf('.c') === 0 && message.member.roles.highest.name === 'Control Room') {
	  // todo add the ability to create multiple rooms at once
	  try {
	  var name = message.content.substr(message.content.indexOf(' ') + 1).trim();
	  if (name.length < 90) {
	  confirm(message, 'Are you sure you want to create room "' + name + '"? Confirm by reacting with \:thumbsup:.', function () {
	  message.channel.send('No confirmation was received. The creation is cancelled.');
	  }, function () {
	  createRoom(message.channel.guild, name).then(function (textChannel) {
	  // message.channel.send('Room "' + name + '" has been created.');
	  message.channel.send('Room "' + name + '" has been created.');
	  }).catch(function (error) {
	  console.error(error);
	  message.channel.send('Room "' + name + '" could not be created. Please try using a different name.');
	  help(message.channel, ['c']);
	  });
	  });
	  } else {
	  message.channel.send('The room name must be less than 90 characters.');
	  }
	  } catch (e) {
	  console.error(e);
	  help(message.channel, ['c']);
	  }
	*/
    } else if (message.content.indexOf('.d') === 0 && message.member.roles.highest.name === 'Control Room') {
	try {
	    var channels = message.mentions.channels.array();
	    // if (parent.children.length === 2) {
	    confirm(message, 'Are you sure you want to delete the specified room[s]? Confirm by reacting with \:thumbsup:.', function () {
		message.channel.send('No confirmation was received. The deletion is cancelled.');
	    }, function () {
		for (var text of channels) {
		    deleteRoom(text).then(function (name) {
			message.channel.send('Room "' + name + '" has been deleted.');
		    }).catch(function (error) {
			console.error(error);
			message.channel.send('Room "' + text + '" could not be deleted. Please delete it manually.')
			help(message.channel, ['d']);
		    });
		}
	    });
	    /*
	      } else {
	      help(message.channel);
	      }
	    */
	} catch (e) {
	    console.error(e);
	    help(message.channel, ['d']);
	}
    } else if (message.content.indexOf('.f') === 0 && message.member.roles.highest.name === 'Control Room') {
	try {
	    var teams = message.mentions.roles.array();
	    confirm(message, 'Are you sure you want to create a finals room with teams ' + teams[0].toString() + ' and ' + teams[1].toString() + '? Confirm by reacting with \:thumbsup:.', function () {
		message.channel.send('No confirmation was received. The creation is cancelled.');
	    }, function () {
		finalsRoom(message.channel.guild, teams[0], teams[1]).then(function (textChannel) {
		    // message.channel.send('A finals room has been created');
		    message.channel.send('A finals room has been created.');
		}).catch(function (error) {
		    console.error(error);
		    message.channel.send('A finals room could not be created. Please create it manually.');
		    help(message.channel, ['f']);
		});
	    });
	} catch (e) {
	    console.error(e);
	    help(message.channel, ['f']);
	}
    } else if (message.content.indexOf('.s') === 0 && message.member.roles.highest.name === 'Control Room') {
	try {
	    var content = message.content.split(/\s+/g);
	    var url = parseUrl(content[1]);
	    var docID = url.pathname.split('/')[3];
	    var sheetIndex = content[2] || Infinity;
	    if (sheetIndex === Infinity) {
		sheetIndex = 0;
	    }
	    confirm(message, 'Are you sure you want to generate room schedules from the specified spreadsheet? Confirm by reacting with \:thumbsup:.', function () {
		message.channel.send('No confirmation was received. The schedule generation is cancelled.');
	    }, function () {
		schedule(message.channel.guild, docID, sheetIndex).then(function () {
		    message.channel.send('A schedule was generated.');
		}).catch(function (error) {
		    console.error(error);
		    message.channel.send('The schedule could not be generated.');
		    help(message.channel, ['s']);
		});
	    });
	} catch (e) {
	    console.error(e);
	    help(message.channel, ['s']);
	}
    } else if (message.content.indexOf('.m') === 0 && message.member.roles.highest.name === 'Control Room') {
	try {
	    var spaceIndex = message.content.trim().indexOf(' ');
	    if (spaceIndex === -1) {
		throw 'No range provided to .m, sending help dialog to channel.';
	    }
	    var range = message.content.substr(spaceIndex + 1).trim();
	    confirm(message, 'Are you sure you want to mass create teams from the range ' + range + '? Confirm by reacting with \:thumbsup:.', function () {
		message.channel.send('No confirmation was received. The creation is cancelled.');
	    }, function () {
		var splitByBracket = range.split('[');
		var prefix = splitByBracket[0];
		var splitByEllipsis = splitByBracket[1].split('...');
		var startIndex = Number(splitByEllipsis[0]);
		var endIndex = Number(splitByEllipsis[1].substr(0, splitByEllipsis[1].length - 1));
		massCreateTeams(message.channel.guild, prefix, startIndex, endIndex).then(function () {
		    message.channel.send('The teams were created.');
		}).catch(function (error) {
		    console.error(error);
		    message.channel.send('The teams could not be created.');
		    help(message.channel, ['s']);
		});
	    });
	} catch (e) {
	    console.error(e);
	    help(message.channel, ['n', 'm']);
	}
    } else if (message.content.indexOf('.') === 0) {
	help(message.channel);
    }
    return;
});

client.login(config.token);
client.on('ready', function () {
    for (var guild of client.guilds.cache.array()) {
	console.log(guild.name + ' ' + guild.owner.user.tag);
    }
    client.user.setActivity('.help', {type: 'LISTENING'}).then(function () {
	console.log('up and running!');
    }).catch(console.error);
});
