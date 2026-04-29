const { REST, Routes } = require("discord.js");

async function registerCommands(env, commands) {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  const body = commands.map((c) => c.toJSON());
  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
}

module.exports = { registerCommands };

