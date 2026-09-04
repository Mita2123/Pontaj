require('dotenv').config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
} = require('discord.js');
const database = require('./database');
const { formatDuration } = require('./time');

const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) {
  throw new Error('Lipsește DISCORD_TOKEN în fișierul .env.');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const panelSetups = new Map();
const resetRoleIds = new Set((process.env.RESET_ROLE_IDS || '')
  .split(',')
  .map((roleId) => roleId.trim())
  .filter(Boolean));

function panelPayload() {
  const embed = new EmbedBuilder()
    .setColor(0x4dabf7)
    .setTitle('Pontaj angajați')
    .setDescription('Folosește butoanele de mai jos pentru a începe sau a opri pontajul. Timpul este calculat de bot în fundal.')
    .addFields({
      name: 'Instrucțiuni',
      value: 'Apasă **Start Pontaj** la începutul programului și **Stop Pontaj** la final. Poți vedea oricând propriul total sau lista totalurilor angajaților.',
    });

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('pontaj:start')
      .setLabel('Start Pontaj')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId('pontaj:stop')
      .setLabel('Stop Pontaj')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌'),
    new ButtonBuilder()
      .setCustomId('pontaj:own-total')
      .setLabel('Total Pontaj Propriu')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('⏱️'),
    new ButtonBuilder()
      .setCustomId('pontaj:employee-totals')
      .setLabel('Total Pontaj Angajați')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📋'),
  );

  return { embeds: [embed], components: [buttons] };
}

async function findOrCreateTimekeepingChannel(guild, savedChannelId) {
  let channel = savedChannelId
    ? await guild.channels.fetch(savedChannelId).catch(() => null)
    : null;

  if (!channel) {
    const channels = await guild.channels.fetch();
    channel = channels.find((candidate) => (
      candidate?.type === ChannelType.GuildText && candidate.name === 'pontaj'
    )) || null;
  }

  if (!channel || channel.type !== ChannelType.GuildText) {
    channel = await guild.channels.create({
      name: 'pontaj',
      type: ChannelType.GuildText,
      topic: 'Panoul de pontaj al serverului.',
    });
  }

  return channel;
}

async function createOrUpdatePanel(guild) {
  const settings = database.getSettings(guild.id);
  const channel = await findOrCreateTimekeepingChannel(guild, settings?.timekeeping_channel_id);
  let panel = settings?.panel_message_id
    ? await channel.messages.fetch(settings.panel_message_id).catch(() => null)
    : null;

  if (panel?.author.id === client.user.id) {
    await panel.edit(panelPayload());
  } else {
    panel = await channel.send(panelPayload());
  }

  database.saveSettings(guild.id, channel.id, panel.id);
  return channel;
}

function ensurePanel(guild) {
  const pendingSetup = panelSetups.get(guild.id);
  if (pendingSetup) return pendingSetup;

  const setup = createOrUpdatePanel(guild).finally(() => panelSetups.delete(guild.id));
  panelSetups.set(guild.id, setup);
  return setup;
}

function getTotalIncludingActiveSession(guildId, userId, nowMs) {
  let durationMs = database.getStoredTotal(guildId, userId);
  const active = database.getActiveSession(guildId, userId);
  if (active) durationMs += Math.max(0, nowMs - active.started_at_ms);
  return { durationMs, active };
}

function getEmployeeTotalsIncludingActiveSessions(guildId, nowMs) {
  const totals = new Map(database.getStoredTotals(guildId)
    .map((row) => [row.user_id, row.duration_ms]));

  for (const active of database.getActiveSessions(guildId)) {
    const activeDurationMs = Math.max(0, nowMs - active.started_at_ms);
    totals.set(active.user_id, (totals.get(active.user_id) || 0) + activeDurationMs);
  }

  return [...totals.entries()].sort(([, totalA], [, totalB]) => totalB - totalA);
}

function employeeTotalEmbeds(rows) {
  if (rows.length === 0) {
    return [new EmbedBuilder()
      .setColor(0x4dabf7)
      .setTitle('Total Pontaj Angajați')
      .setDescription('Nu există încă pontaje înregistrate.')];
  }

  const chunks = [];
  let lines = [];
  let characterCount = 0;
  for (const [userId, durationMs] of rows) {
    const line = `<@${userId}> — **${formatDuration(durationMs)}**`;
    if (lines.length > 0 && characterCount + line.length + 1 > 3_800) {
      chunks.push(lines);
      lines = [];
      characterCount = 0;
    }
    lines.push(line);
    characterCount += line.length + 1;
  }
  if (lines.length > 0) chunks.push(lines);

  return chunks.map((chunk, index) => new EmbedBuilder()
    .setColor(0x4dabf7)
    .setTitle(`Total Pontaj Angajați${chunks.length > 1 ? ` — pagina ${index + 1}` : ''}`)
    .setDescription(chunk.join('\n')));
}

