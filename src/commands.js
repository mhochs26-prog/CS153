const { SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("connect-google")
    .setDescription("Connect your Google Calendar (OAuth)."),
  new SlashCommandBuilder()
    .setName("create-event")
    .setDescription("Create a calendar event (conflict-checked).")
    .addStringOption((o) =>
      o.setName("title").setDescription("Event title").setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("start")
        .setDescription('Start datetime as ISO (e.g. "2026-04-24T15:00:00-07:00")')
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("end")
        .setDescription('End datetime as ISO (e.g. "2026-04-24T16:00:00-07:00")')
        .setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("timezone")
        .setDescription('IANA timezone (default "America/Los_Angeles")')
        .setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("description").setDescription("Optional description").setRequired(false)
    ),
];

module.exports = { commands };

