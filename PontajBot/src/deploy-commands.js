require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { commands } = require('./commands');

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  throw new Error('Lipsesc DISCORD_TOKEN sau DISCORD_CLIENT_ID în fișierul .env.');
}

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

(async () => {
  const route = DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID)
    : Routes.applicationCommands(DISCORD_CLIENT_ID);

  await rest.put(route, { body: commands });
  console.log(DISCORD_GUILD_ID
    ? 'Comenzile au fost publicate pentru serverul de dezvoltare.'
    : 'Comenzile globale au fost publicate. Discord poate întârzia apariția lor.');
})().catch((error) => {
  console.error('Nu am putut publica comenzile:', error);
  process.exitCode = 1;
});