async function startTimekeeping(interaction) {
  const settings = database.getSettings(interaction.guildId);
  if (!settings || interaction.channelId !== settings.timekeeping_channel_id) {
    await interaction.reply({ content: 'Folosește panoul din canalul de pontaj.', ephemeral: true });
    return;
  }

  const nowMs = Date.now();
  if (!database.startSession(interaction.guildId, interaction.user.id, nowMs)) {
    await interaction.reply({ content: 'Ai deja un pontaj pornit.', ephemeral: true });
    return;
  }

  await interaction.reply({ content: `${interaction.user} a pornit pontajul.` });
}

async function stopTimekeeping(interaction) {
  const settings = database.getSettings(interaction.guildId);
  if (!settings || interaction.channelId !== settings.timekeeping_channel_id) {
    await interaction.reply({ content: 'Folosește panoul din canalul de pontaj.', ephemeral: true });
    return;
  }

  const completed = database.stopSession(interaction.guildId, interaction.user.id, Date.now());
  if (!completed) {
    await interaction.reply({ content: 'Nu ai un pontaj pornit.', ephemeral: true });
    return;
  }

  await interaction.reply({
    content: `${interaction.user} a oprit pontajul. Durata pontajului: **${formatDuration(completed.durationMs)}**.`,
    ephemeral: true,
  });
}

async function ownTotal(interaction) {
  const settings = database.getSettings(interaction.guildId);
  if (!settings || interaction.channelId !== settings.timekeeping_channel_id) {
    await interaction.reply({ content: 'Folosește panoul din canalul de pontaj.', ephemeral: true });
    return;
  }

  const total = getTotalIncludingActiveSession(interaction.guildId, interaction.user.id, Date.now());
  await interaction.reply({
    content: `${interaction.user}, totalul tău de pontaj este: **${formatDuration(total.durationMs)}**.`,
    ephemeral: true,
  });
}

async function employeeTotals(interaction) {
  const settings = database.getSettings(interaction.guildId);
  if (!settings || interaction.channelId !== settings.timekeeping_channel_id) {
    await interaction.reply({ content: 'Folosește panoul din canalul de pontaj.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const embeds = employeeTotalEmbeds(getEmployeeTotalsIncludingActiveSessions(interaction.guildId, Date.now()));
  await interaction.editReply({ embeds: embeds.slice(0, 10) });
  for (let start = 10; start < embeds.length; start += 10) {
    await interaction.followUp({ embeds: embeds.slice(start, start + 10), ephemeral: true });
  }
}

function canResetTimekeeping(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const memberRoles = interaction.member?.roles?.cache;
  return Boolean(memberRoles && [...resetRoleIds].some((roleId) => memberRoles.has(roleId)));
}

async function resetTimekeeping(interaction) {
  if (!canResetTimekeeping(interaction)) {
    await interaction.reply({
      content: 'Nu ai permisiunea să resetezi pontajul.',
      ephemeral: true,
    });
    return;
  }

  if (interaction.options.getBoolean('confirmare', true) !== true) {
    await interaction.reply({
      content: 'Resetarea nu a fost confirmată.',
      ephemeral: true,
    });
    return;
  }

  database.resetGuild(interaction.guildId);
  await interaction.reply({
    content: 'Pontajul a fost resetat: sesiunile active și toate totalurile cumulative au fost șterse.',
    ephemeral: true,
  });
}

client.once('ready', async () => {
  console.log(`Botul este conectat ca ${client.user.tag}.`);
  for (const guild of client.guilds.cache.values()) {
    await ensurePanel(guild).catch((error) => {
      console.error(`Nu am putut pregăti canalul de pontaj pentru ${guild.name}:`, error);
    });
  }
});

client.on('guildCreate', (guild) => {
  ensurePanel(guild).catch((error) => {
    console.error(`Nu am putut pregăti canalul de pontaj pentru ${guild.name}:`, error);
  });
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.inGuild()) return;

    if (interaction.isChatInputCommand() && interaction.commandName === 'recreeaza-panou-pontaj') {
      const channel = await ensurePanel(interaction.guild);
      await interaction.reply({ content: `Panoul de pontaj este disponibil în ${channel}.`, ephemeral: true });
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === 'resetpontaj') {
      await resetTimekeeping(interaction);
      return;
    }

    if (!interaction.isButton()) return;
    if (interaction.customId === 'pontaj:start') await startTimekeeping(interaction);
    if (interaction.customId === 'pontaj:stop') await stopTimekeeping(interaction);
    if (interaction.customId === 'pontaj:own-total') await ownTotal(interaction);
    if (interaction.customId === 'pontaj:employee-totals') await employeeTotals(interaction);
  } catch (error) {
    console.error('Eroare la interacțiunea Discord:', error);
    const response = { content: 'A apărut o eroare. Încearcă din nou.', ephemeral: true };
    if (interaction.deferred) await interaction.editReply(response);
    else if (!interaction.replied) await interaction.reply(response);
    else await interaction.followUp(response);
  }
});

client.login(DISCORD_TOKEN);
