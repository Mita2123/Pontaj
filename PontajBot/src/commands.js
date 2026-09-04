const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('recreeaza-panou-pontaj')
    .setDescription('Recreează panoul de pontaj dacă a fost șters.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder()
    .setName('resetpontaj')
    .setDescription('Șterge toate totalurile și sesiunile de pontaj de pe server.')
    // Valoarea 0 îl ascunde implicit tuturor, cu excepția administratorilor.
    // Rolul secundar se poate permite din Server Settings > Integrations.
    .setDefaultMemberPermissions(0n)
    .addBooleanOption((option) => option
      .setName('confirmare')
      .setDescription('Setează pe adevărat pentru a confirma resetarea completă.')
      .setRequired(true)),
].map((command) => command.toJSON());

module.exports = { commands };
